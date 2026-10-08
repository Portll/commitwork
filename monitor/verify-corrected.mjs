#!/usr/bin/env node
// commitwork monitor — acceptance checks for the corrected history. Exits non-zero on violation.
// The load-bearing invariant: the corrected record NEVER implies a service was clean when it
// was merely invisible (blind-jvm), surface-less, excluded, or unscanned.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { outDirFor, ambientArea } from './area.mjs'; // THE OUT resolver: CW_MONITOR_OUT, then the area's out
import { loadRegistry } from './registry.mjs';
import { programWorklistPathFor } from './store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// Fail loud — a swallowed broken registry could print ALL CHECKS PASS against the wrong dir
const REG = loadRegistry();
const OUT = outDirFor(null, REG);
const corr = JSON.parse(readFileSync(join(OUT, 'history', 'corrected', 'index.json'), 'utf8'));
const ledger = JSON.parse(readFileSync(join(OUT, 'remediation-ledger.json'), 'utf8'));

let fail = 0;
const bad = (m) => { console.error('FAIL:', m); fail++; };
const ok = (m) => console.log('  ok:', m);
// UNMEASURED IS ITS OWN CHANNEL, outside pass and outside fail.
//
// Four checks here caught their own read failure and reported it through ok() — `ok: worklist: not
// present ... skipped` — and the summary at the bottom then printed ALL CHECKS PASS. A verifier
// whose skip path is indistinguishable from its pass path certifies whatever it could not read, and
// the three worklist/reconcile checks became skip-by-default the moment the record moved to the
// sidecar: on any machine without it mounted this script asserted the worklist was dependency-
// ordered and fully cited while never having opened it. Counted and surfaced separately, because an
// absent private input is also not a FINDING — over-reporting is not the safe direction either.
let unmeasured = 0;
const unknown = (m) => { console.log('  ??:', m); unmeasured++; };

// 1. never-imply-clean: no gradle-surface repo may be clean-visible in a clones-era slice
let blind = 0, cleanGradleClones = 0;
for (const sl of corr.slices) for (const [name, v] of Object.entries(sl.repos)) {
  if (sl.subject.era === 'clones' && v.surface && v.surface.includes('gradle')) {
    if (v.state === 'clean-visible') { cleanGradleClones++; bad(`${name}@${sl.stamp}: gradle surface rendered clean-visible in clones era`); }
    if (v.state === 'blind-jvm') blind++;
  }
}
if (!cleanGradleClones) ok(`never-imply-clean holds: 0 gradle repos clean-visible in clones era (${blind} blind-jvm cells)`);

// 2. count-tier monotonicity: canonical <= distinct <= raw per slice
for (const sl of corr.slices) {
  const f = sl.fleet;
  if (!(f.canonical <= f.distinct && f.distinct <= f.raw)) bad(`${sl.stamp}: tier monotonicity broken raw=${f.raw} distinct=${f.distinct} canonical=${f.canonical}`);
}
ok('tier monotonicity: canonical <= distinct <= raw across all slices');

// 3. empty-run carries no repos and is labelled
for (const sl of corr.slices) if (sl.event.kind === 'empty-run' && Object.keys(sl.repos).length > 0) bad(`${sl.stamp}: empty-run has ${Object.keys(sl.repos).length} repos`);
ok('empty-run slices carry zero repo cells');

// 4. excluded repos visible as excluded from the exclusion stamp onward (empty runs say nothing)
for (const sl of corr.slices) if (sl.stamp >= corr.excludedFrom && sl.event.kind !== 'empty-run') for (const x of corr.excludedRepos)
  if (!sl.repos[x] || sl.repos[x].state !== 'excluded') bad(`${sl.stamp}: ${x} not rendered excluded`);
ok(`excluded repos rendered as excluded (never blank) from ${corr.excludedFrom}`);

