#!/usr/bin/env node
// commitwork — projectstatus: one regenerable status document for the whole platform.
// Emits PROJECTSTATUS.md (private, beside the stores it summarises: monitor/private/) +
// reports/projectstatus.html (self-contained, file:// safe) from one data pass.
//
// Usage: node bin/projectstatus.mjs [--root <dir>]
// Env:   CW_NOW (ISO override — deterministic output for tests), CW_DOCS_MAX_AGE_DAYS,
//        CW_ISSUES (issue store path override — else <root>/monitor/private/issues.json),
//        CW_PROJECTSTATUS_OUT (the markdown's path — else <root>/monitor/private/PROJECTSTATUS.md)
// Same inputs ⇒ byte-identical outputs; writes are atomic (tmp+rename).

import { esc } from '../lib/html-escape.mjs';
import { houseCss } from '../lib/house-css.mjs';
import { followerScript } from '../lib/theme-follower.mjs';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { issuesPathFor, registryPathFor, redactionMapPathFor, projectStatusPathFor } from '../monitor/store-paths.mjs';
import { execFileSync } from 'node:child_process';
import { collectDocs, repoRoot } from './docs-doctor.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';


function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function releaseNameRules(root) {
  // The map lives with the private stores, NOT beside the code. It pairs every real name with its
  // pseudonym, which is the reversal table — the publication boundary bars "a map that reverses
  // their anonymisation", and until 2026-09-09 this file was tracked in the public repository.
  const path = redactionMapPathFor(root);
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    // FAIL CLOSED. This used to return [] on ENOENT, which reads as "no names to redact" and is the
    // opposite of the truth: a missing map means the publisher cannot tell whether it is about to
    // disclose a client. Absence is the one case where emitting is worst.
    if (e.code === 'ENOENT') {
      throw new Error(`release redactions are ABSENT at ${path} — refusing to render, because a missing map is not "nothing to redact"`);
    }
    throw new Error(`release redactions at ${path} are unreadable (${e.code})`);
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`release redactions at ${path} are not valid JSON (${e.message})`); }
  if (!Array.isArray(doc?.names) || doc.names.some((x) => typeof x?.name !== 'string' || typeof x?.replacement !== 'string')) {
    throw new Error(`release redactions at ${path} have no usable names[] mapping`);
  }
  // LONGEST NAME FIRST, and this is load-bearing rather than tidy. The rules are applied by
  // reduction, so whichever pattern runs first wins the overlap. In manifest order `clientA` runs
  // before `clientA-monorepo` and consumes its stem, leaving `clientA-monorepo` — a token the
  // manifest never declares, where it declares `clientA`. Measured 2026-09-07: SIX of six compound
  // names came out wrong this way, including `internalB-dev` -> `internalB-dev` and
  // `clientATechnologies` -> `clientATechnologies`.
  //
  // The output is not a disclosure — the client is still redacted — which is exactly why it
  // survived: it looks right. But a consumer matching on the DECLARED replacements does not match
  // these, and a scan asserting "no undeclared replacement token appears" would flag every one.
  // Sorting by name length descending makes the specific rule win its own overlap.
  return doc.names
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .map(({ name, replacement }) => ({
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- name is regex-escaped on the same line
      pattern: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      replacement,
    }));
}

export function releaseSafeLabel(label, rules) {
  return rules.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), String(label));
}

