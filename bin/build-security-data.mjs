#!/usr/bin/env node
/*
 * build-security-data.mjs — Layer 2 of the security report pipeline.
 *
 *   commitwork scan/audit  ->  rollup.json        (Layer 1: the numbers, per-repo)
 *   >>> THIS <<<           ->  security-data.json  (normalised fleet/surface/repo model)
 *                          ->  security-counts.md  (injectable Markdown partial)
 *                          ->  in-place injection into delimited blocks of report .md
 *   render-report.mjs      ->  *.html              (Layer 3: theming)
 *
 * Counts are machine-generated so they cannot drift from the scan of record; editorial
 * text lives in an annotations sidecar so it survives regeneration.
 *
 *   node bin/build-security-data.mjs \
 *     --rollup   <path/to/rollup.json> \
 *     --annot    <path/to/security-annotations.json> \
 *     --out-data <path/to/security-data.json> \
 *     --out-md   <path/to/security-counts.md> \
 *     [--inject  <report.md> ...]
 *
 * Injection: any file passed to --inject that contains a delimited block
 *   <!-- security:counts:start -->  ...  <!-- security:counts:end -->
 * has that block's body replaced by the generated table. Files without the
 * delimiters are left untouched (and reported), so adoption is opt-in per report.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { areaAnnotationsDirFor } from '../monitor/store-paths.mjs';

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
function opt(name, fallback = null) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}
function optMulti(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name) out.push(args[i + 1]);
  return out;
}
const rollupPath = opt('--rollup');
// Editorial sidecar is per-area (reports/<out>/rollup.json -> security-annotations.<out>.json in the
// private dir, CW_SECURITY_ANNOTATIONS_DIR overrides), falling back to the shared project-neutral
// defaults in monitor/; --annot overrides both. A per-area file carries one project's remediation
// history, so it is a private record; the shared defaults name no project and stay public.
const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED_ANNOT = join(HERE, '..', 'monitor', 'security-annotations.json');
const areaName = rollupPath ? basename(dirname(rollupPath)) : '';
const AREA_ANNOT = areaName ? join(areaAnnotationsDirFor(join(HERE, '..')), `security-annotations.${areaName}.json`) : '';
const annotPath = opt('--annot') || (AREA_ANNOT && existsSync(AREA_ANNOT) ? AREA_ANNOT : SHARED_ANNOT);
const outDataPath = opt('--out-data');
const outMdPath = opt('--out-md');
const injectPaths = optMulti('--inject');

if (!rollupPath || !outDataPath || !outMdPath) {
  console.error('usage: build-security-data.mjs --rollup <rollup.json> --out-data <security-data.json> --out-md <security-counts.md> [--annot <a.json>] [--inject <report.md> ...]');
  process.exit(1);
}

// ---- inputs ---------------------------------------------------------------
const rollup = JSON.parse(readFileSync(rollupPath, 'utf8'));
const annot = annotPath && existsSync(annotPath)
  ? JSON.parse(readFileSync(annotPath, 'utf8'))
  : {};

const SEV = ['crit', 'high', 'med', 'low'];
const zero = () => ({ crit: 0, high: 0, med: 0, low: 0, kev: 0, cves: 0 });

// map a scanner tool id -> which surface it reports on
const SURFACE_OF_TOOL = annot.toolSurfaces || {
  osv: 'jvm', trivy: 'jvm', 'trivy-jvm': 'jvm', 'deps-jvm': 'jvm',
  'npm-audit': 'npm', npm: 'npm', retire: 'npm', socket: 'npm',
  semgrep: 'sast', codeql: 'sast',
  gitleaks: 'secrets', trufflehog: 'secrets',
};
const normSev = (s) => {
  s = String(s || '').toLowerCase();
  if (s.startsWith('crit')) return 'crit';
  if (s.startsWith('high')) return 'high';
  if (s.startsWith('med') || s === 'moderate') return 'med';
  if (s.startsWith('low')) return 'low';
  return null;
};

// ---- normalise ------------------------------------------------------------
const fleet = {
  repos: rollup.totals?.repos ?? (Array.isArray(rollup.repos) ? rollup.repos.length : 0),
  crit: rollup.totals?.crit ?? 0,
  high: rollup.totals?.high ?? 0,
  med: rollup.totals?.med ?? 0,
  low: rollup.totals?.low ?? 0,
  kev: rollup.totals?.kev ?? 0,
  cves: rollup.totals?.cves ?? 0,
};

// surface + per-repo rollup from the detailed findings
const surfaces = {};
const byRepo = [];
const toolsSeen = new Set();   // for toolSurfaceCoverage — which declared mappings were reachable
const repoList = Array.isArray(rollup.repos) ? rollup.repos : [];
for (const repo of repoList) {
  const rc = zero();
  const findings = Array.isArray(repo.findings) ? repo.findings : [];
  for (const f of findings) {
    if (f.tool) toolsSeen.add(f.tool);
    const sev = normSev(f.severity);
    if (!sev) continue;
    const surf = SURFACE_OF_TOOL[f.tool] || 'other';
    surfaces[surf] ??= zero();
    surfaces[surf][sev]++;
    surfaces[surf].cves++;
    if (f.kev) surfaces[surf].kev++;
    rc[sev]++;
    rc.cves++;
    if (f.kev) rc.kev++;
  }
  // noscan = in-scope checks with no trustworthy output; counted so coverage voids stay visible.
  const noscan = Number.isInteger(repo.noscan) ? repo.noscan : 0;
  byRepo.push({ name: repo.name, worst: repo.worst ?? null, ...rc, noscan,
    findings: findings.map((f) => ({ id: f.id, tool: f.tool, severity: normSev(f.severity),
      cvss: f.cvss ?? null, package: f.package ?? null, kev: !!f.kev, status: f.status ?? null })) });
}
// Fleet-level coverage-void total — "0/0/0" must never read as "fully scanned clean".
fleet.noscan = byRepo.reduce((n, r) => n + (r.noscan || 0), 0);

// Ensure the surfaces the report cares about always exist (npm may be clean => 0s).
for (const s of annot.surfaceOrder || ['npm', 'jvm']) surfaces[s] ??= zero();

const data = {
  generated: rollup.generated || null,
  source: rollup.source || rollupPath,
  scanner: 'commitwork',
  fleet,
  surfaces,
  byRepo,
  // Report unmatched tool->surface mappings — an unmatched surface must not look like zero findings.
  toolSurfaceCoverage: {
    matched: [...toolsSeen].filter((t) => t in SURFACE_OF_TOOL).sort(),
    declaredButUnseen: Object.keys(SURFACE_OF_TOOL).filter((t) => !toolsSeen.has(t)).sort(),
    seenButUndeclared: [...toolsSeen].filter((t) => !(t in SURFACE_OF_TOOL)).sort(),
  },
};
writeFileSync(outDataPath, JSON.stringify(data, null, 2) + '\n');

// ---- render the injectable table -----------------------------------------
// Annotations drive row labels + editorial State text; {crit}/{high}/{med}/{low}/{kev}
// tokens are filled from live counts. Default rows are tokens only — no editorial claim.
const rows = annot.rows || [
  { surface: 'npm', label: 'npm / JavaScript', state: '{high}H / {med}M' },
  { surface: 'jvm', label: 'JVM / Maven', state: '{high}H / {med}M' },
];
const totalLabel = annot.totalLabel || 'Deployed total';
const totalState = annot.totalState || 'stabilised';

const fill = (tpl, c) => String(tpl).replace(/\{(crit|high|med|low|kev|cves)\}/g, (_, k) => c[k]);
const totals = zero();
const line = (label, c, state, bold = false) => {
  const b = (v) => (bold ? `**${v}**` : `${v}`);
  return `| ${bold ? `**${label}**` : label} | ${b(c.crit)} | ${b(c.high)} | ${b(c.med)} | ${b(c.kev)} | ${bold ? `**${state}**` : state} |`;
};

// A row may declare what its prose `asserts`; when the scan disagrees, the assertion loses
// and the cell says so. Token-only states cannot contradict the counts.
const contradictions = [];
const stateFor = (r, c) => {
  const rendered = fill(r.state, c);
  if (!r.asserts) return rendered;
  const wrong = Object.entries(r.asserts).filter(([k, v]) => c[k] !== v);
  if (!wrong.length) return rendered;
  const claim = wrong.map(([k, v]) => `${k}=${v}`).join(', ');
  const live = wrong.map(([k]) => `${k}=${c[k]}`).join(', ');
  contradictions.push(`${r.surface}: prose asserts ${claim}, scan of record shows ${live}`);
  return `⚠ STALE PROSE — "${rendered}" asserts ${claim}, but this scan shows ${live}`;
};

const bodyLines = rows.map((r) => {
  const c = surfaces[r.surface] || zero();
  for (const k of [...SEV, 'kev', 'cves']) totals[k] += c[k];
  return line(r.label, c, stateFor(r, c));
});

const table = [
  '| Surface | Critical | High | Medium | KEV | State |',
  '|---|---|---|---|---|---|',
  ...bodyLines,
  line(totalLabel, totals, stateFor({ surface: '(total)', state: totalState, asserts: annot.totalAsserts }, totals), true),
].join('\n');

const stampNote = data.generated
  ? `_Machine-generated from the \`commitwork\` scan of record (${data.generated}). Do not hand-edit — regenerate via \`build-security-data.mjs\`._`
  : '_Machine-generated from the `commitwork` scan of record. Do not hand-edit — regenerate via `build-security-data.mjs`._';

const partial = `<!-- security:counts:start -->\n${table}\n\n${stampNote}\n<!-- security:counts:end -->\n`;
writeFileSync(outMdPath, partial);

// ---- injection ------------------------------------------------------------
// Two persistent, render-safe mechanisms (render-report.mjs strips HTML comments,
// so the markers vanish from the themed HTML but survive in the .md for re-runs):
//   1. block : <!-- security:counts:start -->…<!-- security:counts:end -->  -> the table
//   2. inline: <!--sec:PATH-->value<!--/sec-->  -> a single value from security-data.json
//              e.g. <!--sec:fleet.high-->0<!--/sec--> or <!--sec:surfaces.jvm.med-->3<!--/sec-->
const BLOCK_RE = /<!-- security:counts:start -->[\s\S]*?<!-- security:counts:end -->/;
const INLINE_RE = /<!--sec:([\w.]+)-->[\s\S]*?<!--\/sec-->/g;
const resolve = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), data);

const injected = [], missing = [];
for (const p of injectPaths) {
  if (!existsSync(p)) { missing.push(`${p} (not found)`); continue; }
  const src = readFileSync(p, 'utf8');
  const hasBlock = BLOCK_RE.test(src);
  const hasInline = /<!--sec:[\w.]+-->/.test(src);
  if (!hasBlock && !hasInline) { missing.push(`${p} (no markers)`); continue; }

  let next = src;
  if (hasBlock) next = next.replace(BLOCK_RE, partial.trimEnd());
  let unresolved = 0;
  next = next.replace(INLINE_RE, (m, path) => {
    const v = resolve(path);
    if (v == null || typeof v === 'object') { unresolved++; return m; }
    return `<!--sec:${path}-->${v}<!--/sec-->`;
  });

  const tag = unresolved ? ` (${unresolved} unresolved token${unresolved > 1 ? 's' : ''})` : '';
  if (next !== src) { writeFileSync(p, next); injected.push(p + tag); }
  else injected.push(`${p} (already current)${tag}`);
}

// ---- report ---------------------------------------------------------------
console.log(`security-data.json: fleet ${fleet.crit}C/${fleet.high}H/${fleet.med}M/${fleet.low}L, ${fleet.kev} KEV across ${fleet.repos} repos`);
console.log(`surfaces: ${Object.entries(surfaces).map(([s, c]) => `${s} ${c.crit}C/${c.high}H/${c.med}M`).join(' · ')}`);
console.log(`annotations: ${annotPath === SHARED_ANNOT ? 'shared defaults' : `per-area (${basename(annotPath)})`}`);
const unseen = data.toolSurfaceCoverage.declaredButUnseen;
if (unseen.length) console.log(`toolSurfaces: ${data.toolSurfaceCoverage.matched.join(', ') || 'none'} matched; `
  + `${unseen.length} declared and unseen in this scan (${unseen.join(', ')}) — those surfaces are UNMEASURED here, not zero`);
if (data.toolSurfaceCoverage.seenButUndeclared.length) console.log(`toolSurfaces: ${data.toolSurfaceCoverage.seenButUndeclared.join(', ')} `
  + "appeared in the scan with no declared surface — counted under 'other'");
if (contradictions.length) {
  // Non-zero exit so a pipeline notices; artifacts still written — the table carries the correction.
  console.error(`\nbuild-security-data: ${contradictions.length} editorial claim(s) contradicted by the scan of record:`);
  for (const c of contradictions) console.error(`  - ${c}`);
  console.error(`  Fix the prose in ${basename(annotPath)} (or its asserts, if the claim was mis-stated).`);
  process.exitCode = 3;
}
console.log(`wrote ${outDataPath} + ${outMdPath}`);
if (injected.length) console.log(`injected: ${injected.join(', ')}`);
if (missing.length) console.log(`skipped: ${missing.join(', ')}`);
