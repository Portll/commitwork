#!/usr/bin/env node
// commitwork audit — run the full security-tool suite on a project, then emit a
// dependency-ordered remediation packet for the adversarial review workflow.
//
//   node bin/audit.mjs --project <dir> [--url <baseUrl>] [--openapi <path>]
//                      [--registry <ref>] [--out <dir>]
//
// Runs every tool whose GATE is satisfied (see manifests/security-tools.json),
// records the rest as blocked:<gate>, aggregates findings, topo-sorts the
// remediation DAG, flags coverage voids, and writes audit-packet.json +
// remediation-draft.md.  Zero deps.
//
// noscan discipline (G.3 / R20): a report format with no parser, or an artifact that could not
// be parsed (missing/corrupt/malformed), is recorded as status `noscan` — never as "ran / no
// findings". A tool whose process crashed, was killed by the timeout, or exited non-zero is
// noscan too, independent of whatever (if anything) it left on disk. See classifyFindings() and
// runTool() below. This reuses bin/commitwork.mjs's parseReport/classifyReport vocabulary
// (ok/sev/noscan) rather than inventing a second one for the audit path.

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dockerReachable } from '../lib/docker-reachable.mjs';
import { spawnSync } from 'node:child_process';
import { readSarif, ruleIndex } from '../monitor/sarif-read.mjs'; // the one SARIF reader
import { validateAgainstSchema } from '../monitor/registry.mjs'; // the one schema validator
import { resolve, dirname, join, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { useScopedDockerConfig } from '../lib/docker-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s), cy = (s) => c('36', s);

// ── report classification (defect 1 / HIGH L110, G.3 / R20) ─────────────────────────────────
// Each handler reads ONE tool's report dir and returns either
//   { parsed: true,  sev: {critical,high,medium,low,info}, note }   — a trustworthy read, even if 0
//   { parsed: false, reason }                                       — missing / corrupt / unreadable
// A format with no entry in HANDLERS/HANDLERS_BY_ID below is, by construction, never handed to a
// parser at all — classifyFindings() noscans it directly. This mirrors bin/commitwork.mjs's
// parseReport + PARSED_FORMATS/PASSTHROUGH_FORMATS discipline instead of inventing a second
// vocabulary for the audit path.
function safeJSON(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
const ZERO = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

// Find the one report file a tool run is expected to have written into its own report dir (rd),
// ignoring the _run.log sibling runTool() always writes alongside it.
function findReportFile(rd, pred) {
  let entries; try { entries = readdirSync(rd); } catch { return null; }
  const f = entries.find((x) => x !== '_run.log' && pred(x));
  return f ? join(rd, f) : null;
}

function handleSarif(t, rd) {
  const p = findReportFile(rd, (x) => x.endsWith('.sarif'));
  if (!p) return { parsed: false, reason: 'no .sarif report written' };
  // Maps sarif-read.mjs's typed states; never-ran/tool-failed noscan instead of scoring 0
  const r = readSarif(p);
  if (r.state === 'absent' || r.state === 'unreadable') return { parsed: false, reason: 'report unreadable' };
  if (r.state === 'empty') return { parsed: true, sev: { ...ZERO }, note: '0 (no sources)' };
  if (r.state === 'unparseable') return { parsed: false, reason: 'unparseable sarif (corrupt JSON)' };
  if (r.state === 'never-ran') return { parsed: false, reason: 'not a sarif document — no runs[]' };
  if (r.state === 'tool-failed') return { parsed: false, reason: `tool reported failure — ${r.reason.slice(0, 140)}` };
  // Map to real severity: prefer the rule's CVSS (SARIF security-severity), then the SARIF
  // level, then a per-category floor (a leaked secret is not "medium").
  const sev = { ...ZERO };
  for (const run of r.runs) {
    const rules = ruleIndex(run);
    for (const res of run.results) {
      const rule = rules[res.ruleId] || {};
      const ss = parseFloat(rule.properties?.['security-severity'] ?? res.properties?.['security-severity'] ?? NaN);
      let bucket;
      if (!Number.isNaN(ss)) bucket = ss >= 9 ? 'critical' : ss >= 7 ? 'high' : ss >= 4 ? 'medium' : 'low';
      else if (t.category === 'secrets') bucket = 'high'; // secret-shaped finding → triage-worthy, never medium-by-default
      else { const lvl = res.level || rule.defaultConfiguration?.level || 'warning'; bucket = lvl === 'error' ? 'high' : lvl === 'warning' ? 'medium' : 'low'; }
      sev[bucket]++;
    }
  }
  const total = Object.values(sev).reduce((a, b) => a + b, 0);
  return { parsed: true, sev, note: total ? `${total} findings` : '0' };
}

function handleSbom(t, rd) {
  const p = findReportFile(rd, (x) => x.includes('sbom') || x.endsWith('.json'));
  if (!p) return { parsed: false, reason: 'no sbom report written' };
  const j = safeJSON(p);
  if (!j) return { parsed: false, reason: 'unparseable sbom (corrupt JSON)' };
  // A zero-dependency project is a real, valid CycloneDX document — syft OMITS the components
  // key entirely rather than writing `"components":[]` (confirmed against a live syft run, not
  // assumed). Detect "is this a CycloneDX doc at all" from bomFormat, falling back to an actual
  // components array for tools/shapes that always include the key; anything else (no bomFormat,
  // no components) is not a CycloneDX document, not a clean zero.
  if (j.bomFormat !== 'CycloneDX' && !Array.isArray(j.components)) {
    return { parsed: false, reason: 'sbom has no bomFormat/components — not a CycloneDX document' };
  }
  const n = Array.isArray(j.components) ? j.components.length : 0;
  return { parsed: true, sev: { ...ZERO }, note: `SBOM: ${n} components` };
}

// Nuclei writes JSONL (one finding per line), NOT a JSON document — the same shape
// bin/commitwork.mjs's parseReport('nuclei', …) reads, reused here rather than reinvented
// because the tool and its output format are identical in both places. A finding whose
// captured response is 4xx/5xx is reported but not counted as a live exposure; network detects
// (no HTTP status) count as live.
function handleNuclei(t, rd) {
  const p = findReportFile(rd, (x) => x.endsWith('.json') || x.endsWith('.jsonl'));
  if (!p) return { parsed: false, reason: 'no nuclei report written' };
  let text; try { text = readFileSync(p, 'utf8'); } catch { return { parsed: false, reason: 'report unreadable' }; }
  if (!text.trim()) return { parsed: true, sev: { ...ZERO }, note: '0' };
  const sev = { ...ZERO };
  const bucketFor = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info', unknown: 'info' };
  let sawLine = false, live = 0, unconfirmed = 0;
  for (const line of text.split('\n')) {
    const s = line.trim(); if (!s) continue;
    let d; try { d = JSON.parse(s); } catch { continue; }
    sawLine = true;
    const lvl = String((d.info || {}).severity || 'unknown').toLowerCase();
    const resp = d.response || '';
    const m = resp.match(/^HTTP\/[\d.]+\s+(\d{3})/);
    const status = m ? parseInt(m[1], 10) : null;
    const confirmed = status === null || status < 400;
    if (confirmed) { live++; sev[bucketFor[lvl] || 'info']++; } else unconfirmed++;
  }
  if (!sawLine) return { parsed: false, reason: 'nuclei report had no parseable JSONL lines' };
  const note = (live || unconfirmed) ? `${live} live finding${live === 1 ? '' : 's'}${unconfirmed ? ` (+${unconfirmed} unconfirmed: non-2xx response)` : ''}` : '0';
  return { parsed: true, sev, note };
}

// Format handlers keyed by the manifest's declared report format (shared by every tool that
// declares it — all four SARIF tools, syft's sbom). HANDLERS_BY_ID overrides by tool id for
// tools whose manifest format is a generic bucket ('json') that does not disambiguate shape —
// nuclei writes JSONL under the same 'json' label testssl/prowler also use.
//
// testssl (json), schemathesis (text), docker-bench (text), prowler (json/OCSF), falco
// (stream), renovate (config) and cosign (attestation) have NO entry here — honestly noscan per
// the predicate below, not a fabricated parse of a shape this file has never verified against a
// real report.
const HANDLERS = { sarif: handleSarif, sbom: handleSbom };
const HANDLERS_BY_ID = { nuclei: handleNuclei };

export function classifyFindings(t, rd) {
  const handler = HANDLERS_BY_ID[t.id] || HANDLERS[t.report];
  let parsed = null;
  if (handler) {
    try { parsed = handler(t, rd); } catch (e) { parsed = { parsed: false, reason: `parser crashed: ${e.message}` }; }
  }
  // G.3 / R20 — the exact predicate: no handler OR the artifact could not be parsed ⇒ noscan.
  // "Unhandled format" alone is only half of this disjunction — a format that IS handled but
  // whose artifact is missing/corrupt/malformed must reach noscan too (see bin/cspm-github.sh's
  // C3, a handled-format-but-invalid-artifact case).
  const noscan = !handler || !parsed.parsed;
  if (noscan) {
    const reason = !handler
      ? `no parser for report format '${t.report}' (tool '${t.id}') — classified noscan, not scanned-clean`
      : (parsed.reason || 'artifact could not be parsed');
    return { sev: { ...ZERO }, note: `noscan — ${reason}`, noscan: true, reason };
  }
  return { sev: parsed.sev, note: parsed.note, noscan: false };
}

// ── bounded tree walk (shared by treeHas and the test-coverage probe below) ─────────────────
// One walk, one prune list, one depth<0 semantics, so neither probe can drift from the other.
const PRUNE_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'reports', 'reference', 'vendor', 'target', '.gradle']);
export function treeHasMatch(dir, pred, depth = 3) {
  if (depth < 0) return false;
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) if (pred(e)) return true;
  for (const e of entries) {
    if (e.isDirectory() && !PRUNE_DIRS.has(e.name)) {
      if (treeHasMatch(join(dir, e.name), pred, depth - 1)) return true;
    }
  }
  return false;
}
// Monorepo-aware build-manifest probe: a per-service build.gradle (services/*/build.gradle)
// must register the language even though the root has no build file (evaluations/archive/HANDOFF.md §4 —
// "audit.mjs monorepo language detection misses java").
export function treeHas(dir, names, depth = 3) {
  return treeHasMatch(dir, (e) => e.isFile() && names.includes(e.name), depth);
}

