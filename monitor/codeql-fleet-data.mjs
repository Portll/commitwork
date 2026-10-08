#!/usr/bin/env node
/**
 * codeql-fleet-data — flatten a sweep batch's per-repo CodeQL SARIF output into one
 * panel-consumable JSON: <reportsRoot>/<the area's out>/codeql-fleet.json (served live by
 * admin/serve.mjs at /reports/codeql-fleet.json?project=… — a static file read from disk per
 * request, so no server restart is ever needed to pick up a regeneration).
 *
 * WHOSE DIRECTORY, AND WHICH BATCH?  Both were hardwired, and both were wrong.
 *  - OUT was a bare join(CW,'reports','clientA-monorepo',…) with no registry read, so EVERY area's
 *    fleet JSON landed in clientA's dir and the panel served it under ClientA's name.
 *  - the batch was "newest sweep-* on the machine", across ALL areas — the exact defect
 *    runtime-report.mjs fixed. Verified 2026-07-27: the newest batch was sweep-20260726201132
 *    (area client-d-remote) and this tool wrote `0 findings across 0/0 scanned services` into
 *    reports/clientA-monorepo/codeql-fleet.json. An empty success is the worst wrong answer a
 *    security panel can serve: ClientA read as scanned-and-clean while nothing of its own ran.
 *    That regex (/^sweep-\d{14}$/) also could not see a CURRENT batch at all — sweep.mjs names
 *    them sweep-<stamp>-<area> since 2026-07-26.
 *
 * NOW: OUT comes from area.mjs (the one resolver, CW_MONITOR_OUT first), and only batches that
 * PROVABLY cover this area are candidates. A batch predating sweep.mjs's `area`/`areaOut` manifest
 * fields has UNKNOWN scope — usable as a last resort (it may well be this area's data) but
 * LABELLED unknown, never claimed as this area's. A batch belonging to a different declared area
 * is never read. Inside a batch, repo dirs that resolve to another area are skipped and COUNTED
 * (an --all sweep's batch legitimately holds foreign repo dirs). No CodeQL SARIF in scope is
 * written out as coverage.scope 'none' with the reason — a named no-data state, not a silent zero.
 *
 * CodeQL files ONLY (codeql-java.sarif + codeql.sarif); semgrep/osv/trivy SARIFs are other
 * dimensions and are ignored here. Severity bucketing mirrors monitor/rollup.mjs _sarifCounts
 * EXACTLY (security-severity >=9 crit / >=7 high / >=4 med / else low; fallback to SARIF level)
 * so this view can never disagree with the rollup's sastCodeqlJava counts.
 *
 * usage:  node monitor/codeql-fleet-data.mjs [batchDir] [--area <slug>]
 *         default: the ambient area (CW_MONITOR_OUT, else the registry's primary) and the newest
 *         batch that provably covers it.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { registry, outDirFor, ambientArea, batchesForArea } from './area.mjs';
import { areaOf, areaBySlug, areaLabel } from './registry.mjs';
import { readSarif, ruleIndex } from './sarif-read.mjs'; // the one SARIF reader

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const REG = registry();
const CODEQL_FILES = ['codeql-java.sarif', 'codeql.sarif']; // CodeQL outputs only

// argv: one optional batch dir + an optional --area <slug>. Kept hand-rolled (zero deps).
const argv = process.argv.slice(2);
let areaFlag = null, batchArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--area') { areaFlag = argv[++i] || null; continue; }
  if (argv[i].startsWith('--area=')) { areaFlag = argv[i].slice('--area='.length); continue; }
  if (!batchArg && !argv[i].startsWith('-')) batchArg = argv[i];
}

// `batchArg` and `--area` were INDEPENDENT: naming a foreign batch with no --area still routed to
// the ambient area's out. An explicit --area still wins (that is the operator saying so); otherwise
// a NAMED batch's own manifest decides, and only an unnamed run falls back to ambient.
const batchArea = (() => {
  if (areaFlag || !batchArg || process.env.CW_MONITOR_OUT) return null;
  try {
    const bm = JSON.parse(readFileSync(join(resolve(batchArg), 'batch-manifest.json'), 'utf8'));
    return typeof bm.area === 'string' && bm.area ? bm.area : null;
  } catch { return null; }
})();
const OUT_DIR = outDirFor(areaFlag || batchArea, REG);   // 1. CW_MONITOR_OUT 2. --area 3. the batch's own area 4. ambient
const OUT = join(OUT_DIR, 'codeql-fleet.json');
// WHICH area is this file's? ambientArea() recovers it by matching OUT_DIR against the declared
// areas[] — which is the honest answer when CW_MONITOR_OUT redirected us. An explicit --area is
// authoritative otherwise, because a standalone area (a repo that is its own area, e.g. client-d) has
// no areas[] block to match and would otherwise be mislabelled as the primary area.
const AREA = ((areaFlag || batchArea) && !process.env.CW_MONITOR_OUT)
  ? { slug: (areaFlag || batchArea), label: areaLabel(areaFlag || batchArea, REG), dir: OUT_DIR, declared: !!areaBySlug(areaFlag || batchArea, REG) }
  : ambientArea(REG, OUT_DIR);

const hasCodeql = (dir) => CODEQL_FILES.some((f) => existsSync(join(dir, f)));
const repoDirs = (batch) => {
  try { return readdirSync(batch).sort().map((d) => join(batch, d)).filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } }); }
  catch { return []; }
};

// WHICH batch is "this area's CodeQL"?  -> { dir, scope: 'explicit'|'area'|'unknown'|'none', note }
// Same selection discipline as monitor/runtime-report.mjs:39 — provable coverage first, unverified
// scope only as a labelled last resort, another area's batch never.
function pickBatch() {
  if (batchArg) {
    const dir = resolve(batchArg);
    if (!existsSync(dir)) { console.error(`[codeql-fleet-data] batch dir does not exist: ${dir}`); process.exit(1); }
    // as passed: the operator named this batch, so its repo dirs are taken as given (no area
    // filter) and the report says the scope was not verified rather than asserting coverage.
    return { dir, scope: 'explicit', note: 'batch passed on the command line — scope not verified' };
  }
  const { covers, unknown } = batchesForArea({ slug: AREA.slug, dir: OUT_DIR }, REG); // both newest-first
  for (const b of covers) if (repoDirs(b.dir).some(hasCodeql)) return { dir: b.dir, scope: 'area', note: `${b.name} declares area ${b.manifest.area || '(dir match)'}` };
  for (const b of unknown) if (repoDirs(b.dir).some(hasCodeql)) return { dir: b.dir, scope: 'unknown', note: `${b.name} predates batch-manifest area recording — its scope is unverified` };
  // Nothing in scope carries a CodeQL SARIF. Still name the newest in-scope batch (when there is
  // one) so the reader can see WHICH batch was inspected and that CodeQL simply did not run in it.
  const newest = covers[0] || null;
  return { dir: newest ? newest.dir : null, scope: 'none',
    note: newest ? `${newest.name} covers ${AREA.slug} but carries no CodeQL SARIF`
      : `no sweep batch covering ${AREA.slug} under ${REG.reportsRoot || 'reports'}/` };
}

const src = pickBatch();
const batchDir = src.dir;

// lifecycle flags so superseded (rollback-standby) rows can be labelled, matching the fleet grid
const RETIRED = new Set(REG.exclude || []);
const SUPERSEDED = new Set(Object.entries(REG.lifecycle || {}).filter(([, l]) => l.state === 'superseded').map(([n]) => n));
const lifecycleOf = (n) => (SUPERSEDED.has(n) ? 'superseded' : RETIRED.has(n) ? 'retired' : 'active');

// severity bucketing — kept byte-for-byte consistent with monitor/rollup.mjs _sarifCounts
function bucket(rule, res) {
  const ss = parseFloat(((rule.properties && rule.properties['security-severity']) ?? (res.properties && res.properties['security-severity'])) ?? NaN);
  if (!Number.isNaN(ss)) return { sev: ss >= 9 ? 'crit' : ss >= 7 ? 'high' : ss >= 4 ? 'med' : 'low', score: ss };
  const lvl = res.level || (rule.defaultConfiguration && rule.defaultConfiguration.level) || 'warning';
  return { sev: lvl === 'error' ? 'high' : lvl === 'warning' ? 'med' : 'low', score: null };
}

const findings = [];
const perService = {};
let foreignDirs = 0;
const voidArtifacts = []; // present-but-unusable SARIFs — a coverage gap, never a scanned service
for (const svc of (batchDir ? readdirSync(batchDir).sort() : [])) {
  const dir = join(batchDir, svc);
  try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
  // A --all sweep's batch covers the primary area but holds foreign repo dirs too; the per-repo
  // area check is what keeps another area's CodeQL out of this area's fleet JSON (the same guard
  // runtime-report.mjs:52 applies). Skipped dirs are COUNTED and printed — never dropped silently.
  // An explicitly passed batch is exempt: the operator named it, and filtering their choice would
  // quietly return less than they asked for.
  if (src.scope !== 'explicit' && areaOf(svc, REG) !== AREA.slug) { foreignDirs++; continue; }
  let scanned = false;
  for (const file of CODEQL_FILES) {
    // Only state 'ok' marks a service scanned; other present states are counted and printed, never dropped silently
    const rr = readSarif(join(dir, file));
    if (rr.state === 'absent') continue;
    if (rr.state !== 'ok') { voidArtifacts.push(`${svc}/${file}: ${rr.state} — ${rr.reason}`); continue; }
    scanned = true;
    for (const run of rr.runs) {
      const rules = ruleIndex(run);
      for (const res of run.results) {
        const rule = rules[res.ruleId] || {};
        const { sev, score } = bucket(rule, res);
        const loc = ((res.locations || [])[0] || {}).physicalLocation || {};
        const uri = (loc.artifactLocation || {}).uri || '';
        const line = (loc.region || {}).startLine || null;
        findings.push({
          service: svc, lifecycle: lifecycleOf(svc), sarif: file,
          ruleId: res.ruleId || '?', ruleName: (rule.properties && rule.properties.name) || '',
          severity: sev, securitySeverity: score,
          message: ((res.message && res.message.text) || '').slice(0, 300),
          file: uri, line,
        });
      }
    }
  }
  if (scanned) {
    const t = perService[svc] || (perService[svc] = { service: svc, lifecycle: lifecycleOf(svc), crit: 0, high: 0, med: 0, low: 0, total: 0 });
    for (const f of findings) if (f.service === svc) { t[f.severity]++; t.total++; }
  }
}

const RANK = { crit: 4, high: 3, med: 2, low: 1 };
findings.sort((a, b) => (RANK[b.severity] - RANK[a.severity]) || a.service.localeCompare(b.service) || String(a.ruleId).localeCompare(String(b.ruleId)));

// The file SAYS what it covers. scope 'area' is the only value that claims these counts are this
// area's; 'unknown' means the source batch carries no area dimension (pre-2026-07-26 sweeps) and
// must not be read as a verdict on this area; 'none' means no CodeQL SARIF was in scope at all —
// which is why a 0 here is a coverage void, NOT a clean fleet.
const coverage = {
  area: AREA.slug, areaLabel: AREA.label, scope: src.scope, basis: src.note,
  areaDeclared: AREA.declared, // false ⇒ OUT is not a declared area (e.g. a scratch CW_MONITOR_OUT)
  skippedForeignDirs: foreignDirs,
  label: src.scope === 'area' ? (AREA.label || AREA.slug)
    : src.scope === 'explicit' ? 'as passed (scope not verified)'
      : src.scope === 'none' ? 'NO CODEQL SCAN IN SCOPE — not a clean result'
        : 'UNKNOWN SCOPE — source batch carries no area',
};
const out = {
  generated: new Date().toISOString(),
  batch: batchDir ? basename(batchDir) : null,
  area: AREA.slug,
  coverage,
  scanned: Object.keys(perService).length,
  voidArtifacts, // SARIFs present but not scans — each entry names the file, its state, and why
  totals: findings.reduce((a, f) => (a[f.severity]++, a.total++, a), { crit: 0, high: 0, med: 0, low: 0, total: 0 }),
  perService: Object.values(perService).sort((a, b) => (b.total - a.total) || a.service.localeCompare(b.service)),
  findings,
};
mkdirSync(OUT_DIR, { recursive: true }); // an area that has never been swept has no report dir yet
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`[codeql-fleet-data] ${batchDir ? basename(batchDir) : '(no batch)'} → ${out.totals.total} findings across ${out.perService.filter((s) => s.total).length}/${out.scanned} scanned services → ${OUT}`);
// scope line: say which area this covers, or say plainly that it is a void / unattributed
if (voidArtifacts.length) console.log(`  VOID artifacts (present, not scans — not counted as clean):\n${voidArtifacts.map((v) => `    ${v}`).join('\n')}`);
const skipped = foreignDirs ? ` · ${foreignDirs} repo dir(s) skipped as another area's` : '';
console.log(src.scope === 'area' ? `  scope: ${coverage.label} · ${coverage.basis}${skipped}`
  : src.scope === 'none' ? `  scope: ${coverage.label} · ${coverage.basis} — a 0 here is a coverage void for ${AREA.label || AREA.slug}, not a clean fleet`
    : `  scope: ${coverage.label} · ${coverage.basis} — NOT attributed to ${AREA.label || AREA.slug}${skipped}`);
