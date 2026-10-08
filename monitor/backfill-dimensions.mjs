#!/usr/bin/env node
// commitwork monitor — dimension history backfill (history/corrected/dimensions/).
// The slice timeline only ever ingested lockfile-level osv+npm. The other scan dimensions
// (JVM fat-jar, container images, CodeQL, runtime DAST/BOLA/TLS) were run and reported
// out-of-band; their artifacts survive on disk. This derives dated, cited snapshots per
// dimension so the corrected timeline can show them — original scan dates, original numbers,
// no invention. Idempotent; re-run any time new report dirs appear.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadRegistry } from './registry.mjs';
import { outDirFor, ambientArea } from './area.mjs'; // THE OUT resolver — never re-derive the chain
import { readSarif, ruleIndex } from './sarif-read.mjs'; // the one SARIF reader

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// DEGRADE ON THE READ, REFUSE ON THE ROUTE. This is a one-off, idempotent backfill — "re-run any
// time new report dirs appear" — that only ever ADDS optional dimension lanes
// (jvm/images/codeql/runtime); the dashboards already render those as "no data" when absent
// (timeline2.mjs's dimKpi). So a registry that will not load is still survivable at import: the
// failure is named on stderr AND stamped into every file this script writes (see the write loop at
// the bottom), never a bare `catch {}` that leaves no trace.
//
// What is NOT survivable is the OUT it used to degrade to. That was
// `REG.monitorOutput || 'clientA-monorepo'` — so the answer to "the registry is broken, where do I
// write?" was one customer's report directory, and a backfill run on a machine with a bad registry
// silently wrote another project's dimension history into clientA's. There is no honest default
// here: with no resolvable area there is no directory this tool is entitled to. It exits with the
// reason. CW_MONITOR_OUT remains the escape hatch, and is checked first by outDirFor.
let REG = { reportsRoot: 'reports' };
let registryUnavailable = null;
try { REG = loadRegistry(); }
catch (e) {
  registryUnavailable = e.message;
  console.error(`backfill-dimensions: registry unavailable, degrading to defaults (${e.message})`);
}
const OUT = (() => {
  try { return outDirFor(null, REG); }
  catch (e) { console.error(`backfill-dimensions: ${e.message}`); process.exit(2); }
})();
const dimDir = join(OUT, 'history', 'corrected', 'dimensions');
const R = join(CW, 'reports');
// canonical historic store — commitwork-local since the 2026-07-26 docs consolidation
// (was a machine-bound clientA-us-launch path; CW_CVEHIST overrides). Keyed by area SLUG, not by
// the out dir: map/data/ is slug-space (map/data/<slug>/, /map/<slug>) and the two differ for the
// fleet. Was the literal 'clientA', which fed one area's CVE history into every area's backfill.
const AREA = ambientArea(REG, OUT);
if (!process.env.CW_CVEHIST && (!AREA.slug || !AREA.declared)) {
  console.error(`backfill-dimensions: ${AREA.slug && !AREA.declared
    ? `'${OUT}' matches no declared area, so map/data/${AREA.slug}/cve-history would be another project's`
    : 'cannot name the area this output dir belongs to, so map/data/<slug>/cve-history is unresolvable'}`
    + ' — declare an area in monitor/projects.json, or set CW_CVEHIST.');
  process.exit(2);
}
const CVEHIST = process.env.CW_CVEHIST
  ? resolve(process.env.CW_CVEHIST)
  : join(CW, 'map', 'data', AREA.slug, 'cve-history');
mkdirSync(dimDir, { recursive: true });

const sevMap = (o) => ({ crit: o.CRITICAL || 0, high: o.HIGH || 0, med: o.MEDIUM || 0, low: o.LOW || 0 });
const tot = (f) => f.crit + f.high + f.med + f.low;

// ---------- helpers ----------
function mdTable(path, nameRe) {
  // parse "| name | c | h | m | l | total |" rows from an index.md
  let md; try { md = readFileSync(path, 'utf8'); } catch { return null; }
  const rows = {};
  let fleet = null;
  const fm = md.match(/(?:Fleet|Deployed) totals?:\s*\*{0,2}(\d+)\s*CRITICAL\s*·\s*(\d+)\s*HIGH\s*·\s*(\d+)\s*MEDIUM\s*·\s*(\d+)\s*LOW/i);
  if (fm) fleet = { crit: +fm[1], high: +fm[2], med: +fm[3], low: +fm[4] };
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*\[?([^|\]]+?)\]?(?:\([^)]*\))?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
    if (m && (!nameRe || nameRe.test(m[1].trim()))) rows[m[1].trim()] = { crit: +m[2], high: +m[3], med: +m[4], low: +m[5] };
  }
  const dm = md.match(/scanned\s+(\d{4}-\d{2}-\d{2})/);
  return { rows, fleet, scanned: dm ? dm[1] : null };
}
function tallyTrivyDir(dir) {
  const perRepo = {}; const fleet = { crit: 0, high: 0, med: 0, low: 0 };
  let names = []; try { names = readdirSync(dir); } catch { return null; }
  for (const f of names.filter((x) => x.endsWith('.trivy.json'))) {
    let d; try { d = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    const c = { crit: 0, high: 0, med: 0, low: 0 };
    for (const r of d.Results || []) for (const v of r.Vulnerabilities || []) {
      const k = { CRITICAL: 'crit', HIGH: 'high', MEDIUM: 'med', LOW: 'low' }[v.Severity]; if (k) { c[k]++; fleet[k]++; }
    }
    perRepo[f.replace('.trivy.json', '')] = c;
  }
  return { perRepo, fleet };
}

// ---------- JVM dimension ----------
const jvm = { dimension: 'jvm', note: 'Fat-jar / gradle-lockfile transitive CVE scans (Trivy). The deps timeline was blind to these for the clones era (no lockfiles) — jvm-rescan/index.md documents the false-clean.', snapshots: [] };
// cve-history ladder (frozen, authoritative for the modernization waves)
try {
  const ch = JSON.parse(readFileSync(join(CVEHIST, 'index.json'), 'utf8'));
  for (const s of ch.snapshots || []) {
    if (s.scope && s.scope !== 'jvm') continue; // image entries feed the images lane; scope:'deps' entries are the timeline's own data synced INTO the map — never re-import them
    jvm.snapshots.push({ date: (s.ts || '').replace(/T(\d{2})-(\d{2})-(\d{2})-\d+Z/, 'T$1:$2:$3Z'), event: s.event, fleet: { ...sevMap(s.bySeverity || {}), total: s.total ?? null, uniqueCves: s.uniqueCves ?? null }, source: `modernization-map/cve-history/${s.dir || ''}`, method: 'trivy fat-jar (rebuilt from committed HEAD)' });
  }
} catch (e) { jvm.snapshots.push({ error: `cve-history unreadable: ${e.message}` }); }
// 06-27 per-service rescan
const j0627 = mdTable(join(R, 'jvm-rescan', 'index.md'), /^(gs|sqx)-/);
if (j0627) jvm.snapshots.push({ date: j0627.scanned || '2026-06-27', event: 'jvm-rescan (per-service, clones-era jars)', fleet: { ...j0627.fleet, total: tot(j0627.fleet) }, perRepo: j0627.rows, source: 'reports/jvm-rescan/index.md', method: 'trivy fat-jar (BOOT-INF/lib)', notes: ['index.md: every service was reported "0 (no sources)" by the OSV source scan — false clean, no gradle.lockfile'] });
// 07-07 post-remediation rescan (raw jsons; index.md was never generated)
const j0707 = tallyTrivyDir(join(R, 'jvm-rescan-20260707'));
if (j0707) jvm.snapshots.push({ date: '2026-07-07', event: 'jvm-rescan post-remediation', fleet: { ...j0707.fleet, total: tot(j0707.fleet) }, perRepo: j0707.perRepo, source: 'reports/jvm-rescan-20260707/*.trivy.json', method: 'trivy fat-jar', notes: ['tallied from raw trivy jsons — no index.md existed for this scan'] });
jvm.snapshots.sort((a, b) => String(a.date).localeCompare(String(b.date)));

// ---------- images dimension ----------
const images = { dimension: 'images', note: 'Container-image CVE scans (Trivy: OS packages + language deps). Never entered the slice timeline.', snapshots: [] };
try {
  const ch = JSON.parse(readFileSync(join(CVEHIST, 'index.json'), 'utf8'));
  for (const s of ch.snapshots || []) {
    if (s.scope !== 'image') continue;
    images.snapshots.push({ date: (s.ts || '').replace(/T(\d{2})-(\d{2})-(\d{2})-\d+Z/, 'T$1:$2:$3Z'), event: s.event, fleet: { ...sevMap(s.bySeverity || {}), total: s.total ?? null, images: s.images ?? null }, source: `modernization-map/cve-history/${s.dir || ''}`, method: 'trivy image' });
  }
} catch {}
const IMG_LABEL = { 'images-cve': 'image scan (old stack)', 'images-20260707-fleet': 'image scan (modernized stack)', 'images-20260709-deployed': 'image scan (DEPLOYED infra only — localstack retired, rabbitmq 4.0)' };
for (const dir of readdirSync(R).filter((d) => d.startsWith('images-') || d === 'images-cve').sort()) {
  const t = mdTable(join(R, dir, 'index.md'));
  if (t) images.snapshots.push({ date: t.scanned || dir, event: IMG_LABEL[dir] || dir, fleet: { ...t.fleet, total: tot(t.fleet) }, perImage: t.rows, source: `reports/${dir}/index.md`, method: 'trivy image' });
}
images.snapshots.sort((a, b) => String(a.date).localeCompare(String(b.date)));

// ---------- codeql dimension ----------
const codeql = { dimension: 'codeql', note: 'CodeQL SAST fleet runs. Result counts per repo; severity from rule metadata where present.', snapshots: [] };
for (const dir of readdirSync(R).filter((d) => d.startsWith('codeql-fleet-'))) {
  const perRepo = {}; const fleet = { crit: 0, high: 0, med: 0, low: 0 };
  for (const f of readdirSync(join(R, dir)).filter((x) => x.endsWith('.sarif'))) {
    // Non-ok states skip loudly instead of counting as a clean zero
    const rr = readSarif(join(R, dir, f));
    if (rr.state !== 'ok') {
      process.stderr.write(`[backfill-dimensions] ${dir}/${f}: ${rr.state} — ${rr.reason}; skipped (not counted as a clean zero)\n`);
      continue;
    }
    const run = rr.runs[0] || { results: [] }; // runs:[] — a valid report with no run entries stays a plain zero
    const rules = ruleIndex(run, { extensions: true }); // driver rules win over extension rules, as before
    const c = { crit: 0, high: 0, med: 0, low: 0 };
    for (const res of run.results) {
      const rule = rules[res.ruleId] || {};
      const ss = parseFloat(rule.properties?.['security-severity'] || 0) || 0;
      const lvl = res.level || rule.defaultConfiguration?.level || 'warning';
      const k = ss >= 9 ? 'crit' : ss >= 7 ? 'high' : ss >= 4 ? 'med' : ss > 0 ? 'low' : (lvl === 'error' ? 'high' : lvl === 'warning' ? 'med' : 'low');
      c[k]++; fleet[k]++;
    }
    perRepo[f.replace('.sarif', '')] = c;
  }
  const m = dir.match(/codeql-fleet-(\d{8})-(\d{6})/);
  codeql.snapshots.push({ date: m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}` : dir, event: dir, fleet: { ...fleet, total: tot(fleet) }, perRepo, source: `reports/${dir}/*.sarif`, method: 'codeql' });
}
codeql.snapshots.sort((a, b) => String(a.date).localeCompare(String(b.date)));