// ── test-coverage void heuristic (defect 3 / MED L178) ───────────────────────────────────────
// The old heuristic was broken two ways: its `exts` clause was dead (walkExts collects bare
// extensions like 'js' — a file named foo.test.js only ever contributes 'js' to that set, which
// can never equal 'test.js'/'spec.js'), and its other probes checked only the project ROOT, so
// a JVM/monorepo project with tests under src/test/java or services/*/src/test (never at the
// top level) got a false "no test suite / coverage config detected" void on every audit packet.
// Replaced with one bounded tree walk (reusing treeHasMatch, the same walk treeHas is built on)
// at walkExts's monorepo-service depth, matching *.test.*/*.spec.* files, a test/tests
// directory, or a root-adjacent vitest/jest config file, anywhere in the tree.
function looksLikeTestEntry(e) {
  if (e.isDirectory()) return e.name === 'test' || e.name === 'tests';
  return /\.(test|spec)\.[A-Za-z0-9]+$/i.test(e.name) || /^(vitest|jest)\.config\./i.test(e.name);
}
export function hasTestCoverage(project) {
  return treeHasMatch(project, looksLikeTestEntry, 6);
}

// ── OpenAPI probe (defect 4 / LOW) ────────────────────────────────────────────────────────────
// Mirrors bin/commitwork.mjs's cmdRun probe — openapi.yaml/json/yml at the project root, tried
// in that order. No directory fallback: schemathesis run "$CW_OPENAPI" needs a spec FILE, and
// the old fallback to the docs/api DIRECTORY was never one — CW_OPENAPI must never point
// schemathesis at something it cannot parse as a spec.
const OPENAPI_CANDIDATES = ['openapi.yaml', 'openapi.json', 'openapi.yml'];
export function resolveOpenapi(project, openapiArg) {
  if (openapiArg) return openapiArg;
  for (const f of OPENAPI_CANDIDATES) if (existsSync(join(project, f))) return f;
  return null;
}

