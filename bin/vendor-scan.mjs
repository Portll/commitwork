#!/usr/bin/env node
// bin/vendor-scan.mjs — scans vendored code, which every manifest-gated dependency lane skips.
// Unidentified is its own state, never clean; unreachable OSV ⇒ ran:false, never findings:[].
//
// usage:
//   node bin/vendor-scan.mjs [rootDir]        (default: cwd)
//   node bin/vendor-scan.mjs --offline        identify only; never touch the network
//   node bin/vendor-scan.mjs --json           machine output (default when not a TTY)
//
// exit: 0 no known vulnerabilities · 1 vulnerable vendored asset found · 2 usage
//       (an unidentified asset is NOT an exit-1: it is a coverage void, reported as one)
//
// env: CW_VENDOR_OSV_URL (default https://api.osv.dev/v1/query) · CW_NOW · CW_VENDOR_TIMEOUT_MS

import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { baseScore, band, parseVector, versionOf } from './cvss.mjs';
import { loadIndex } from './advisory-index.mjs';
import { loadGraph, rollup } from './cwe-graph.mjs';
import { loadGraph as loadCapec, attributionFor } from './capec-graph.mjs';
import { loadGraph as loadAttack, tacticsFor } from './attack-graph.mjs';

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const ROOT = args.find((a) => !a.startsWith('--')) || process.cwd();
// Read env at call time — a module-level capture defeats CW_* test overrides.
const osvUrl = () => process.env.CW_VENDOR_OSV_URL || 'https://api.osv.dev/v1/query';
const timeoutMs = () => +(process.env.CW_VENDOR_TIMEOUT_MS || 15000);

// Not ours to scan: dependency trees, our outputs, agent worktrees (double-count).
const SKIP_DIRS = new Set(['node_modules', '.git', 'reports', 'coverage', 'dist', 'build', '.next', 'target']);
const VENDOR_HINT = /(^|[\\/])(vendor|vendors|third[-_]?party|externals?|assets[\\/]lib)([\\/]|$)/i;
const SCANNABLE = /\.(js|mjs|cjs|css)$/i;
const BANNER_BYTES = 4096;   // banners live at the top; do not read 600 KB to find a version