// ---------- runtime dimension ----------
const runtime = { dimension: 'runtime', note: 'Runtime DAST/BOLA/TLS against the live testbed. Never entered the slice timeline.', snapshots: [] };
for (const [dir, label] of [['runtime-20260708022747.pre-rescan', 'runtime (pre-rescan snapshot)'], ['runtime-latest', 'runtime (latest)']]) {
  const base = join(R, dir); if (!existsSync(base)) continue;
  const snap = { date: dir.includes('202607') ? '2026-07-08' : '2026-07-08+', event: label, source: `reports/${dir}/`, method: 'nuclei + authz-bola + tls-headers', fleet: { crit: 0, high: 0, med: 0, low: 0, info: 0 }, parts: {} };
  // nuclei.json is JSONL
  try {
    const lines = readFileSync(join(base, 'nuclei.json'), 'utf8').split('\n').filter((l) => l.trim().startsWith('{'));
    const c = { crit: 0, high: 0, med: 0, low: 0, info: 0 };
    for (const l of lines) { try { const o = JSON.parse(l); const s = (o.info?.severity || 'info').toLowerCase(); const k = { critical: 'crit', high: 'high', medium: 'med', low: 'low' }[s] || 'info'; c[k]++; } catch {} }
    snap.parts.nuclei = { ...c, findings: lines.length };
    for (const k of ['crit', 'high', 'med', 'low', 'info']) snap.fleet[k] += c[k] || 0;
  } catch {}
  for (const [file, key] of [['authz-bola.json', 'bola'], ['tls-headers.json', 'tls']]) {
    try {
      const txt = readFileSync(join(base, file), 'utf8');
      let n = 0, sev = { crit: 0, high: 0, med: 0, low: 0, info: 0 };
      try { const d = JSON.parse(txt); const arr = Array.isArray(d) ? d : (d.findings || d.results || d.violations || []); n = Array.isArray(arr) ? arr.length : 0;
        if (Array.isArray(arr)) for (const o of arr) { const s = String(o.severity || o.level || 'info').toLowerCase(); const k = { critical: 'crit', high: 'high', medium: 'med', low: 'low' }[s] || 'info'; sev[k]++; } }
      catch { n = txt.split('\n').filter((l) => l.trim().startsWith('{')).length; }
      snap.parts[key] = { entries: n, ...sev };
      for (const k of ['crit', 'high', 'med', 'low']) snap.fleet[k] += sev[k] || 0;
    } catch {}
  }
  snap.fleet.total = snap.fleet.crit + snap.fleet.high + snap.fleet.med + snap.fleet.low;
  snap.notes = [existsSync(join(base, 'FINDINGS.md')) ? `narrative: reports/${dir}/FINDINGS.md` : 'no FINDINGS.md'];
  runtime.snapshots.push(snap);
}

for (const d of [jvm, images, codeql, runtime]) {
  writeFileSync(join(dimDir, `${d.dimension}.json`), JSON.stringify({ ...d, derivedAt: new Date().toISOString(), ...(registryUnavailable ? { registryUnavailable } : {}) }, null, 1));
  const line = d.snapshots.filter((s) => s.fleet).map((s) => `${String(s.date).slice(0, 10)}:${s.fleet.crit ?? '?'}C/${s.fleet.high ?? '?'}H`).join(' → ');
  console.log(`dimensions/${d.dimension}.json — ${d.snapshots.length} snapshots · ${line}`);
}