// ── tool execution (defect 2 / MED L104) ─────────────────────────────────────────────────────
// Exported for tests: ctx carries what runTool previously read via closure over top-level script
// state (project/outDir/url/foundOpenapi/timeoutMs) so the exit-status/timeout classification is
// directly testable without a full audit run. main() (below) passes the real values; tests can
// pass fixtures and a short timeoutMs instead of production's 15 minutes.
export function runTool(t, ctx) {
  const { project, outDir, url, foundOpenapi, timeoutMs = 15 * 60 * 1000 } = ctx;
  const rd = join(outDir, t.id); mkdirSync(rd, { recursive: true });
  const env = { ...process.env, CW_REPORT_DIR: rd, CW_TARGET_URL: url || '', CW_OPENAPI: foundOpenapi || '', PWD: project };
  const r = spawnSync('sh', ['-c', t.run], { cwd: project, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  writeFileSync(join(rd, '_run.log'), `$ ${t.run}\n\n[stdout]\n${r.stdout || ''}\n[stderr]\n${r.stderr || ''}`);
  const run = { status: r.status, signal: r.signal || null, error: r.error ? (r.error.code || r.error.message) : null };
  // spawnSync's exit status, its `error`, and the 15-minute timeout were all previously ignored
  // — a tool that crashed, was killed by the timeout (Node reports that as r.error with code
  // ETIMEDOUT and status:null — verified empirically, not assumed), or never completed was still
  // recorded status 'ran'. That is a void: the process never finished, so whatever (if anything)
  // landed on disk is not trustworthy. Checked BEFORE classifyFindings runs at all — independent
  // of, and in addition to, the report-parsing half of the fix (defect 1).
  if (r.error || r.status !== 0) {
    const reason = r.error
      ? `tool did not complete — ${r.error.code || r.error.message}`
      : `tool exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}`;
    return { sev: { ...ZERO }, note: `noscan — ${reason}`, noscan: true, reason, run };
  }
  return { ...classifyFindings(t, rd), run };
}

// ── orchestration ─────────────────────────────────────────────────────────────────────────────
function main() {
  // ── args ──────────────────────────────────────────────────────────────────
  const A = process.argv.slice(2);
  const opt = (k) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : undefined; };
  const project = resolve(opt('--project') || process.cwd());
  const url = opt('--url');
  const openapiArg = opt('--openapi');
  const registry = opt('--registry');
  if (!existsSync(project)) { console.error(red(`project not found: ${project}`)); process.exit(2); }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(opt('--out') || join(ROOT, 'reports', `audit-${basename(project)}-${stamp}`));
  mkdirSync(outDir, { recursive: true });

  const registryDoc = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-tools.json'), 'utf8'));
  // THE REGISTRY IS VALIDATED BEFORE ANY OF IT IS RUN, and until 2026-08-25 it was not: the file
  // had declared `$schema: ../schema/tools.schema.json` since it was written, and that schema did
  // not exist. It advertised a contract nobody could check, and the pointer's presence is exactly
  // what makes a reader stop looking. This registry carries `run` strings that become commands, so
  // a malformed entry is not a cosmetic problem.
  //
  // FATAL, not a warning. Every other loader in this repo that got this wrong printed a warning and
  // continued, and the warning was the thing nobody read. A registry that does not parse is not a
  // registry with a note attached.
  {
    const { errors } = validateAgainstSchema(registryDoc, { path: join(ROOT, 'schema', 'tools.schema.json') });
    if (errors.length) {
      console.error('security-tools.json does not satisfy schema/tools.schema.json:');
      for (const e of errors.slice(0, 12)) console.error(`  - ${e}`);
      if (errors.length > 12) console.error(`  … +${errors.length - 12} more`);
      process.exit(2);
    }
    // A gate a tool names but the registry never defines is a tool that can never run and never
    // says why — the shape a JSON Schema cannot express, so it is checked here beside it.
    const known = new Set(Object.keys(registryDoc.gates || {}));
    const dangling = [];
    for (const t of registryDoc.tools) {
      for (const g of String(t.gate).split('+')) if (!known.has(g)) dangling.push(`${t.id} -> ${g}`);
      for (const d of t.dependsOn || []) {
        if (!registryDoc.tools.some((x) => x.id === d)) dangling.push(`${t.id} dependsOn unknown ${d}`);
      }
    }
    if (dangling.length) {
      console.error(`security-tools.json: ${dangling.length} unresolvable reference(s) — ${dangling.join(', ')}`);
      process.exit(2);
    }
  }

  // ── project probe → which gates are satisfied ───────────────────────────────
  function walkExts(dir, depth = 4, acc = new Set()) {
    if (depth < 0) return acc;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
      if (['node_modules', '.git', 'build', 'dist', 'reports', 'reference'].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walkExts(p, depth - 1, acc);
      else { const m = e.name.match(/\.([a-z0-9]+)$/i); if (m) acc.add(m[1].toLowerCase()); }
    }
    return acc;
  }
  const exts = walkExts(project, 6); // depth 6: monorepo service source (services/*/src/main/java/...) sits below the old depth-4 probe
  const has = (f) => existsSync(join(project, f));
  const hasTree = (...names) => names.some((n) => has(n)) || treeHas(project, names);
  const foundOpenapi = resolveOpenapi(project, openapiArg);
  const dockerUp = dockerReachable();
  const awsCreds = !!process.env.AWS_ACCESS_KEY_ID || existsSync(join(process.env.HOME || '', '.aws', 'credentials'));

  const gates = {
    'static': true,
    'docker-host': dockerUp,
    'running-app': !!url,
    'openapi': !!foundOpenapi,
    'openapi+running-app': !!foundOpenapi && !!url,
    'registry': !!registry,
    'repo-integration': has('renovate.json') || has('.github/dependabot.yml') || has('.renovaterc'),
    'aws': awsCreds,
    'prod-runtime': false,
  };
  const langExts = new Set(['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'java', 'kt', 'go', 'py', 'rb', 'rs', 'php']);
  const languages = [...new Set([
    ...[...exts].filter((e) => langExts.has(e)),
    // manifest-derived (root OR service submodule), so a project with a Node/Gradle/Maven
    // manifest anywhere in the tree is never mis-detected as language-less
    ...(hasTree('package.json') ? ['js'] : []),
    ...(hasTree('build.gradle', 'build.gradle.kts', 'pom.xml') ? ['java'] : []),
    ...(hasTree('go.mod') ? ['go'] : []),
  ])];
  if (has('package.json') && languages.length === 0) { console.error(red('language detection empty despite manifest — aborting (review step 1 guard)')); process.exit(3); }

  // ── tool execution ──────────────────────────────────────────────────────────
  function toolInstalled(t) {
    if (!t.installed) return true;
    return spawnSync('sh', ['-c', t.installed], { cwd: project, stdio: 'ignore' }).status === 0;
  }

  // ── run the suite ───────────────────────────────────────────────────────────
  console.log(bold(`commitwork audit`) + dim(`  project=${basename(project)}  langs=[${languages.join(',')}]  out=${outDir}`));
  console.log(dim(`  gates satisfied: ${Object.entries(gates).filter(([, v]) => v).map(([k]) => k).join(', ') || '(only static)'}`));
  console.log('');
  const results = [];
  for (const t of registryDoc.tools) {
    const gateOk = gates[t.gate] ?? false;
    if (!gateOk) { results.push({ ...t, status: 'blocked', reason: `gate:${t.gate}` }); console.log(`  ${dim('⊘')} ${t.id.padEnd(20)} ${dim('blocked — ' + t.gate)}`); continue; }
    if (!toolInstalled(t)) { results.push({ ...t, status: 'missing', reason: t.install }); console.log(`  ${yel('○')} ${t.id.padEnd(20)} ${yel('not installed — ' + t.install)}`); continue; }
    process.stdout.write(`  ${cy('▸')} ${t.id.padEnd(20)} running… `);
    const f = runTool(t, { project, outDir, url, foundOpenapi });
    // defect 1+2 (HIGH L110 / MED L104): a noscan'd run is recorded as its OWN status, not
    // 'ran' — it must NOT satisfy ranCats below, so the coverage-void detector (the same one
    // blocked/missing tools already trip) fires for this category instead of a silent "0
    // findings" green.
    const status = f.noscan ? 'noscan' : 'ran';
    results.push({ ...t, status, reason: f.noscan ? f.reason : null, findings: f });
    const sc = f.sev ? (f.sev.critical ? red(f.sev.critical + 'C') : '') + (f.sev.high ? red(f.sev.high + 'H') : '') : '';
    console.log(`${f.noscan ? cy('void') : grn('done')} ${dim(f.note)} ${sc}`);
  }

  // ── dependency-ordered remediation (topo sort over dependsOn) ────────────────
  function topo(tools) {
    const byId = new Map(tools.map((t) => [t.id, t]));
    const seen = new Set(), order = [];
    const visit = (id) => {
      if (seen.has(id) || !byId.has(id)) return; seen.add(id);
      for (const d of byId.get(id).dependsOn || []) visit(d);
      order.push(byId.get(id));
    };
    tools.forEach((t) => visit(t.id));
    return order;
  }
  const ordered = topo(results);

  // ── coverage void detection ─────────────────────────────────────────────────
  const ranCats = new Set(results.filter((r) => r.status === 'ran').map((r) => r.category));
  const allCats = [...new Set(registryDoc.tools.map((t) => t.category))];
  const voids = [];
  for (const cat of allCats) if (!ranCats.has(cat)) {
    const blockers = results.filter((r) => r.category === cat).map((r) => r.reason);
    voids.push({ dimension: cat, reason: blockers.join('; ') });
  }
  if (!hasTestCoverage(project)) voids.push({ dimension: 'test-coverage', reason: 'no test suite / coverage config detected' });

  // ── emit packet + draft ─────────────────────────────────────────────────────
  const packet = {
    project: basename(project), path: project, generatedFromStamp: stamp, languages,
    gates, tools: results.map((r) => ({ id: r.id, category: r.category, phase: r.phase, gate: r.gate, status: r.status, reason: r.reason || null, findings: r.findings?.sev || null, note: r.findings?.note || null, run: r.findings?.run || null, dependsOn: r.dependsOn })),
    remediationOrder: ordered.filter((t) => t.status === 'ran' || ['renovate', 'cosign'].includes(t.id)).map((t) => t.id),
    voids,
  };
  writeFileSync(join(outDir, 'audit-packet.json'), JSON.stringify(packet, null, 2));

  const md = [];
  md.push(`# Security audit — ${packet.project}`, '', `Languages: ${languages.join(', ') || 'n/a'} · generated ${stamp}`, '');
  md.push('## Tools', '', '| Tool | category | status | findings |', '|---|---|---|---|');
  for (const r of results) md.push(`| ${r.id} | ${r.category} | ${r.status}${r.reason ? ` (${r.reason})` : ''} | ${r.findings ? (r.findings.note + (r.findings.sev?.critical ? ` — ${r.findings.sev.critical}C/${r.findings.sev.high}H` : '')) : '—'} |`);
  md.push('', '## Dependency-ordered remediation (draft — pre-review)', '');
  ordered.filter((t) => t.status === 'ran' || ['renovate', 'cosign'].includes(t.id)).forEach((t, i) => {
    const dep = (t.dependsOn || []).length ? ` _(after: ${t.dependsOn.join(', ')})_` : '';
    md.push(`${i + 1}. **${t.id}** — ${t.rationale}${dep}${t.findings?.note ? ` · ${t.findings.note}` : ''}`);
  });
  md.push('', '## Coverage voids', '');
  for (const v of voids) md.push(`- **${v.dimension}** — ${v.reason || 'no tool ran'}`);
  md.push('', '_This is the PRE-review draft. The adversarial workflow (overloop + breakers + bifocal/foureyes, ≤4 rounds) refines ordering, challenges each step, and closes voids._', '');
  writeFileSync(join(outDir, 'remediation-draft.md'), md.join('\n'));

  console.log('');
  console.log(bold('── audit complete ──'));
  console.log(`  ran: ${results.filter((r) => r.status === 'ran').length} · noscan: ${results.filter((r) => r.status === 'noscan').length} · blocked: ${results.filter((r) => r.status === 'blocked').length} · missing: ${results.filter((r) => r.status === 'missing').length}`);
  console.log(`  voids: ${voids.map((v) => v.dimension).join(', ')}`);
  console.log(`  packet: ${cy(join(outDir, 'audit-packet.json'))}`);
  console.log(`  draft:  ${cy(join(outDir, 'remediation-draft.md'))}`);
}

// Run the CLI only when invoked directly, not when imported (e.g. by the test suite, which
// needs classifyFindings/runTool/hasTestCoverage/resolveOpenapi without triggering a full audit
// run against whatever the importing process's cwd happens to be). Mirrors bin/commitwork.mjs's
// own entrypoint guard.
// Point docker/trivy/grype at commitwork's own docker config before anything spawns them.
// Without this the launchd agents are quiet and every hand-run scan still raises the App Data
// prompt — the gap that left 7 requests a day attributed to a bare "node".
if (isMainModule(import.meta.url)) { useScopedDockerConfig(); main(); }
