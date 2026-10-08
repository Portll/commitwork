#!/usr/bin/env node
/*
 * attach-program.mjs — STEP C: replace meta.securityProgram's scan-derived fields with the live
 * commitwork monitor rollup. Runs last (after attach-security.mjs, before generate.mjs); additive +
 * idempotent. Curated narrative/config from migration-state.json is preserved; headings final here.
 *
 *   node attach-program.mjs            # default rollup path (env COMMITWORK_ROLLUP overrides)
 *   COMMITWORK_ROLLUP=/abs/rollup.json node attach-program.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAP_ROOT ? process.env.MAP_ROOT : __dirname; // per-project data root (commitwork/map/data/<project>)
const DATA = join(ROOT, 'data.json');
const STATE = join(ROOT, 'migration-state.json');

// ---- locate the live rollup (single source of the live numbers) ----
const ROLLUP = process.env.COMMITWORK_ROLLUP
  ? resolve(process.env.COMMITWORK_ROLLUP)
  : resolve(__dirname, 'cve-history', 'rollup.json'); // frozen snapshot; COMMITWORK_ROLLUP overrides with a live path
if (!existsSync(ROLLUP)) {
  console.error(`attach-program: FATAL — live rollup not found at ${ROLLUP}`);
  console.error('  Run the commitwork monitor first (node monitor/rollup.mjs) or set COMMITWORK_ROLLUP.');
  console.error('  Refusing to keep stale security numbers on the map.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA, 'utf8'));
const state = JSON.parse(readFileSync(STATE, 'utf8'));
const roll = JSON.parse(readFileSync(ROLLUP, 'utf8'));
const T = roll.totals || {};
const allF = (roll.repos || []).flatMap(r => (r.findings || []).map(f => ({ ...f, repo: r.name })));

const SEV_UP = { crit: 'CRIT', high: 'HIGH', med: 'MED', low: 'LOW', critical: 'CRIT', medium: 'MED' };
const SEV_RANK = { CRIT: 4, HIGH: 3, MED: 2, LOW: 1 };
const up = s => SEV_UP[String(s || '').toLowerCase()] || 'LOW';

// ---- scan date: prefer the sweep batch stamp in rollup.source, else the generated stamp ----
const mBatch = /sweep-(\d{4})(\d{2})(\d{2})/.exec(roll.source || '');
const scanDate = mBatch ? `${mBatch[1]}-${mBatch[2]}-${mBatch[3]}` : String(roll.generated || '').slice(0, 10);
const rolledUp = String(roll.generated || '').slice(0, 10);

// ---- KEV, grouped by DISTINCT CVE (honest: 1 exploited vuln can hit N repos) ----
const kevById = new Map();
for (const f of allF.filter(f => f.kev)) {
  const g = kevById.get(f.id) || { cve: f.id, package: f.package || '', severity: 'LOW', epss: 0, repos: new Set() };
  if (SEV_RANK[up(f.severity)] > SEV_RANK[g.severity]) g.severity = up(f.severity);
  if ((f.epss || 0) > g.epss) g.epss = f.epss || 0;
  if (!g.package && f.package) g.package = f.package;
  g.repos.add(f.repo);
  kevById.set(f.id, g);
}
const kev = [...kevById.values()]
  .sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (b.epss - a.epss))
  .map(g => ({ cve: g.cve, package: g.package, severity: g.severity, epss: +g.epss.toFixed(3), repos: [...g.repos].sort() }));
const kevFindingCount = allF.filter(f => f.kev).length; // == totals.kev (finding-level, not distinct)

// ---- top remediation, grouped by package (mirrors monitor/rollup.mjs rank: KEV -> sev -> EPSS -> blast) ----
const pkgMap = new Map();
for (const f of allF) {
  const key = f.package || f.id;
  const g = pkgMap.get(key) || { package: key, severity: 'LOW', ids: new Set(), repos: new Set(), kev: false, epss: 0, fix: '' };
  if (SEV_RANK[up(f.severity)] > SEV_RANK[g.severity]) g.severity = up(f.severity);
  g.ids.add(f.id); g.repos.add(f.repo);
  if (f.kev) g.kev = true;
  if ((f.epss || 0) > g.epss) g.epss = f.epss || 0;
  if (!g.fix) g.fix = f.fixed || (f.advisory ? 'see advisory' : '');
  pkgMap.set(key, g);
}
const topRemediation = [...pkgMap.values()]
  .sort((a, b) => (b.kev - a.kev) || (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (b.epss - a.epss) || (b.repos.size - a.repos.size))
  .slice(0, 8)
  .map(g => ({ package: g.package, severity: g.severity, cves: g.ids.size, repos: g.repos.size, kev: g.kev, epss: +g.epss.toFixed(3), fix: g.fix || 'upgrade to patched' }));

// ---- preserve curated narrative/config from whatever build-data seeded (migration-state.json) ----
const prev = data.meta.securityProgram || {};
const epssEnriched = allF.filter(f => f.epss != null).length;
// Provenance label: the area declares its own; failing that the slug IS the area (map/data/<slug>).
const areaLabel = (state.meta && state.meta.areaLabel) || basename(ROOT);

const program = {
  ...prev,                                   // monitor{}, scanners[], prioritisation, secrets{}, historicBaseline{}
  asOf: scanDate,
  generatedAt: roll.generated || null,
  rolledUpOn: rolledUp,
  source: `commitwork monitor · ${areaLabel} · ${(roll.source || '').split('/').slice(-1)[0] || 'sweep'} · scanned ${scanDate}`,
  cvePosture: {
    surface: (prev.cvePosture && prev.cvePosture.surface) || 'npm / JS supply-chain (commitwork full monorepo sweep)',
    repos: T.repos || 0,
    total: T.cves || 0,
    crit: T.crit || 0,
    high: T.high || 0,
    med: T.med || 0,
    low: T.low || 0,
    kev: T.kev || 0,            // finding-level count (what the sweep flags; a vuln in N repos counts N)
    kevCves: kev.length,        // DISTINCT exploited vulnerabilities
    epssEnrichedCves: epssEnriched,
  },
  kev,
  topRemediation,
};

data.meta.securityProgram = program;
// mirror onto meta.security.program (attach-security already ran and captured the pre-live value)
data.meta.security = data.meta.security || {};
data.meta.security.program = program;

// ---- headings: migration-state.json is the source of truth; this step is the final authority ----
if (state.meta && state.meta.title) data.meta.title = state.meta.title;
if (state.meta && state.meta.subtitle) data.meta.subtitle = state.meta.subtitle;
data.meta.asOf = scanDate;

writeFileSync(DATA, JSON.stringify(data, null, 1));

console.log('STEP C — program attach complete -> data.json');
console.log('  live rollup:', ROLLUP.replace(process.env.HOME || '~', '~'));
console.log('  posture:', `${program.cvePosture.total} CVEs · ${program.cvePosture.crit}C / ${program.cvePosture.high}H / ${program.cvePosture.med}M / ${program.cvePosture.low}L`,
  `· KEV ${program.cvePosture.kev} findings = ${program.cvePosture.kevCves} distinct vuln(s) · ${program.cvePosture.epssEnrichedCves} EPSS · ${program.cvePosture.repos} repos`);
console.log('  KEV:', kev.map(k => `${k.package} ${k.cve} (${k.repos.length} repo${k.repos.length === 1 ? '' : 's'}, EPSS ${Math.round(k.epss * 100)}%)`).join('; ') || 'none');
console.log('  top remediation:', topRemediation.slice(0, 4).map(t => `${t.severity} ${t.package}${t.kev ? ' KEV' : ''}`).join(', '));
console.log('  asOf:', scanDate, '| historicBaseline:', prev.historicBaseline ? `${prev.historicBaseline.crit}C/${prev.historicBaseline.high}H/${prev.historicBaseline.cves} (${prev.historicBaseline.label})` : 'none');