/** Everything that looks vendored: under a vendor-ish directory, or a minified bundle anywhere. */
export function findVendored(root, { skipDirs = SKIP_DIRS } = {}) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') && e.name !== '.claude') { if (e.isDirectory()) continue; }
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || e.name === '.claude') continue;
        walk(p);
      } else if (SCANNABLE.test(e.name)) {
        const rel = relative(root, p);
        if (VENDOR_HINT.test(sep + rel) || /\.min\.(js|css)$/i.test(e.name)) out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

// Banner shape → advisory-database coordinates (three.js "r147" publishes as npm 0.147.0).
// `deep: true` searches the whole file — minifiers hoist the version marker out of the banner.
const IDENTIFIERS = [
  { name: 'three', ecosystem: 'npm', re: /three\.js\s+r(\d+)/i, version: (m) => `0.${m[1]}.0`, deep: true },
  { name: 'jquery', ecosystem: 'npm', re: /jQuery\s+(?:JavaScript\s+Library\s+)?v?(\d+\.\d+\.\d+)/i, version: (m) => m[1] },
  { name: 'bootstrap', ecosystem: 'npm', re: /Bootstrap\s+v?(\d+\.\d+\.\d+)/i, version: (m) => m[1] },
  { name: 'lodash', ecosystem: 'npm', re: /lodash[^\n]{0,40}?(\d+\.\d+\.\d+)/i, version: (m) => m[1] },
  { name: 'moment', ecosystem: 'npm', re: /moment\.js[^\n]{0,40}?(\d+\.\d+\.\d+)/i, version: (m) => m[1] },
  { name: 'd3', ecosystem: 'npm', re: /d3[.\s]+v?(\d+\.\d+\.\d+)/i, version: (m) => m[1] },
  { name: 'axios', ecosystem: 'npm', re: /axios\/(\d+\.\d+\.\d+)/i, version: (m) => m[1] },
  // generic last: `/*! name v1.2.3` and `@license name 1.2.3` cover most UMD bundles
  { name: null, ecosystem: 'npm', re: /[/*!\s]{2,}([a-z][a-z0-9._-]{1,30})(?:\.js)?\s+v(\d+\.\d+\.\d+)/i,
    version: (m) => m[2], pkg: (m) => m[1].toLowerCase() },
];

/** Identify one vendored file from its banner. Returns null when nothing can be established. */
export function identify(text, file) {
  const full = String(text || '');
  const head = full.slice(0, BANNER_BYTES);
  for (const id of IDENTIFIERS) {
    const m = (id.deep ? full : head).match(id.re);
    if (!m) continue;
    const name = id.name || (id.pkg ? id.pkg(m) : null);
    if (!name) continue;
    return { package: name, version: id.version(m), ecosystem: id.ecosystem, via: 'banner' };
  }
  return null;
}

async function osvQuery(pkg, version, ecosystem, index, graph, capecGraph, attackGraph) {
  const r = await fetch(osvUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { name: pkg, ecosystem }, version }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!r.ok) throw new Error(`OSV ${r.status}`);
  const j = await r.json();
  return (j.vulns || []).map((v) => ({
    id: v.id,
    summary: (v.summary || '').slice(0, 300),
    ...gradeOf(v, index),
    ...weaknessOf(v, index, graph, capecGraph, attackGraph),
    advisory: `https://osv.dev/vulnerability/${v.id}`,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

// The weakness and attack axes, carried alongside severity rather than folded into it. Every field
// is an ATTRIBUTE: one finding stays one finding at any fan-out (STPA §6.1/6.2). `attackParent` is
// NOT published — a sub-technique id already contains it, and one fact in two columns is a lie
// waiting to happen.
export function weaknessOf(v, index = null, graph = null, capecGraph = null, attackGraph = null) {
  const entry = (index && v && v.id && index[String(v.id)]) || null;
  const ids = (entry && entry.cwe) || [];
  if (!ids.length) {
    return { cwe: '', cwePillar: '', capec: '', capecVia: '', attack: '', attackTactic: '', capecReason: 'no-cwe' };
  }
  const pillars = graph ? [...new Set(ids.map((c) => rollup(graph, c, 'Pillar')).filter(Boolean))] : [];
  const att = capecGraph
    ? attributionFor(ids, capecGraph)
    : { capec: '', capecVia: '', attack: '', capecReason: '' };
  const tac = attackGraph && att.attack
    ? tacticsFor(att.attack.split(' '), attackGraph)
    : { attackTactic: '' };
  return {
    cwe: ids.join(' '),
    cwePillar: pillars.sort().map((c) => `CWE-${c}`).join(' '),
    capec: att.capec,
    capecVia: att.capecVia,
    attack: att.attack,
    attackTactic: tac.attackTactic,
    capecReason: att.capecReason,
  };
}

const LABEL = { critical: 'crit', high: 'high', moderate: 'med', medium: 'med', low: 'low' };
const RANK = { crit: 4, high: 3, med: 2, low: 1 };

// Two graders, neither trusted alone: OSV's CVSS vector and GitHub's label. Disagreement takes the
// HIGHER and publishes both. Inputs are kept verbatim — the predecessor discarded them for an
// 'unknown-cvss' sentinel, so no stored artifact could be re-graded.
export function gradeOf(v, index = null) {
  // v2 carries no CVSS: prefix, so membership is "parses as a vector", not "starts with CVSS"
  const vectors = ((v && v.severity) || []).map((s) => String((s && s.score) || ''))
    .filter((s) => s.startsWith('CVSS') || versionOf(s) !== '');
  // highest across vectors — what this function's header always claimed and never did
  const scored = vectors.map((s) => ({ vector: s, score: baseScore(s), version: versionOf(s), via: 'osv' }))
    .filter((x) => x.score !== null);

  // Index fills gaps, never overrides — consulted only where OSV yielded nothing scorable.
  const entry = (index && v && v.id && index[String(v.id)]) || null;
  if (!scored.length && entry) {
    for (const [vec, sc] of [[entry.v4, entry.s4], [entry.v3, entry.s3], [entry.v2, entry.s2]]) {
      if (!vec) continue;
      const score = typeof sc === 'number' ? sc : baseScore(vec);
      if (score === null) continue;
      scored.push({ vector: vec, score, version: versionOf(vec), via: 'index' });
      break;
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0] || null;
  // 0.0 bands `none`, which RANK omits, so it falls through to the label rather than posing as a severity
  const topBand = top ? band(top.score, top.version) : '';
  const fromCvss = RANK[topBand] ? topBand : '';

  const label = String((v && v.database_specific && v.database_specific.severity) || (entry && entry.label) || '');
  const fromLabel = LABEL[label.toLowerCase()] || '';

  // Why a grader stayed silent; '' means it spoke. Not limited to undetermined rows — a blind spot on
  // a row the label graded is otherwise invisible.
  const why = [fromCvss ? '' : cvssSilence(vectors, top), fromLabel ? '' : labelSilence(label)]
    .filter(Boolean).join('+');
  const evidence = { cvss: top ? top.vector : (vectors[0] || ''), cvssScore: top ? top.score : null,
    cvssVia: top ? top.via : '', label, severityReason: why };

  if (fromCvss && fromLabel) {
    const agree = fromCvss === fromLabel;
    return {
      severity: agree ? fromCvss : (RANK[fromCvss] > RANK[fromLabel] ? fromCvss : fromLabel),
      severitySource: agree ? 'agree' : 'disagreement', ...evidence,
    };
  }
  if (fromCvss) return { severity: fromCvss, severitySource: 'cvss', ...evidence };
  if (fromLabel) return { severity: fromLabel, severitySource: 'label', ...evidence };
  return { severity: 'undetermined', severitySource: 'undetermined', ...evidence };
}

// "OSV carried nothing" and "we cannot score v4" have different owners; only the second is ours.
function cvssSilence(vectors, top) {
  if (top) return 'cvss-none';   // something scored, and the score is 0.0
  if (!vectors.length) return 'cvss-absent';
  const parsed = vectors.map(parseVector).find(Boolean);
  return parsed ? `cvss-unsupported-v${parsed.version}` : 'cvss-unparseable';
}

const labelSilence = (label) => (label ? 'label-unrecognised' : 'label-absent');

export async function scan(root, { offline = false, index = undefined } = {}) {
  // Once per scan; a broken index stops the run rather than blaming the advisory for the gap.
  const cvssIndex = index !== undefined ? index : loadIndex().advisories;
  const cweGraph = loadGraph();
  const capecGraph = loadCapec();
  const attackGraph = loadAttack();
  const files = findVendored(root);
  const findings = [];
  const unidentified = [];
  const identified = [];
  let netError = null;

  for (const rel of files) {
    const abs = join(root, rel);
    let text = '', bytes = 0;
    try { bytes = statSync(abs).size; text = readFileSync(abs, 'utf8'); } catch { /* unreadable */ }
    const id = identify(text, rel);
    if (!id) {
      // No identity ⇒ no lookup ⇒ no findings — a coverage void, never "no problem".
      unidentified.push({ file: rel, bytes, reason: 'no version banner — cannot resolve to an advisory database' });
      continue;
    }
    identified.push({ file: rel, ...id });
    if (offline || netError) continue;
    try {
      for (const v of await osvQuery(id.package, id.version, id.ecosystem, cvssIndex, cweGraph,
        capecGraph, attackGraph)) {
        findings.push({ file: rel, package: id.package, version: id.version, ecosystem: id.ecosystem, ...v });
      }
    } catch (e) { netError = e.message; }
  }

  // An advisory database we could not reach is not a clean advisory database.
  const ran = !offline && !netError;
  return {
    tool: 'vendor-scan',
    generated: nowISO(),
    ran,
    skipped: offline || !!netError,
    reason: offline ? 'offline: identification only, no advisory lookup'
      : netError ? `advisory lookup failed (${netError}) — findings are INCOMPLETE, not absent` : null,
    summary: {
      scanned: files.length,
      identified: identified.length,
      unidentified: unidentified.length,
      findings: findings.length,
      verdict: !ran ? `NOT RUN — ${offline ? 'offline' : netError}`
        : findings.length ? `${findings.length} known vulnerabilit${findings.length === 1 ? 'y' : 'ies'} in vendored code`
          : unidentified.length ? `no known vulnerabilities, but ${unidentified.length} vendored file(s) could not be identified`
            : 'clean',
    },
    findings: findings.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id)),
    identified: identified.sort((a, b) => a.file.localeCompare(b.file)),
    unidentified: unidentified.sort((a, b) => a.file.localeCompare(b.file)),
  };
}

if (isMainModule(import.meta.url)) {
  const res = await scan(ROOT, { offline: has('--offline') });
  if (has('--json') || !process.stdout.isTTY) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  } else {
    const s = res.summary;
    process.stdout.write(`vendor-scan: ${s.verdict}\n`);
    process.stdout.write(`  scanned ${s.scanned} · identified ${s.identified} · unidentified ${s.unidentified}\n`);
    for (const f of res.findings) process.stdout.write(`  🟥 ${f.file}  ${f.package}@${f.version}  ${f.id}  ${f.summary}\n`);
    for (const u of res.unidentified) process.stdout.write(`  ⬜ ${u.file}  ${(u.bytes / 1024).toFixed(0)} KB — ${u.reason}\n`);
  }
  process.exitCode = res.findings.length ? 1 : 0;
}
