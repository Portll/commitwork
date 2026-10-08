#!/usr/bin/env node
// commitwork monitor — temporal viewer: the slice history as one self-contained timeline.html.
// Fleet grid (repos × slices), two-slice diff, per-finding worldlines, and the cleaned layer
// (verified remediation from the ledger) vs cleanable (open findings).
// All data is embedded inline at build time (file:// safe — fetch() is blocked there).
// usage: node monitor/timeline.mjs            (reads the registry OUT, or CW_MONITOR_OUT)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { projectOf, projectSlug } from './project-scope.mjs';
import { TOTALS_EXCLUDE } from './extractors.mjs'; // scanner-delta projections respect the same headline exclusions
import { identityFor } from './detail-schema.mjs'; // to slim place views: `sub` already carries identity[0]
import { outDirFor } from './area.mjs';
import { loadRegistry, primaryArea } from './registry.mjs';
import { issuesPathFor } from './store-paths.mjs';
import { followerScript, toggleScript } from '../lib/theme-follower.mjs';
import { houseCss } from '../lib/house-css.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// Fail loud: a broken registry must stop this tool, never silently misresolve OUT.
const REG = loadRegistry();
const OUT = outDirFor(null, REG);
const histDir = join(OUT, 'history');

const DETAIL_CAP = 60; // newest N slices carry per-finding detail; older contribute to series only
// fix: read CW_ADMIN_PORT (same source as serve.mjs) - port was inlined, so a non-default port
// generated a dead iframe in every timeline.
const ADMIN_HOSTPORT = `127.0.0.1:${+(process.env.CW_ADMIN_PORT || 7878)}`;
const ADMIN_ORIGIN = `http://${ADMIN_HOSTPORT}`;

// Index read: only ENOENT means "no history yet". A corrupt index must never surface as absent —
// the absent-path advice ("run a rollup") is DESTRUCTIVE here: rollup swallows the same read
// (rollup.mjs:622), starts from an empty idx, and rewrites index.json with one row, erasing every
// prior row's entry. So corrupt gets its own message and never recommends a rollup.
let idx = [];
try { idx = JSON.parse(readFileSync(join(histDir, 'index.json'), 'utf8')); }
catch (e) {
  if (e && e.code === 'ENOENT') { console.error('timeline: no history/index.json — run a rollup first'); process.exit(1); }
  console.error(`timeline: history/index.json at ${join(histDir, 'index.json')} is unreadable (${e && (e.code || e.message)}) — history EXISTS but its index cannot be read. This is not "no history": do NOT re-run a rollup to fix it (rollup would rebuild the index from empty and orphan every prior slice); inspect/restore the index file instead.`);
  process.exit(1);
}
if (!Array.isArray(idx)) { console.error(`timeline: history/index.json at ${join(histDir, 'index.json')} parsed but is not an array — wrong shape is corrupt, not empty; inspect/restore it (a rollup will not repair it).`); process.exit(1); }
if (!idx.length) { console.error('timeline: history/index.json holds no rows — run a rollup first'); process.exit(1); }
idx = [...idx].sort((a, b) => (a.generated || '').localeCompare(b.generated || ''));