// 4b. superseded repos: distinct state from each repo's OWN effectiveFrom onward — never blank,
//     never clean/excluded, never superseded BEFORE effectiveFrom; rows must cite
//     supersededBy+effectiveFrom+note, and the exclude list stays untouched by lifecycle
const life = corr.lifecycle || {};
// batch-stamp comparator — the gate keys on the sweep dir stamp, same derivation as the builder
const bstampOf = (sl) => ((String(sl.sliceId || '').match(/sweep-(\d{14})/) || [])[1]) || sl.stamp;
for (const x of corr.excludedRepos) if (life[x]) bad(`lifecycle: ${x} is in BOTH the exclude list and the lifecycle map — exclude semantics must stay byte-identical`);
for (const [name, lc] of Object.entries(life)) {
  if (lc.state !== 'superseded') continue;
  if (!lc.supersededBy || !lc.effectiveFrom || !lc.note) bad(`lifecycle ${name}: superseded row missing supersededBy/effectiveFrom/note citation`);
  for (const sl of corr.slices) {
    if (sl.event.kind === 'empty-run') continue;
    const bs = bstampOf(sl);
    const inWindow = bs >= lc.effectiveFrom && (!lc.effectiveTo || bs < lc.effectiveTo);
    const v = sl.repos[name];
    if (inWindow) {
      if (!v) bad(`${sl.stamp}: ${name} superseded but rendered blank`);
      else if (!['superseded', 'findings', 'accepted-only'].includes(v.state)) bad(`${sl.stamp}: ${name} superseded but rendered '${v.state}' (must never read clean/excluded)`);
    } else if (v && v.state === 'superseded') bad(`${sl.stamp}: ${name} rendered superseded OUTSIDE its lifecycle window [${lc.effectiveFrom}, ${lc.effectiveTo || '∞'})`);
  }
}
ok(`superseded repos render distinct (rollback standby) from per-repo effectiveFrom onward, never before (${Object.values(life).filter((l) => l.state === 'superseded').length} lifecycle rows)`);

// 4c. no scope-change event without a citation
for (const sl of corr.slices) if (sl.event.kind === 'scope-change' && !((sl.event.citations || []).length && sl.event.note && sl.event.note.trim()))
  bad(`${sl.stamp}: scope-change event carries no citation`);
ok('every scope-change event carries a citation');

// 5. every v0 'fixed' claim >0 has a reclassification kind
for (const sl of corr.slices) if (!sl.v1 && (sl.recordedIndexRow.fixed || 0) > 0 && sl.event.kind === 'unclassified')
  bad(`${sl.stamp}: fixed=${sl.recordedIndexRow.fixed} but event unclassified`);
ok('all v0 fixed-claims carry a reclassification');

// 6. ledger integrity: tiers valid, strong has version evidence, weak never counted cleaned
let sN = 0, mN = 0, wN = 0;
for (const e of ledger.entries) {
  const t = e.evidence?.tier;
  if (!['strong', 'medium', 'weak'].includes(t)) bad(`ledger ${e.key}: bad tier ${t}`);
  if (t === 'strong' && !e.fromVersion) bad(`ledger ${e.key}: strong without fromVersion`);
  if (t === 'strong') sN++; else if (t === 'medium') mN++; else wN++;
}
ok(`ledger: ${ledger.entries.length} entries (strong=${sN} medium=${mN} unconfirmed=${wN}; unconfirmed excluded from cleaned counts)`);