function age(iso, now) {
  if (!iso) return 'unknown';
  const h = (now - new Date(iso)) / 3600000;
  if (!isFinite(h) || h < 0) return 'unknown';
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// The PATH comes from issue-store.mjs (issuesPathFor takes a root, because --root may aim this at
// another repository); the fail-closed LOAD is replicated deliberately — only ENOENT is absence, a
// corrupt store is ERROR, never "no issues".
function gatherIssues(root, now, { ambient = true } = {}) {
  // ambient:false when the caller passed --root. CW_ISSUES is a statement about THIS shell's repo,
  // so aiming this at a second checkout while it is exported would otherwise read the FIRST repo's
  // store and publish it under the second one's name.
  const path = issuesPathFor(root, { ambient });
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent' };
    return { state: 'error', message: `issue store at ${path} is unreadable (${e.code})` };
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { return { state: 'error', message: `issue store at ${path} is not valid JSON (${e.message})` }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !doc.issues || typeof doc.issues !== 'object') {
    return { state: 'error', message: `issue store at ${path} has no issues{} — unrecognised shape` };
  }
  const out = {
    state: 'ok', open: 0, claimed: 0, blocked: 0, unsatisfiable: 0, closed: 0,
    bySeverity: { crit: 0, high: 0, med: 0, low: 0, unknown: 0 },
    slaBreached: 0, suspect: 0,
  };
  for (const iss of Object.values(doc.issues)) {
    if (iss.state === 'open') out.open += 1;
    else if (iss.state === 'claimed') out.claimed += 1;
    else if (iss.state === 'blocked') out.blocked += 1;
    else if (iss.state === 'unsatisfiable') out.unsatisfiable += 1;
    else if (iss.state === 'closed') out.closed += 1;
    if (iss.state === 'closed') continue;
    out.bySeverity[iss.severity in out.bySeverity ? iss.severity : 'unknown'] += 1;
    if (iss.suspect) out.suspect += 1;
    if ((iss.state === 'open' || iss.state === 'claimed')
      && iss.slaDueAt && now.getTime() > new Date(iss.slaDueAt).getTime()) out.slaBreached += 1;
  }
  return out;
}

// A caller that names its own root has made the more specific statement, so the ambient CW_*
// overrides stand only when no root was named (monitor/store-paths.mjs).
export function gather({ root, ambient = root === undefined, now = process.env.CW_NOW ? new Date(process.env.CW_NOW) : new Date() } = {}) {
  root ??= repoRoot();
  const anchor = {
    sha: git(root, ['rev-parse', '--short', 'HEAD']) || 'unknown',
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
    dirty: git(root, ['status', '--porcelain']) ? true : false,
  };

  const registry = readJson(registryPathFor(root, { ambient }));
  const labelRules = releaseNameRules(root);
  const fleet = [];
  for (const area of registry?.areas || []) {
    const out = area.out || area.slug; // registry convention: no explicit out ⇒ slug (monitor/area.mjs)
    const rollup = readJson(join(root, registry.reportsRoot || 'reports', out, 'rollup.json'));
    fleet.push(rollup ? {
      slug: area.slug, label: releaseSafeLabel(area.label, labelRules), scanned: true,
      generated: rollup.generated, generatedAge: age(rollup.generated, now),
      // `stateAtWrite` is baked at roll time, so a paused area's last rollup says `fresh` forever —
      // measured 2026-08-26: clientA rendered "1 repo(s) · 5h ago · fresh" while declared out of
      // every sweep and publishing 1 of its 34 repos. The REGISTRY is the live source for a pause,
      // and it wins here for exactly that reason.
      open: rollup.openTotals || {},
      freshness: area.paused ? 'paused' : (rollup.freshness?.stateAtWrite || 'unknown'),
      paused: area.paused ? { since: area.paused.since, reason: area.paused.reason } : null,
      repos: rollup.scanned?.repos ?? null,
    } : { slug: area.slug, label: releaseSafeLabel(area.label, labelRules), scanned: false });
  }

  const docsResult = collectDocs({ root, now });
  const docCounts = {};
  for (const d of docsResult.docs) docCounts[d.status] = (docCounts[d.status] || 0) + 1;

  const cases = readJson(join(root, 'cra/cases.json'));
  const cra = cases === null
    ? { state: existsSync(join(root, 'cra/cases.json')) ? 'unreadable' : 'no case log — no Art. 14 cases opened' }
    : { state: 'present', open: (Array.isArray(cases?.cases) ? cases.cases : []).filter((c) => c.status !== 'closed').length };

  const issues = gatherIssues(root, now, { ambient });

  return { generatedAt: now.toISOString(), anchor, fleet, issues, docs: docsResult, docCounts, cra };
}

function issueSevCell(bySeverity) {
  return ['crit', 'high', 'med', 'low', 'unknown'].map((k) => `${k} ${bySeverity[k] ?? 0}`).join(' · ');
}

function sevCell(open) {
  const parts = ['crit', 'high', 'med', 'low'].map((k) => `${k} ${open[k] ?? 0}`);
  return parts.join(' · ');
}

export function renderMarkdown(s) {
  const L = [];
  L.push('# commitwork — project status');
  L.push('');
  L.push(`<!-- Generated by bin/projectstatus.mjs — do not hand-edit; re-run to refresh. -->`);
  L.push(`Generated ${s.generatedAt} at \`${s.anchor.sha}\` (${s.anchor.branch}${s.anchor.dirty ? ', dirty' : ''}). HTML twin (one-click PDF): \`reports/projectstatus.html\`.`);
  L.push('');
  L.push('## Fleet');
  L.push('');
  L.push('| Area | Scanned | Open findings | Rollup age | Freshness |');
  L.push('|---|---|---|---|---|');
  for (const a of s.fleet) {
    L.push(a.scanned
      ? `| ${a.label} | ${a.repos ?? '?'} repo(s) | ${sevCell(a.open)} | ${a.generatedAge} | ${a.freshness} |`
      : `| ${a.label} | — | **not scanned** | — | — |`);
  }
  L.push('');
  L.push('## Issues');
  L.push('');
  if (s.issues.state === 'absent') {
    L.push('no issue store (tracker not yet initialised — explicit uncertainty)');
  } else if (s.issues.state === 'error') {
    L.push(`**ISSUE STORE ERROR:** ${s.issues.message} — a broken store is not "no issues"; fix it (\`node bin/issue.mjs verify\`).`);
  } else {
    const i = s.issues;
    L.push(`Open **${i.open}** · claimed ${i.claimed} · blocked ${i.blocked} · unsatisfiable ${i.unsatisfiable ?? 0} · closed ${i.closed} · SLA breached **${i.slaBreached}** · suspect ${i.suspect}`);
    L.push('');
    L.push(`Severity (non-closed): ${issueSevCell(i.bySeverity)}`);
  }
  L.push('');
  L.push('## Documentation');
  L.push('');
  L.push(`Classes: 🟢 fresh · 🟠 needs updating · ⚪ unknown freshness — per \`bin/docs-doctor.mjs\` (max age ${s.docs.maxAgeDays}d).`);
  L.push('');
  L.push('| Status | Count |');
  L.push('|---|---|');
  for (const k of ['green', 'orange', 'grey', 'cycle', 'archived', 'generated']) {
    if (s.docCounts[k]) L.push(`| ${k} | ${s.docCounts[k]} |`);
  }
  const attention = s.docs.docs.filter((d) => d.status === 'orange' || d.status === 'grey');
  if (attention.length) {
    L.push('');
    L.push('Needs attention:');
    for (const d of attention) L.push(`- ${d.status === 'orange' ? '🟠' : '⚪'} \`${d.path}\` — ${d.reasons.join('; ')}`);
  }
  L.push('');
  L.push('## CRA');
  L.push('');
  L.push(s.cra.state === 'present' ? `Open Art. 14 cases: **${s.cra.open}**` : `${s.cra.state}.`);
  L.push('');
  return L.join('\n');
}

export function renderHtml(s) {
  const dot = (c) => `<span class="dot ${c === 'green' || c === 'orange' ? c : 'grey'}"></span>`;
  const fleetRows = s.fleet.map((a) => a.scanned
    ? `<tr><td>${a.label}</td><td>${a.repos ?? '?'}</td><td>${sevCell(a.open)}</td><td>${a.generatedAge}</td><td>${a.freshness}</td></tr>`
    : `<tr><td>${a.label}</td><td>—</td><td>${dot('grey')} not scanned <small>(explicit uncertainty)</small></td><td>—</td><td>—</td></tr>`).join('\n');
  const issuesBlock = s.issues.state === 'absent'
    ? `<p>${dot('grey')} no issue store <small>(tracker not yet initialised — explicit uncertainty)</small></p>`
    : s.issues.state === 'error'
      ? `<p>${dot('orange')} <b>ISSUE STORE ERROR:</b> ${esc(s.issues.message)} — a broken store is not "no issues"; fix it (<code>node bin/issue.mjs verify</code>).</p>`
      : `<p>Open <b>${s.issues.open}</b> · claimed ${s.issues.claimed} · blocked ${s.issues.blocked} · unsatisfiable ${s.issues.unsatisfiable ?? 0} · closed ${s.issues.closed} · SLA breached <b>${s.issues.slaBreached}</b> · suspect ${s.issues.suspect}</p>
<p class="mut">Severity (non-closed): ${issueSevCell(s.issues.bySeverity)}</p>`;
  const docRows = s.docs.docs.map((d) => {
    const c = d.status === 'green' ? 'green' : d.status === 'orange' ? 'orange' : d.status === 'grey' ? 'grey' : null;
    return `<tr><td>${c ? dot(c) : ''}${d.status}</td><td>${d.path}</td><td>${d.stamp ? 'verified ' + d.stamp.date : ''}${d.reasons.length ? d.reasons.join('; ') : ''}</td></tr>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>commitwork — project status</title>
${followerScript()}
<style>
${houseCss({ fonts: 'inline', weights: { sans: [400, 600], mono: [400] } })}
body{padding:2rem;max-width:70rem;margin-inline:auto}
h1{font-size:1.4rem}h1 b{color:var(--acc)}
table{margin:1rem 0}
small,.mut{color:var(--mut)}
.dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:.45em}
.dot.green{background:var(--live)}.dot.orange{background:var(--part)}.dot.grey{box-shadow:inset 0 0 0 1.5px var(--plan)}
button{background:var(--acc);color:var(--on-acc);border:0;border-radius:3px;padding:.5rem 1rem;font:600 .875rem var(--sans);cursor:pointer;float:right}
@media print{button{display:none}body{background:#fff;color:#1a1a1a;padding:0}:root{--line:#bbb;--mut:#555}}
</style></head><body>
<button onclick="window.print()" title="Print to PDF">Download PDF</button>
<h1>commit<b>w</b>ork — project status</h1>
<p class="mut">Generated ${s.generatedAt} at ${s.anchor.sha} (${s.anchor.branch}${s.anchor.dirty ? ', dirty' : ''}). Regenerate: <code>node bin/projectstatus.mjs</code>.</p>
<h2>Fleet</h2>
<table><tr><th>Area</th><th>Repos</th><th>Open findings</th><th>Rollup age</th><th>Freshness</th></tr>
${fleetRows}</table>
<h2>Issues</h2>
${issuesBlock}
<h2>Documentation</h2>
<p class="mut">${dot('green')}fresh &nbsp; ${dot('orange')}needs updating &nbsp; ${dot('grey')}unknown freshness — max age ${s.docs.maxAgeDays}d (bin/docs-doctor.mjs)</p>
<table><tr><th>Status</th><th>Doc</th><th>Note</th></tr>
${docRows}</table>
<h2>CRA</h2>
<p>${s.cra.state === 'present' ? `Open Art. 14 cases: <b>${s.cra.open}</b>` : s.cra.state + '.'}</p>
</body></html>\n`;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : repoRoot();
  // An explicit --root is a more specific statement than an exported CW_ISSUES; without it the
  // ambient override stands, so the no-arg invocation every schedule uses is unchanged.
  const s = gather({ root, ambient: rootIdx < 0 });
  const mdPath = projectStatusPathFor(root, { ambient: rootIdx < 0 });
  writeAtomic(mdPath, renderMarkdown(s));
  const outDir = join(root, 'reports');
  mkdirSync(outDir, { recursive: true });
  writeAtomic(join(outDir, 'projectstatus.html'), renderHtml(s));
  console.log(`projectstatus: wrote ${mdPath} + reports/projectstatus.html (docs: ${Object.entries(s.docCounts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}