// Remediation ledger — the only source for the "cleaned — dep ledger" KPI. Only ENOENT is silent;
// a corrupt ledger warns loudly and degrades, with `ledgerUnreadable` carried in the payload.
let ledger = { entries: [] };
let ledgerUnreadable = false;
const LEDGER_PATH = join(OUT, 'remediation-ledger.json');
try { ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')); }
catch (e) {
  if (e && e.code === 'ENOENT') { /* no ledger written yet — legitimate, silent */ }
  else {
    ledgerUnreadable = true;
    console.error(`timeline: remediation-ledger.json at ${LEDGER_PATH} is unreadable (${e && (e.code || e.message)}) — the "cleaned — dep ledger" KPI and trend line will read zero/flat from here on, not because nothing was cleaned but because the ledger itself could not be read`);
  }
}

// ── the issue tracker, as a SECOND set of series (never merged into the ledger's) ─────────────
// The ledger is dependency-only by construction; issue closes are a different grade of proof, so
// they draw as separate lines. Four counts, four meanings: cleaned (dep ledger) / closed
// (scanner-proved) / closed (human decision — not proof) / human-green (open, in-force ruling).
// Fail closed: only ENOENT means "no tracker"; a corrupt store must not render as zero closes.
const MACHINE_TIERS = new Set(['strong', 'medium', 'anchor-drift']);

// Read LAZILY, not at module load. Both the path and the read used to happen at import, so a caller
// that set CW_ISSUES after importing this module got the production store — the override was
// defeated by the import itself, and the test that set it passed while proving nothing. Memoised so
// the store is still read once per process; `_read` distinguishes "not yet read" from "read, absent"
// so that ENOENT does not re-open the file on every call.
let _issueDoc = null;
let _read = false;
function issueStoreDoc() {
  if (_read) return _issueDoc;
  const path = issuesPathFor(CW);
  try { _issueDoc = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    if (e && e.code === 'ENOENT') _issueDoc = null;
    else throw new Error(`issue store at ${path} is unreadable (${e && (e.code || e.message)}); refusing to draw it as zero closes`);
  }
  _read = true;
  return _issueDoc;
}
// One record -> at most one closure fact, bucketed by the closing evidence's slice. A close naming
// no slice is unattributable and counted separately — never dropped into the last column.
function issueClosures(doc) {
  const out = { closures: [], humanGreen: [], unattributable: 0 };
  if (!doc || !doc.issues) return out;
  const now = new Date().toISOString();
  for (const iss of Object.values(doc.issues)) {
    if (iss.state === 'closed') {
      const ev = [...(iss.evidence || [])].reverse().find((e) => e.tier);
      const proved = !!(ev && MACHINE_TIERS.has(ev.tier) && iss.closedAs === 'fixed');
      const sliceId = (ev && ev.sliceId) || null;
      if (!sliceId) { out.unattributable += 1; continue; }
      out.closures.push({ id: iss.id, repo: iss.repo, area: iss.area, sev: iss.severity,
        rule: iss.source?.rule || null, tool: iss.source?.tool || null,
        closedAs: iss.closedAs, tier: (ev && ev.tier) || null, proved, sliceId, at: ev.at || iss.updatedAt });
      continue;
    }
    // human-green: open, carrying an in-force suppressing ruling — deliberately not a "clean".
    const d = [...(iss.dispositions || [])].reverse().find((x) =>
      (x.disposition === 'false-positive' || x.disposition === 'not-applicable')
      && !x.invalidatedAt && (!x.expires || String(x.expires) > now));
    if (d) out.humanGreen.push({ id: iss.id, repo: iss.repo, area: iss.area, sev: iss.severity,
      disposition: d.disposition, who: d.who, at: d.at, expires: d.expires || null, reason: d.reason || '' });
  }
  out.closures.sort((a, b) => String(a.sliceId).localeCompare(String(b.sliceId)) || a.id.localeCompare(b.id));
  out.humanGreen.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
const issueFacts = issueClosures(issueStoreDoc());

// ── preflight: which repos could not be scanned at all ────────────────────────────────────────
// `blind` becomes a drawn state, not a silence. Fail closed: only ENOENT means "no preflight ran".
let preflight = null;
try { preflight = JSON.parse(readFileSync(join(OUT, 'preflight.json'), 'utf8')); }
catch (e) {
  if (!e || e.code !== 'ENOENT') throw new Error(`preflight.json at ${join(OUT, 'preflight.json')} is unreadable (${e && (e.code || e.message)}); refusing to draw the fleet as fully scannable`);
}
const blindRepos = preflight
  ? Object.fromEntries(preflight.repos.filter((r) => r.state === 'blind' || r.state === 'missing')
    .map((r) => [r.name, { state: r.state, note: r.note || '' }]))
  : null;

// load each slice: v1 rows name their file; v0 rows map stamp -> <stamp>.json
const SEVRANK = { crit: 4, high: 3, med: 2, low: 1 };
// Fail-closed read: ENOENT (pruned v0 slice) skips silently; anything else keeps its COLUMN,
// drawn as an explicit `unreadable` state, never as absent.
const corruptSlices = []; // [{file, sliceId, error}] — surfaced in the payload + the grid note/legend
// Unreadable columns invent nothing: cells/carriedRepos empty (unreadable:true tells them from
// clean), findings/resolved/carriedList null — an empty array would read as a proven zero.
const unreadableSlice = (e, file, error) => {
  const sliceId = e.sliceId || (e.stamp ? `v0-${e.stamp}` : file);
  corruptSlices.push({ file, sliceId, error });
  console.error(`timeline: slice ${sliceId} (${file}) is unreadable (${error}) — keeping its column, drawn as unreadable, never as absent`);
  return { sliceId, stamp: e.stamp, v1: (e.sliceVersion || 0) >= 1, kind: 'unreadable', generated: e.generated || null,
    totals: { crit: 0, high: 0, med: 0, low: 0, cves: 0 }, // a placeholder, never read as "confirmed zero" — renderSeries holds the previous value across this slice instead of summing it
    counts: { born: null, cleaned: null, unconfirmed: null, accepted: null, carried: null },
    scope: null, backfill: null, cells: {}, carriedRepos: {},
    findings: null, resolved: null, carriedList: null,
    unreadable: true, unreadableError: error, verify: 'unreadable' };
};
const slices = [];
for (const e of idx) {
  const file = e.file || `${e.stamp}.json`;
  let raw = null, s = null;
  try {
    raw = readFileSync(join(histDir, file)); // Buffer — sliceSha256 hashes the exact bytes, never a re-stringify
    s = JSON.parse(raw.toString('utf8'));
    if (!s || typeof s !== 'object') throw new Error('slice content parsed but is not a JSON object');
  } catch (err) {
    if (err && err.code === 'ENOENT') continue; // pruned v0 slice — legitimately absent, skip silently
    slices.push(unreadableSlice(e, file, (err && (err.message || err.code)) || 'unreadable'));
    continue;
  }
  // sliceSha256 three-state verify: match -> verified; mismatch -> unreadable (valid JSON is not
  // trusted JSON); absent -> unverified-legacy, its own state and never an alarm.
  let verify = 'unverified-legacy';
  if (e.sliceSha256) {
    const actual = createHash('sha256').update(raw).digest('hex');
    if (actual === e.sliceSha256) verify = 'verified';
    else { slices.push(unreadableSlice(e, file, `sliceSha256 mismatch: index records ${e.sliceSha256}, file hashes to ${actual}`)); continue; }
  }
  const v1 = (s.sliceVersion || 0) >= 1;
  const sliceId = s.sliceId || `v0-${e.stamp}`;
  // per-repo cell: worst OPEN severity, or clean, or notscanned (v1 only), or v0 (provenance unknown)
  // cells also carry open counts per severity (crit/high/med/low) for the grid numbers + tooltip
  const repoCells = {};
  for (const f of s.findings || []) {
    const open = !(f.annotation);
    const c = repoCells[f.repo] || (repoCells[f.repo] = { worst: null, n: 0, acc: 0 });
    c.n++;
    if (!open) { c.acc++; continue; }
    if (SEVRANK[f.severity]) c[f.severity] = (c[f.severity] || 0) + 1;
    if (!c.worst || SEVRANK[f.severity] > SEVRANK[c.worst]) c.worst = f.severity;
  }
  const scanned = v1 ? Object.keys(s.toolRuns || {}) : Object.keys(repoCells);
  // a v1 sweep that scanned nothing (no tool ran in any repo) is a failed run, not a
  // fleet-went-to-zero data point — keep it in history but never draw it as a column
  if (v1 && !scanned.length) { console.error(`timeline: skipping empty slice ${sliceId} (0 tool runs)`); continue; }
  for (const r of scanned) if (!repoCells[r]) repoCells[r] = { worst: null, n: 0, acc: 0 };
  // documentation backfill: proven zero-finding scans become "documented clean" cells
  let backfill = null;
  try { backfill = JSON.parse(readFileSync(join(histDir, 'enrichment', `${e.stamp}-backfill.json`), 'utf8')); } catch {}
  let docAdded = 0;
  if (backfill) for (const [name, r] of Object.entries(backfill.repos || {})) {
    if (!repoCells[name] && r.scanned && r.counts && r.counts.total === 0) { repoCells[name] = { worst: null, n: 0, acc: 0, doc: 1 }; docAdded++; }
  }
  const carriedRepos = {};
  for (const c of s.carried || []) carriedRepos[c.repo] = (carriedRepos[c.repo] || 0) + 1;
  slices.push({
    sliceId, stamp: e.stamp, v1, kind: s.kind || 'v0', generated: s.generated || e.generated,
    totals: s.totals || { crit: e.crit, high: e.high, med: e.med, low: e.low, cves: e.total },
    counts: s.counts || { born: e.new ?? null, cleaned: null, unconfirmed: null, accepted: null, carried: null },
    scope: v1 ? (s.scope?.repos || []) : null,
    backfill: backfill ? { source: backfill.sourceName, added: docAdded, mismatches: backfill.mismatches || [] } : null,
    cells: repoCells, carriedRepos,
    findings: null, // detail attached below for the newest DETAIL_CAP
    verify,
  });
  slices[slices.length - 1]._raw = s;
}
// attach pruned finding detail to the newest DETAIL_CAP slices (worldlines + diff need it)
const detailFrom = Math.max(0, slices.length - DETAIL_CAP);
slices.forEach((sl, i) => {
  const s = sl._raw || {}; delete sl._raw; // unreadable synthetic slices carry no _raw
  // scanner-lane delta rides on every slice; projectData compacts it per page below
  sl.scannerDelta = s.scannerDelta || null;
  // unreadable slices stay null on findings/resolved/carriedList even inside the detail window
  if (i < detailFrom || sl.unreadable) return;
  const prune = (f, state) => ({ k: f.legacyKey || `${f.repo}|${f.id}|${f.package}`, repo: f.repo, id: f.id,
    pkg: f.package, sev: f.severity, st: state || f.state || 'unknown', ann: f.annotation ? 1 : 0, path: f.path || '' });
  sl.findings = (s.findings || []).map((f) => prune(f));
  sl.resolved = (s.resolved || []).map((f) => prune(f));
  sl.carriedList = (s.carried || []).map((f) => prune(f, 'unknown-not-scanned'));
});
const allRepoNames = [...new Set(slices.flatMap((sl) => [...Object.keys(sl.cells), ...Object.keys(sl.carriedRepos)]))].sort();
const cleanEntries = ledger.entries.map((e) => ({ k: e.legacyKey, id: e.vulnId, pkg: e.package, repo: e.repo, sev: e.severity,
  tier: e.evidence.tier, detail: e.evidence.detail, from: e.fromVersion, to: e.toVersion, commit: e.fixCommit,
  born: e.bornSlice, resolved: e.resolvedSlice, at: e.at }));

// Project segregation: each project renders its own timeline-<slug>.html. Projects derive purely
// from the repos this area actually contains — never force-seeded.
const projects = [...new Set(allRepoNames.map(projectOf))];
const pick = (obj, keep) => Object.fromEntries(Object.entries(obj).filter(([k]) => keep(k)));

// Compact one slice's scannerDelta for the page payload, optionally re-projected to one project.
// A filtered projection recomputes from the place lists and says `projected: true`; counts it
// cannot re-derive are dropped rather than served wrong; `trunc` travels so the page says "at least".
function compactSd(sd, keepRepo, filtered, withDetail) {
  if (!sd) return null;
  const by = {};
  let compared = 0;
  const t = { new: 0, fixed: 0 }, ta = { new: 0, fixed: 0 };
  const excl = new Set(TOTALS_EXCLUDE);
  for (const [cat, c] of Object.entries(sd.byCategory || {})) {
    if (c.status !== 'compared') continue;
    compared++;
    let nP = c.newPlaces || [], fP = c.fixedPlaces || [];
    let nn = c.new, nf = c.fixed, byRule = c.byRule || {};
    if (filtered) {
      nP = nP.filter((p) => keepRepo(p.repo)); fP = fP.filter((p) => keepRepo(p.repo));
      nn = nP.length; nf = fP.length;
      const br = {};
      for (const p of fP) (br[p.sub] ||= { new: 0, fixed: 0 }).fixed++;
      for (const p of nP) (br[p.sub] ||= { new: 0, fixed: 0 }).new++;
      byRule = Object.fromEntries(Object.entries(br).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    ta.new += nn; ta.fixed += nf;
    if (!excl.has(cat)) { t.new += nn; t.fixed += nf; }
    if (!nn && !nf) continue;
    // `sub` IS identity[0] by construction — drop the duplicate named field from the page payload
    const id0 = (identityFor(cat) || [])[0];
    const slim = (p) => { if (!id0 || !(id0 in p)) return p; const { [id0]: _dup, ...rest } = p; return rest; };
    by[cat] = { new: nn, fixed: nf, byRule,
      ...(withDetail && fP.length ? { fixedPlaces: fP.map(slim) } : {}),
      ...(withDetail && nP.length ? { newPlaces: nP.map(slim) } : {}),
      ...(c.truncated ? { trunc: c.truncated } : {}),
      ...(filtered ? { projected: true } : {}) };
  }
  return { c: compared > 0, compared, t: compared ? t : { new: null, fixed: null },
    ta: compared ? ta : { new: null, fixed: null }, by, nc: sd.notCompared || [] };
}
function projectData(project) {
  const mine = (r) => projectOf(r) === project;
  const pSlices = slices.map((sl, i) => {
    const cells = pick(sl.cells, mine);
    // recompute totals only when the filter dropped repos from this slice — otherwise keep the
    // recorded totals verbatim (counts stay recorded either way; they are per-run event tallies)
    let totals = sl.totals;
    const dropped = Object.keys(cells).length !== Object.keys(sl.cells).length;
    if (dropped) {
      totals = { ...sl.totals, crit: 0, high: 0, med: 0, low: 0, repos: Object.keys(cells).length };
      for (const c of Object.values(cells)) for (const sev of ['crit', 'high', 'med', 'low']) totals[sev] += c[sev] || 0;
      totals.cves = totals.crit + totals.high + totals.med + totals.low;
    }
    return { ...sl, totals, cells,
      sd: compactSd(sl.scannerDelta, mine, dropped, i >= detailFrom),
      scannerDelta: undefined, // the raw form stays out of the payload — `sd` is the page contract
      scope: sl.scope ? sl.scope.filter(mine) : sl.scope,
      carriedRepos: pick(sl.carriedRepos, mine),
      findings: sl.findings ? sl.findings.filter((f) => mine(f.repo)) : sl.findings,
      resolved: sl.resolved ? sl.resolved.filter((f) => mine(f.repo)) : sl.resolved,
      carriedList: sl.carriedList ? sl.carriedList.filter((f) => mine(f.repo)) : sl.carriedList,
    };
  });
  const repoNames = allRepoNames.filter(mine);
  const pLedger = cleanEntries.filter((e) => mine(e.repo));
  // An issue with no repo belongs to no project row and is carried on every projection.
  const isMine = (r) => !r || mine(r);
  return JSON.stringify({ generated: new Date().toISOString(), out: OUT, project, detailFrom, repoNames, slices: pSlices, ledger: pLedger,
    ledgerUnreadable, // area-wide build fact, not project-scoped — same value on every project's page
    corruptSlices, // area-wide too: a slice's readability is a fact about the sweep, not about one repo
    blind: blindRepos === null ? null : Object.fromEntries(Object.entries(blindRepos).filter(([r]) => isMine(r))),
    issues: issueStoreDoc() === null ? null : {
      closures: issueFacts.closures.filter((c) => isMine(c.repo)),
      humanGreen: issueFacts.humanGreen.filter((c) => isMine(c.repo)),
      unattributable: issueFacts.unattributable,
    } })
    .replace(/<\//g, '<\\/');
}

const html = String.raw`<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>commitwork timeline — slices</title>
${followerScript()}
<style>
${houseCss()}
 :root{--crit-bg:color-mix(in srgb,var(--crit) 14%,var(--panel));--high-bg:color-mix(in srgb,var(--high) 14%,var(--panel));--med-bg:color-mix(in srgb,var(--med) 14%,var(--panel));--low-bg:color-mix(in srgb,var(--low) 14%,var(--panel));--ok:var(--live);--ok-bg:color-mix(in srgb,var(--live) 14%,var(--panel));--unk:var(--plan);--unk-bg:color-mix(in srgb,var(--plan) 16%,var(--panel));--clean:var(--attest)}
 body{font-size:.875rem;line-height:1.5}
 .bar{position:sticky;top:0;z-index:9;background:var(--panel);border-bottom:1px solid var(--line);padding:.5625rem 1rem;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
 .bar b{font-size:.9375rem}.sp{flex:1}.mut{color:var(--mut);font-size:.7188rem}
 button,input,select{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:.375rem;padding:.3125rem .5625rem}
 button{cursor:pointer}button:hover{border-color:var(--acc)}button.on{background:var(--wash);border-color:var(--acc2);box-shadow:inset 0 -2px 0 var(--acc)}
 .wrap{max-width:93.75rem;margin:.875rem auto 4.375rem;padding:0 1rem;display:flex;gap:.875rem;align-items:flex-start}
 .rail{position:sticky;top:3.25rem;display:flex;flex-direction:column;gap:.375rem;min-width:9.25rem}
 .rail button{text-align:left;font-size:.75rem;padding:.375rem .625rem;border-radius:.4375rem;opacity:.5}
 .rail button.on{opacity:1;background:var(--wash);border-color:var(--acc2);box-shadow:inset 2px 0 0 var(--acc);color:var(--ink)}
 .content{flex:1;min-width:0}
 .panel.closed{display:none}
 @media (max-width:56.25rem){.wrap{flex-direction:column}.rail{position:static;flex-direction:row;flex-wrap:wrap;min-width:0}}
 .kpis{display:flex;gap:.625rem;flex-wrap:wrap;margin:0 0 .75rem}
 .kpi{background:var(--panel);border:1px solid var(--line);border-radius:.5rem;padding:.5625rem .9375rem;min-width:7.5rem}
 .kpi .n{font-size:1.4375rem;font-weight:700;font-variant-numeric:tabular-nums}.kpi .l{font-size:.6562rem;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
 .kpi.clean .n{color:var(--clean)}.kpi.open .n{color:var(--high)}.kpi.unk .n{color:var(--unk)}
 .panel{background:var(--panel);border:1px solid var(--line);border-radius:.5rem;margin-bottom:.875rem;overflow:hidden;scroll-margin-top:3.5rem}
 .panel h3{margin:0;padding:.5625rem .8125rem;border-bottom:1px solid var(--line);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
 .scroll{overflow-x:auto;padding:.625rem .8125rem}
 table.grid{border-collapse:collapse;font-size:.6875rem}
 table.grid th{position:sticky;left:0;background:var(--panel);text-align:right;padding:2px .5rem 2px 2px;font-weight:600;white-space:nowrap;z-index:1}
 table.grid td{padding:1px}
 .cell{width:1.125rem;height:1rem;border-radius:.1875rem;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid transparent;font-size:.625rem;font-weight:700;line-height:1;color:var(--panel);text-shadow:0 1px 2px rgba(0,0,0,.55)}
 html[data-mode=dark] .cell{color:var(--bg);text-shadow:none}
 .cell.crit{background:var(--crit)}.cell.high{background:var(--high)}.cell.med{background:var(--med)}.cell.low{background:var(--low)}
 .cell.clean{background:var(--ok-bg);border-color:var(--ok)}
 .cell.notscanned{background:var(--unk-bg)}
 .cell.acc{background:var(--med-bg);border-color:var(--med)}
 .cell.doc{background:var(--ok-bg);border:1px dashed var(--ok)}
 .cell.v0{background:repeating-linear-gradient(45deg,var(--unk-bg),var(--unk-bg) .1875rem,var(--panel) .1875rem,var(--panel) .375rem)}
 .cell.v0.crit{background:repeating-linear-gradient(45deg,var(--crit),var(--crit) .1875rem,var(--crit-bg) .1875rem,var(--crit-bg) .375rem)}
 .cell.v0.high{background:repeating-linear-gradient(45deg,var(--high),var(--high) .1875rem,var(--high-bg) .1875rem,var(--high-bg) .375rem)}
 .cell.v0.med{background:repeating-linear-gradient(45deg,var(--med),var(--med) .1875rem,var(--med-bg) .1875rem,var(--med-bg) .375rem)}
 .cell.unreadable{background:repeating-linear-gradient(135deg,var(--crit),var(--crit) .1875rem,var(--panel) .1875rem,var(--panel) .375rem);border-color:var(--crit)}
 .cell.sel{outline:2px solid var(--acc);outline-offset:1px}
 table.grid th.blindrow{color:var(--crit);font-style:italic}
 .axis td{font-size:.625rem;color:var(--mut);writing-mode:vertical-rl;transform:rotate(180deg);padding:.1875rem 1px;white-space:nowrap}
 .legend{font-size:.6875rem;color:var(--mut);display:flex;gap:.875rem;flex-wrap:wrap;padding:.5rem .8125rem;border-top:1px solid var(--line)}
 .legend i{display:inline-block;width:.75rem;height:.75rem;border-radius:.1875rem;vertical-align:-2px;margin-right:.25rem}
 svg{display:block}
 .difftbl{width:100%;border-collapse:collapse;font-size:.75rem}
 .difftbl td,.difftbl th{padding:.25rem .5625rem;border-bottom:1px solid var(--line);text-align:left}
 .chip{display:inline-block;padding:1px .4375rem;border-radius:.625rem;font-size:.6875rem;font-weight:600}
 .chip.crit{background:var(--crit-bg);color:var(--crit)}.chip.high{background:var(--high-bg);color:var(--high)}.chip.med{background:var(--med-bg);color:var(--med)}.chip.low{background:var(--low-bg);color:var(--low)}
 .chip.born{background:var(--high-bg);color:var(--high)}.chip.fixed{background:var(--ok-bg);color:var(--ok)}.chip.unconfirmed{background:var(--med-bg);color:var(--med)}.chip.accepted{background:var(--med-bg);color:var(--med)}.chip.carried{background:var(--unk-bg);color:var(--unk)}.chip.scope{background:var(--low-bg);color:var(--low)}
 #tip{position:fixed;z-index:50;max-width:26.25rem;background:var(--panel);border:1px solid var(--line);border-radius:.5rem;box-shadow:0 .375rem 1.5rem rgba(0,0,0,.25);padding:.5rem .625rem;font-size:.7188rem;display:none}
 /* embedded in the admin panel (?embed=1 or inside an iframe): hide the brand, the cross-nav and
    the theme toggle, which would duplicate the panel's own bar and Appearance menu, and draw the
    bar as this view's toolbar rather than a second masthead */
 html[data-embed] .embed-hide{display:none!important}
 html[data-embed] .bar{position:static;background:transparent;border-bottom:0}
</style></head><body>
<div class="bar"><b class="embed-hide">commitwork timeline</b><span class="mut" id="src"></span><div class="sp"></div>
 <label class="mut">view <select id="mode"><option value="open">cleanable (open)</option><option value="cleaned">cleaned — dep ledger</option><option value="issues">closed — issues (scanner-proved)</option><option value="scanfixed">fixed — scanner lanes (scan-absent)</option></select></label>
 <a href="./dashboard.html" class="embed-hide" style="text-decoration:none"><button>Dashboard ↗</button></a>
 <a href="./runtime.html" class="embed-hide" style="text-decoration:none"><button>Runtime · DAST/BOLA ↗</button></a>
 <button id="theme" class="embed-hide" title="dark mode">☾</button></div>
<div class="wrap">
 <nav class="rail" id="rail" aria-label="page sections"></nav>
 <div class="content">
 <div class="panel" data-sec="Overview"><h3>Overview</h3><div style="padding:12px 13px 0"><div class="kpis" id="kpis"></div></div></div>
 <div class="panel" data-sec="Fleet grid"><h3>Fleet grid — repos × slices <span class="mut" id="gridnote"></span></h3><div class="scroll" id="grid"></div>
  <div class="legend"><span><i style="background:var(--crit)"></i>crit</span><span><i style="background:var(--high)"></i>high</span><span><i style="background:var(--med)"></i>med</span><span><i style="background:var(--ok-bg);border:1px solid var(--ok)"></i>scanned clean</span><span><i style="background:var(--med-bg);border:1px solid var(--med)"></i>accepted only</span><span><i style="background:var(--ok-bg);border:1px dashed var(--ok)"></i>documented clean (backfilled)</span><span><i style="background:var(--unk-bg)"></i>not scanned (explicit uncertainty)</span><span><i class="cell v0" style="width:12px;height:12px"></i>v0 slice (provenance unknown)</span><span><i class="cell unreadable" style="width:12px;height:12px"></i>unreadable (corrupt / hash mismatch — never absent)</span><span>cell number = open crit count, else open high count</span></div></div>
 <div class="panel" data-sec="Trend"><h3>Cleaned vs cleanable over time</h3><div class="scroll" id="series"></div></div>
 <div class="panel" data-sec="Scanner fixes"><h3>Scanner-lane fixes — by category / rule <span class="mut">(scan-absent tier: the place stopped producing rows on a slice whose scanner ran)</span></h3><div class="scroll" id="scanfixes"></div></div>
 <div class="panel" data-sec="Slice diff"><h3>Two-slice diff — <span id="diffsel" class="mut">click two grid columns</span></h3><div class="scroll" id="diff"></div></div>
 <div class="panel" data-sec="Worldline"><h3>Finding worldline — <span id="wsel" class="mut">click a diff row or ledger entry</span></h3><div class="scroll" id="world"></div></div>
 <div class="panel" data-sec="Ledger"><h3>Remediation ledger (verified cleaned)</h3><div class="scroll" id="ledger"></div></div>
 <div class="panel embed-hide" data-sec="Admin panel"><h3>Admin panel — live · <a href="${ADMIN_ORIGIN}/" target="_blank" style="color:inherit">${ADMIN_HOSTPORT} ↗</a></h3>
  <iframe id="adminframe" data-src="${ADMIN_ORIGIN}/" title="commitwork admin panel" style="width:100%;height:84vh;border:0;display:block;background:var(--bg)"></iframe>
  <div class="legend"><span>bridged live from admin/serve.mjs — if blank, start it: <code>node admin/serve.mjs</code></span></div></div>
 </div>
</div>
<div id="tip"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
if(new URLSearchParams(location.search).has('embed')||self!==top)document.documentElement.setAttribute('data-embed','');
// only load the admin-panel iframe when NOT embedded — avoids admin→timeline→admin recursion
// (a display:none iframe still fetches its src, so gate the src itself, not just visibility)
(function(){const af=document.getElementById('adminframe');if(af&&!document.documentElement.hasAttribute('data-embed'))af.src=af.dataset.src;})();
const D=JSON.parse(document.getElementById('data').textContent);
// repo names and finding pkg/id/path/detail strings are scan-derived (package names, vuln ids,
// file paths) — not this page's to trust once they land in innerHTML.
const esc=s=>(s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SEV={crit:4,high:3,med:2,low:1};
const S=D.slices,R=D.repoNames;
document.getElementById('src').textContent=(D.project?D.project+' · ':'')+S.length+' slices · '+R.length+' repos · built '+new Date(D.generated).toLocaleString();
if(D.project)document.title='commitwork timeline — '+D.project;
const last=S[S.length-1];
// the ledger read may have degraded (see timeline.mjs's build-time warning) — D.ledger is then the
// empty default, and "0 cleaned" would be indistinguishable from a genuinely clean run. Render
// unknown, not zero.
const cleanedTotal=D.ledgerUnreadable?null:D.ledger.filter(e=>e.tier!=='weak').length;
const unconfTotal=D.ledgerUnreadable?null:D.ledger.filter(e=>e.tier==='weak').length;
// same rule if the NEWEST slice is itself unreadable: its cells/carriedRepos are empty by
// construction (nothing invented for a slice that could not be read), and reading that as "0 open"
// would be the sharpest false-clean this page can produce — on the very first number a viewer sees.
const openNow=last.unreadable?null:Object.values(last.cells).reduce((n,c)=>n+(c.n-c.acc),0);
const accNow=last.unreadable?null:Object.values(last.cells).reduce((n,c)=>n+c.acc,0);
const carriedNow=last.unreadable?null:Object.values(last.carriedRepos).reduce((a,b)=>a+b,0);
// The issue tracker's own counts, beside the ledger's and NEVER folded into them. The ledger is
// dependency-only by construction (see the header in timeline.mjs), so "cleaned (verified)" answers
// a narrower question than a reader assumes: on a repo with no runtime deps it is pinned forever
// while SAST work lands. These four are four different grades of evidence and each says which.
const ISS=D.issues;
const issProved=ISS?ISS.closures.filter(c=>c.proved).length:null;
const issDecided=ISS?ISS.closures.filter(c=>!c.proved).length:null;
const issGreen=ISS?ISS.humanGreen.length:null;
// null ⇒ no issue store on this box. Rendered as '—', never as 0: "no tracker" and "nothing
// closed" are different facts and only one of them is an achievement.
const N=v=>v===null?'—':v;
// scanner-lane fixed, summed over every slice whose delta was comparable. '—' when NO slice ever
// compared (histories that predate scanner-delta and were never backfilled) — that is "unknown",
// not zero, and the two must not render alike.
const sdAny=S.some(sl=>sl.sd&&sl.sd.c);
const scanFixedTotal=S.reduce((n,sl)=>n+((sl.sd&&sl.sd.t&&sl.sd.t.fixed)||0),0);
const scanNewTotal=S.reduce((n,sl)=>n+((sl.sd&&sl.sd.t&&sl.sd.t.new)||0),0);
document.getElementById('kpis').innerHTML=[
 ['open',N(openNow),'open (cleanable)','findings still open in the latest slice'],
 ['clean',N(cleanedTotal),'cleaned — dep ledger','dependency findings with lockfile-diff or known-fix evidence. This line CANNOT include scanner rows: the ledger only ever accepts dependency resolutions.'],
 ['clean',N(issProved),'closed — scanner-proved','issues the tracker auto-closed on a machine evidence tier (strong / medium / anchor-drift)'],
 ['clean',sdAny?scanFixedTotal:'—','fixed — scanner lanes','scanner places (repo · category · rule · file — never a line) that stopped producing rows on a slice whose scanner demonstrably ran. Scan-absent tier: weaker than the dep ledger\'s lockfile proof, and counted only when the category ran in both slices — a carried or skipped scanner proves nothing. Hygiene lanes (stubs, deno lint/types) are excluded, like the headline.'],
 ['unk',N(issDecided),'closed — human decision','accepted / refuted / superseded, or closed with no machine tier. A decision, NOT a proof.'],
 ['unk',N(issGreen),'human-green (still open)','open findings carrying an in-force false-positive / not-applicable ruling. The finding is still there.'],
 ['unk',D.blind===null?'—':Object.keys(D.blind).length,'BLIND (unscannable)','repos whose dependency manifest has no lock artifact — they scan EMPTY because nothing can resolve their dependencies. Not clean, and not the same as having no dependencies. null (—) means no preflight ran, which is its own unknown.'],
 ['unk',N(unconfTotal),'unconfirmed','ledger entries at tier weak — merely absent, never counted as cleaned'],
 ['',N(accNow),'accepted','findings with an active acceptance annotation in the latest slice'],
 ['unk',N(carriedNow),'carried / unknown','findings in repos the latest slice did not scan'],
 ['',S.length,'slices','history depth'],
].map(([c,n,l,t])=>'<div class="kpi '+c+'" title="'+esc(t)+'"><div class="n">'+n+'</div><div class="l">'+esc(l)+'</div></div>').join('');
if(ISS&&ISS.unattributable)document.getElementById('kpis').insertAdjacentHTML('afterend',
 '<div class="mut" style="margin:-4px 0 10px">'+ISS.unattributable+' closed issue(s) carry no slice in their closing evidence and are excluded from the trend below — stated rather than banked into the last column, which would invent a date.</div>');
const bfN=S.filter(s=>s.backfill&&s.backfill.added>0).length;
const cxN=(D.corruptSlices||[]).length;
document.getElementById('gridnote').textContent=[D.detailFrom>0?'(detail embedded for the last '+(S.length-D.detailFrom)+' slices; older columns are totals-only)':'',bfN?'('+bfN+' v0 slices backfilled from scan-report docs)':'',cxN?('('+cxN+' slice(s) unreadable — hover the hazard-striped column)'):''].filter(Boolean).join(' ');
// ---- grid ----
let selA=null,selB=null;
function cellClass(sl,repo){
 if(sl.unreadable) return 'unreadable'; // the whole column is unknown — never per-repo notscanned/v0, which both mean something else
 const c=sl.cells[repo];
 if(!c){ if(sl.carriedRepos[repo]) return sl.v1?'notscanned':'v0'; return sl.v1?'notscanned':'v0'; }
 if(c.doc) return 'doc';
 const base=c.worst?c.worst:(c.acc>0&&c.n===c.acc?'acc':'clean');
 return sl.v1?base:('v0 '+(c.worst||''));
}
const cellNum=c=>c&&c.crit?c.crit:(c&&c.high?c.high:'');
function renderGrid(){
 let h='<table class="grid"><tbody>';
 for(const repo of R){
  const bl=D.blind&&D.blind[repo];
  h+='<tr><th'+(bl?' class="blindrow" title="'+esc(bl.state.toUpperCase()+' — '+bl.note)+'"':'')+'>'+(bl?'▨ ':'')+esc(repo)+'</th>'+S.map((sl,i)=>'<td><span class="cell '+cellClass(sl,repo)+((selA===i||selB===i)?' sel':'')+'" data-i="'+i+'" data-r="'+esc(repo)+'">'+(sl.unreadable?'?':cellNum(sl.cells[repo]))+'</span></td>').join('')+'</tr>';
 }
 h+='<tr class="axis"><td></td>'+S.map(sl=>'<td>'+sl.sliceId.replace(/^(sweep-|adhoc-|v0-)/,'')+(sl.v1?'':'·v0')+'</td>').join('')+'</tr>';
 h+='</tbody></table>';
 document.getElementById('grid').innerHTML=h;
 document.querySelectorAll('.cell[data-i]').forEach(el=>{
  el.onclick=()=>{const i=+el.dataset.i; if(selA===null||selB!==null){selA=i;selB=null;}else if(i!==selA){selB=Math.max(i,selA);selA=Math.min(i,selA);}renderGrid();renderDiff();};
  el.onmouseenter=e=>{const sl=S[el.dataset.i],c=sl.cells[el.dataset.r];const t=document.getElementById('tip');
   const body=sl.unreadable?'<b style="color:var(--crit)">unreadable</b> — '+esc(sl.unreadableError||'read/verify failed')+'. Every repo is UNKNOWN on this slice, not clean.'
    :(c?(c.doc?'scanned clean — backfilled from '+((sl.backfill&&sl.backfill.source)||'scan-report')+' docs':(c.n-c.acc)+' open ('+(c.crit||0)+'c · '+(c.high||0)+'h · '+(c.med||0)+'m · '+(c.low||0)+'l) · '+c.acc+' accepted'):(sl.carriedRepos[el.dataset.r]?sl.carriedRepos[el.dataset.r]+' carried (not scanned)':(sl.v1?'not scanned':'v0 — provenance unknown')));
   const hash=sl.unreadable?'':(sl.verify==='verified'?' · <span class="mut">hash verified</span>':sl.verify==='unverified-legacy'?' · <span class="mut">hash not recorded (pre-existing slice)</span>':'');
   t.innerHTML='<b>'+esc(el.dataset.r)+'</b> @ '+sl.sliceId+'<br>'+body+hash;
   t.style.display='block';t.style.left=Math.min(e.clientX+12,innerWidth-430)+'px';t.style.top=(e.clientY+12)+'px';};
  el.onmouseleave=()=>document.getElementById('tip').style.display='none';
 });
}
// ---- series (open vs cumulative cleaned) ----
function renderSeries(){
 const W=Math.max(560,S.length*24+60),H=200,P=28;
 // an unreadable slice's totals are a zero-filled placeholder, never real data — holding the
 // previous value keeps the line FLAT through the gap instead of dropping it to zero, which on
 // this particular line (open findings) would read as "fully cleaned": the single most misleading
 // shape this page could draw over a slice it could not actually read.
 let lastOpenV=0;
 const open=S.map(sl=>sl.unreadable?lastOpenV:(lastOpenV=sl.totals.crit+sl.totals.high+sl.totals.med+sl.totals.low));
 const bySlice={};D.ledger.filter(e=>e.tier!=='weak').forEach(e=>{bySlice[e.resolved]=(bySlice[e.resolved]||0)+1;});
 let cum=0;const cleaned=S.map(sl=>{cum+=(bySlice[sl.sliceId]||0);return cum;});
 // THE SECOND LINE, drawn beside the ledger's and never added to it. Bucketed by the slice named in
 // each issue's CLOSING evidence entry, so the step lands where the proof appeared — the same rule
 // the ledger line follows. Closures whose slice is not one of ours contribute nothing here rather
 // than being pulled to the nearest column.
 const known=new Set(S.map(sl=>sl.sliceId));
 const provedBy={};(ISS?ISS.closures:[]).filter(c=>c.proved&&known.has(c.sliceId)).forEach(c=>{provedBy[c.sliceId]=(provedBy[c.sliceId]||0)+1;});
 let pc=0;const proved=S.map(sl=>{pc+=(provedBy[sl.sliceId]||0);return pc;});
 // THE THIRD LINE — scanner-lane fixed (scan-absent tier), cumulative. Steps on the slice whose
 // scan showed the place gone. A slice with no comparable delta contributes nothing — the line
 // stays flat there, it does not reset or invent.
 let sc=0;const scanfixed=S.map(sl=>{sc+=((sl.sd&&sl.sd.t&&sl.sd.t.fixed)||0);return sc;});
 const mx=Math.max(1,...open,...cleaned,...proved,...scanfixed);
 const x=i=>P+i*((W-2*P)/Math.max(1,S.length-1)),y=v=>H-P-(v/mx)*(H-2*P);
 const path=a=>a.map((v,i)=>(i?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ');
 const mode=document.getElementById('mode').value;
 const dim=(k)=>(mode===k?1:.3);
 document.getElementById('series').innerHTML='<svg width="'+W+'" height="'+H+'">'+
  '<path d="'+path(open)+'" fill="none" stroke="var(--high)" stroke-width="2" opacity="'+dim('open')+'"/>'+
  '<path d="'+path(cleaned)+'" fill="none" stroke="var(--clean)" stroke-width="2" opacity="'+dim('cleaned')+'"/>'+
  (ISS?'<path d="'+path(proved)+'" fill="none" stroke="var(--ok)" stroke-width="2" stroke-dasharray="5 3" opacity="'+dim('issues')+'"/>':'')+
  (sdAny?'<path d="'+path(scanfixed)+'" fill="none" stroke="var(--med)" stroke-width="2" stroke-dasharray="2 3" opacity="'+dim('scanfixed')+'"/>':'')+
  S.map((sl,i)=>'<circle cx="'+x(i)+'" cy="'+y(open[i])+'" r="2.5" fill="var(--high)"/><circle cx="'+x(i)+'" cy="'+y(cleaned[i])+'" r="2.5" fill="var(--clean)"/>'
   +(ISS?'<circle cx="'+x(i)+'" cy="'+y(proved[i])+'" r="2.5" fill="var(--ok)"><title>'+sl.sliceId+' issues closed (cum, scanner-proved)='+proved[i]+'</title></circle>':'')
   +(sdAny?'<circle cx="'+x(i)+'" cy="'+y(scanfixed[i])+'" r="2.5" fill="var(--med)"><title>'+sl.sliceId+' scanner-lane fixed (cum, scan-absent)='+scanfixed[i]+(sl.sd&&sl.sd.c?'':' — this slice not comparable')+'</title></circle>':'')).join('')+
  '<text x="'+P+'" y="14" fill="var(--high)" font-size="10">open findings</text>'+
  '<text x="'+(P+90)+'" y="14" fill="var(--clean)" font-size="10">cumulative cleaned — dep ledger</text>'+
  (ISS?'<text x="'+(P+280)+'" y="14" fill="var(--ok)" font-size="10">cumulative closed — issues, scanner-proved</text>':'')+
  (sdAny?'<text x="'+(P+510)+'" y="14" fill="var(--med)" font-size="10">cumulative fixed — scanner lanes, scan-absent</text>':'')+
  '<text x="'+(W-P)+'" y="'+(H-8)+'" fill="var(--mute)" font-size="9" text-anchor="end">'+S[S.length-1].sliceId+'</text><text x="'+P+'" y="'+(H-8)+'" fill="var(--mute)" font-size="9">'+S[0].sliceId+'</text></svg>'+
  '<div class="mut" style="padding:4px 0">Three fix populations, deliberately not summed — three grades of evidence, each line says which. The <b>dep ledger</b> line can only ever count dependency resolutions (rollup feeds it from the deps diff); the <b>issues</b> line counts scanner-row findings the tracker closed on machine evidence (anchor-checked); the <b>scanner lanes</b> line counts places that stopped producing rows on a slice whose scanner ran — scan-absent, the weakest machine tier, gated on the category having run in both slices. Human decisions and in-force rulings appear in the KPIs above and on none of these lines — a decision is not a proof.'+
  (ISS?'':' <b>No issue store was readable, so the issues line is absent — that is not zero.</b>')+
  (sdAny?'':' <b>No slice in this history carries a comparable scanner-lane delta (predates scanner-delta and not backfilled) — that line is absent, not zero.</b>')+
  (D.ledgerUnreadable?' <b>The dependency ledger was unreadable at build time — the cleaned line reads flat from here on, not because nothing was cleaned.</b>':'')+
  ((D.corruptSlices&&D.corruptSlices.length)?' <b>'+D.corruptSlices.length+' slice(s) in this history are unreadable (see the fleet grid) — the open-findings line holds its last known value through those gaps instead of dropping to zero.</b>':'')+'</div>';
}
// ---- diff ----
function renderDiff(){
 const el=document.getElementById('diff');
 if(selA===null||selB===null){el.innerHTML='<div class="mut" style="padding:10px">select two slices in the grid</div>';document.getElementById('diffsel').textContent='click two grid columns';return;}
 const A=S[selA],B=S[selB];
 document.getElementById('diffsel').textContent=A.sliceId+' → '+B.sliceId;
 if(!A.findings||!B.findings){
  const unread=[A,B].filter(s=>s.unreadable).map(s=>s.sliceId);
  // two distinct reasons finding-detail can be missing, and they must not read alike: one is
  // "not kept this far back" (a capacity decision), the other is "could not be read at all" (a
  // fact about THIS slice). Conflating them would quietly launder an unreadable slice into a
  // merely-old one.
  el.innerHTML='<div class="mut" style="padding:10px">'+(unread.length?unread.join(' and ')+' unreadable — no finding-level detail available (not the same as zero changes)':'one of these slices is older than the embedded-detail window ('+(S.length-D.detailFrom)+' slices) — totals only')+'</div>';
  return;
 }
 const ak=new Map(A.findings.map(f=>[f.k,f])),bk=new Map(B.findings.map(f=>[f.k,f]));
 const born=B.findings.filter(f=>!ak.has(f.k));
 const goneStates=new Map((B.resolved||[]).map(f=>[f.k,f.st]));
 const carried=new Set((B.carriedList||[]).map(f=>f.k));
 const gone=[...ak.values()].filter(f=>!bk.has(f.k)).map(f=>({...f,st:goneStates.get(f.k)||(carried.has(f.k)?'unknown-not-scanned':'resolved-between')}));
 const chip=st=>st==='born'?'born':st==='resolved-fixed'?'fixed':st==='resolved-unconfirmed'?'unconfirmed':st==='resolved-accepted'?'accepted':st==='resolved-scope'?'scope':'carried';
 const row=(f,tag)=>'<tr class="wl" data-k="'+esc(f.k)+'"><td><span class="chip '+chip(tag)+'">'+tag.replace('resolved-','').replace('unknown-not-scanned','carried')+'</span></td><td><span class="chip '+f.sev+'">'+f.sev+'</span></td><td><b>'+esc(f.pkg||f.id)+'</b></td><td>'+esc(f.id)+'</td><td>'+esc(f.repo)+'</td><td class="mut">'+esc(f.path||'')+'</td></tr>';
 el.innerHTML='<table class="difftbl"><tr><th>Δ</th><th>sev</th><th>package</th><th>vuln</th><th>repo</th><th>path</th></tr>'+
  born.map(f=>row(f,'born')).join('')+gone.map(f=>row(f,f.st)).join('')+'</table>'+(born.length+gone.length===0?'<div class="mut" style="padding:10px">no finding-level changes</div>':'');
 el.querySelectorAll('.wl').forEach(tr=>tr.onclick=()=>renderWorld(tr.dataset.k));
}
// ---- worldline ----
function renderWorld(k){
 document.getElementById('wsel').textContent=k;
 const cells=S.map((sl,i)=>{
  if(!sl.findings)return {i,st:'nodata'};
  if(sl.findings.some(f=>f.k===k))return {i,st:sl.findings.find(f=>f.k===k).ann?'accepted-open':'open'};
  if((sl.carriedList||[]).some(f=>f.k===k))return {i,st:'carried'};
  const r=(sl.resolved||[]).find(f=>f.k===k);
  if(r)return {i,st:r.st};
  return {i,st:'absent'};
 });
 const col=st=>st==='open'?'var(--high)':st==='accepted-open'?'var(--med)':st==='carried'?'var(--unk)':st==='resolved-fixed'?'var(--clean)':st==='resolved-unconfirmed'?'var(--med)':st==='resolved-accepted'?'var(--med)':st==='nodata'?'var(--line)':'transparent';
 const W=Math.max(560,S.length*24+60);
 document.getElementById('world').innerHTML='<svg width="'+W+'" height="70">'+cells.map(c=>'<rect x="'+(30+c.i*24)+'" y="18" width="20" height="20" rx="3" fill="'+col(c.st)+'"><title>'+S[c.i].sliceId+' — '+c.st+'</title></rect>').join('')+
  '<text x="30" y="60" fill="var(--mute)" font-size="9">'+S[0].sliceId+'</text><text x="'+(W-30)+'" y="60" fill="var(--mute)" font-size="9" text-anchor="end">'+S[S.length-1].sliceId+'</text></svg>'+
  '<div class="mut" style="padding:4px 13px">red=open · amber=accepted/unconfirmed · grey=carried (not scanned) · teal=verified cleaned · blank=absent</div>';
}
// ---- ledger ----
function renderLedger(){
 const rows=D.ledger.slice().reverse().map(e=>'<tr class="wl" data-k="'+esc(e.k)+'"><td><span class="chip '+(e.tier==='weak'?'unconfirmed':'fixed')+'">'+e.tier+'</span></td><td><span class="chip '+e.sev+'">'+e.sev+'</span></td><td><b>'+esc(e.pkg)+'</b>'+(e.from?' '+esc(e.from)+(e.to?' → '+esc(e.to):''):'')+'</td><td>'+esc(e.id)+'</td><td>'+esc(e.repo)+'</td><td class="mut">'+esc(e.detail)+(e.commit?' · '+esc(e.commit.slice(0,10)):'')+'</td><td class="mut">'+esc(e.resolved)+'</td></tr>').join('');
 document.getElementById('ledger').innerHTML=D.ledger.length?'<table class="difftbl"><tr><th>evidence</th><th>sev</th><th>package</th><th>vuln</th><th>repo</th><th>detail</th><th>resolved in</th></tr>'+rows+'</table>':'<div class="mut" style="padding:10px">no ledger entries yet — cleaned findings appear here with their evidence tier</div>';
 document.getElementById('ledger').querySelectorAll('.wl').forEach(tr=>tr.onclick=()=>renderWorld(tr.dataset.k));
}
// ---- scanner-lane fixes (by category / rule, newest slice first) ----
function renderScanFixes(){
 const el=document.getElementById('scanfixes');
 if(!sdAny){el.innerHTML='<div class="mut" style="padding:10px">No slice in this history carries a comparable scanner-lane delta — this history predates scanner-delta and has not been backfilled (monitor/backfill-scanner-delta.mjs). Unknown, not zero.</div>';return;}
 // the "where" of a place is its identity tuple minus the rule (sub) — rendered generically since
 // the tuple differs per category (file / path / target / resource / …)
 const placeWhere=p=>Object.entries(p).filter(([k])=>k!=='repo'&&k!=='sub'&&k!=='rows'&&k!=='sev').map(([,v])=>v).filter(v=>v!=='').join(' · ');
 const rows=[];
 for(let i=S.length-1;i>=0;i--){
  const sl=S[i];if(!sl.sd)continue;
  for(const cat of Object.keys(sl.sd.by).sort()){
   const c=sl.sd.by[cat];
   const chips=Object.entries(c.byRule).map(([r,n])=>'<span class="chip '+(n.fixed?'fixed':'born')+'">'+esc(r)+(n.fixed?' −'+n.fixed:'')+(n.new?' +'+n.new:'')+'</span>').join(' ');
   const places=[].concat((c.fixedPlaces||[]).map(p=>'<span class="mut">− '+esc(p.sub)+' @ '+esc(placeWhere(p))+(p.rows>1?' ('+p.rows+' rows)':'')+'</span>'),
    (c.newPlaces||[]).map(p=>'<span class="mut">+ '+esc(p.sub)+' @ '+esc(placeWhere(p))+(p.rows>1?' ('+p.rows+' rows)':'')+'</span>')).join('<br>');
   rows.push('<tr><td class="mut">'+sl.sliceId+'</td><td><b>'+esc(cat)+'</b>'+(c.projected?' <span class="mut" title="counts re-projected to this page\'s project from the recorded place lists">(projected)</span>':'')+(c.trunc?' <span class="mut" title="the recorded place list was capped — these counts are a floor">(≥, truncated)</span>':'')+'</td>'
    +'<td>'+(c.fixed?'−'+c.fixed:'')+'</td><td>'+(c.new?'+'+c.new:'')+'</td><td>'+chips+'</td><td>'+(places||'<span class="mut">detail outside the embedded window</span>')+'</td></tr>');
  }
 }
 el.innerHTML=rows.length?'<table class="difftbl"><tr><th>slice</th><th>category</th><th>fixed</th><th>new</th><th>rules</th><th>places (− fixed · + new)</th></tr>'+rows.join('')+'</table>'
  :'<div class="mut" style="padding:10px">Scanner-lane deltas were comparable ('+S.filter(sl=>sl.sd&&sl.sd.c).length+' slices) and recorded no place-level fixes or arrivals — compared and quiet, which IS a result, unlike unknown.</div>';
}
// ---- vertical section tabs (toggle; all open at start) ----
const rail=document.getElementById('rail');
document.querySelectorAll('.panel[data-sec]').forEach(p=>{
 const b=document.createElement('button');b.type='button';b.textContent=p.dataset.sec;b.className='on';
 b.onclick=()=>{const open=!p.classList.toggle('closed');b.classList.toggle('on',open);if(open)p.scrollIntoView({behavior:'smooth',block:'start'});};
 rail.appendChild(b);
});
document.getElementById('mode').onchange=renderSeries;
renderGrid();renderSeries();renderScanFixes();renderDiff();renderLedger();
</script>
${toggleScript()}
</body></html>`;
// The canonical timeline.html is THIS area's own view; falls back to the single project present,
// else the registry's primary.
const canonical = projects.length === 1 ? projects[0]
  : (projects.find((p) => projectSlug(p) === (primaryArea(REG)?.slug)) || projects[0] || null);
writeFileSync(join(OUT, 'timeline.html'), html.replace('__DATA__', projectData(canonical)));
for (const p of projects) writeFileSync(join(OUT, `timeline-${projectSlug(p)}.html`), html.replace('__DATA__', projectData(p)));
console.log(`timeline: ${slices.length} slices (${slices.filter((s) => s.v1).length} v1) · ${allRepoNames.length} repos · ${cleanEntries.length} ledger entries -> ${join(OUT, 'timeline.html')} + [${projects.map(projectSlug).join(', ')}]`);