// 7. timeline2.html embeds parseable data
const html = readFileSync(join(OUT, 'timeline2.html'), 'utf8');
const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) bad('timeline2.html: no embedded data block');
else { try { const d = JSON.parse(m[1].replace(/<\\\//g, '</')); ok(`timeline2.html data parses: ${d.slices.length} slices, ${d.repoNames.length} repos, ${d.ledger.length} ledger rows`); } catch (e) { bad(`timeline2.html data unparseable: ${e.message}`); } }

// 8. dimensions exist with dated snapshots
for (const k of ['jvm', 'images', 'codeql', 'runtime']) {
  try {
    const d = JSON.parse(readFileSync(join(OUT, 'history', 'corrected', 'dimensions', `${k}.json`), 'utf8'));
    if (!d.snapshots.length) bad(`dimension ${k}: no snapshots`);
    else if (!d.snapshots.every((s) => s.source || s.error)) bad(`dimension ${k}: snapshot without source citation`);
    else ok(`dimension ${k}: ${d.snapshots.length} snapshots, all source-cited`);
  } catch (e) { bad(`dimension ${k}: ${e.message}`); }
}

// 9. program worklist integrity: unique ids, deps resolve to EARLIER rows (dependency-ordered),
//    status enum valid, evidence cited on every row
// The worklist is a private record: absent (ENOENT) is NOT CHECKED, anything else a failure.
const WORKLIST = programWorklistPathFor(CW);
const readWorklist = () => {
  try { return JSON.parse(readFileSync(WORKLIST, 'utf8')); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }
};
try {
  const wl = readWorklist();
  if (!wl) unknown(`worklist integrity: NOT CHECKED — absent at ${WORKLIST} (private record — mount the sidecar)`);
  for (const p of wl?.programs || []) {
    const seen = new Set();
    for (const it of p.items) {
      if (seen.has(it.id)) bad(`worklist ${p.key}: duplicate id ${it.id}`);
      for (const d of it.deps || []) if (!seen.has(d)) bad(`worklist ${p.key}: ${it.id} depends on ${d} which does not appear above it`);
      if (!['done', 'gated', 'open'].includes(it.status)) bad(`worklist ${p.key}: ${it.id} bad status ${it.status}`);
      if (!it.evidence) bad(`worklist ${p.key}: ${it.id} has no evidence citation`);
      seen.add(it.id);
    }
    ok(`worklist ${p.key}: ${p.items.length} items dependency-ordered, all cited`);
  }
} catch (e) { bad(`worklist: unreadable or malformed (${e.message.split('\n')[0]})`); }

// 9b. worklist reconcile COVERAGE: every program key must be resolver-backed OR explicitly
//     prose-only — a program with neither fails loudly
try {
  const wl = readWorklist();
  const { RESOLVER_KEYS, PROSE_ONLY_PROGRAMS } = await import('./worklist-reconcile.mjs');
  const covered = new Set([...(RESOLVER_KEYS || []), ...PROSE_ONLY_PROGRAMS]);
  const uncovered = (wl?.programs || []).map((p) => p.key).filter((k) => !covered.has(k));
  if (!wl) unknown(`worklist reconcile coverage: NOT CHECKED — absent at ${WORKLIST} (private record — mount the sidecar)`);
  else if (uncovered.length) bad(`worklist reconcile: program(s) with no resolver AND not prose-only marked: ${uncovered.join(', ')} (add a resolver or list in PROSE_ONLY_PROGRAMS)`);
  else ok(`worklist reconcile: all ${(wl.programs || []).length} programs are resolver-backed or explicitly prose-only`);
} catch (e) { bad(`worklist reconcile coverage: could not run (${e.message.split('\n')[0]})`); }

// 9c. authored-judgment convention conforms; action/disposition never cross-contaminate
try {
  const { validateAll } = await import('./validate-authored-judgment.mjs');
  const absent = [];
  const v = validateAll(undefined, { absent });
  if (v.length) for (const m of v) bad(`authored-judgment: ${m}`);
  else if (absent.length < 3) ok(`authored-judgment: ${3 - absent.length} of 3 private records conform (action/disposition uncontaminated)`);
  if (absent.length) unknown(`authored-judgment: NOT CHECKED for ${absent.length} of 3, absent (ENOENT): ${absent.join(', ')}`);
} catch (e) { unknown(`authored-judgment: NOT CHECKED — ${e.message.split('\n')[0]}`); }

// 9d. reconciler resolver-semantics tests pass
try {
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', [join(HERE, 'worklist-reconcile.test.mjs')], { stdio: 'ignore' });
  ok('worklist reconcile: resolver-semantics tests pass');
} catch (e) {
  if (e && e.status === 1) bad('worklist reconcile: resolver-semantics tests FAILED (run node monitor/worklist-reconcile.test.mjs)');
  else unknown(`worklist reconcile tests: NOT CHECKED — ${e.message.split('\n')[0]}`);
}

// 10. infra-image acceptance benchmark: every target-state CRIT fixed-by-track or accepted-with-containment
try {
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', [join(HERE, 'image-acceptance.mjs'), '--strict'], { stdio: 'ignore' });
  ok('image-acceptance benchmark: CRIT clean (all target-state crits fixed-by-track or accepted-with-containment)');
} catch (e) {
  if (e && e.status === 1) bad('image-acceptance benchmark: unaccounted target-state CRIT or containment gap (run node monitor/image-acceptance.mjs)');
  else unknown('image-acceptance benchmark: NOT CHECKED — no deployed scan or ledger');
}

// 11. cross-surface (optional): scanner lifecycle vs modernization-map roster. Set-based, never
//     count-based (the two surfaces cover different populations). Absent map = visible SKIP;
//     present-but-broken map = FAILURE. map/data/ is SLUG space, not out-dir space — an output
//     dir matching no declared area cannot name a slug, and that is a SKIP with its reason.
const MAP_AREA = ambientArea(REG, OUT).slug;
const MAP = process.env.CW_MODMAP
  ? resolve(process.env.CW_MODMAP)
  : (MAP_AREA ? join(CW, 'map', 'data', MAP_AREA, 'migration-state.json') : null);
if (!MAP) {
  unknown('cross-surface roster check: NOT CHECKED — this output dir matches no declared area, so map/data/<slug>/ '
    + 'cannot be named (declare the area in monitor/projects.json, or set CW_MODMAP to check anyway)');
} else try {
  const map = JSON.parse(readFileSync(MAP, 'utf8'));
  const scanSup = new Set(Object.entries(corr.lifecycle || {}).filter(([, l]) => l.state === 'superseded').map(([n]) => n));
  const mapSup = new Set((map.roster || []).filter((r) => r.lifecycle && r.lifecycle.state === 'superseded').map((r) => r.id));
  const onlyScan = [...scanSup].filter((n) => !mapSup.has(n));
  const onlyMap = [...mapSup].filter((n) => !scanSup.has(n));
  if (onlyScan.length || onlyMap.length) bad(`cross-surface: superseded sets disagree — scanner-only [${onlyScan.join(', ')}] map-only [${onlyMap.join(', ')}] (${MAP})`);
  else ok(`cross-surface: superseded sets agree (${scanSup.size} repos) between scanner lifecycle and modernization-map roster`);
  const rosterIds = new Set((map.roster || []).map((r) => r.id));
  const missingSucc = [...new Set(Object.values(corr.lifecycle || {}).filter((l) => l.state === 'superseded').map((l) => l.supersededBy))].filter((s) => s && !rosterIds.has(s));
  if (missingSucc.length) bad(`cross-surface: successor services missing from modernization-map roster: ${missingSucc.join(', ')}`);
  else ok('cross-surface: every successor service present in the modernization-map roster');
} catch (e) {
  if (e.code === 'ENOENT') unknown(`cross-surface roster check: NOT CHECKED — modernization map absent at ${MAP}`);
  else bad(`cross-surface roster check: map present but unreadable: ${e.message.split('\n')[0]}`);
}

// The summary may not say PASS over a check that never ran. `unmeasured` is reported on its own
// line and in the headline, and it does NOT set the exit code: an unmounted private store is not a
// finding against the fleet, and exiting 1 on it would train readers to ignore the exit code.
if (unmeasured) console.log(`\n${unmeasured} CHECK(S) NOT MEASURED — see ?? lines above`);
console.log(fail ? `\n${fail} FAILURES` : (unmeasured ? `\nNO FAILURES among the checks that ran (${unmeasured} not measured)` : '\nALL CHECKS PASS'));
process.exit(fail ? 1 : 0);
