// admin/routes/fleet-overview.mjs — GET /api/fleet/overview: the whole fleet in one payload.
//
// WHAT THIS IS FOR. Every other read path in this panel answers a question about ONE project, and
// reportsFor() goes to some length to make sure it cannot accidentally answer with another's numbers.
// This route answers the question nothing answered: how many CVEs and KEVs does the fleet carry, how
// many areas are actually being swept, how healthy is that sweeping, and when did each area last
// scan. It is served as the panel's no-project-selected dashboard, so the alternative to it is not a
// different page — it is the empty prompt that stood there before.
//
// A FLEET TOTAL IS NOT A PROJECT'S POSTURE, and this route must never let one be read as the other.
// The panel's unselected branch deliberately refused to render fleet-wide numbers into the project
// KPI row (admin/index.html: "Nothing is shown for 'all projects'"), because the row is labelled with
// a project and filling it with a fleet sum makes the label a lie. That refusal stands. What changed
// is that the fleet now has a page of its OWN, labelled as the fleet, with per-area rows underneath
// every aggregate — so the number a reader acts on always names the population it came from.
//
// EVERY TOTAL CARRIES ITS DENOMINATOR. 44 area directories exist and not all of them have ever been
// swept; of those that have, not all consulted the KEV catalogue. Summing across them yields a number
// whose meaning depends entirely on how many areas contributed, and a sum printed without that count
// is the shape this repo indicts everywhere else: 0 KEV from a fleet with no exploited CVEs and 0 KEV
// from a catalogue that never loaded are the same digit and opposite facts. So `areasCounted` rides
// beside every aggregate, and the areas that could not contribute are listed by name rather than
// quietly dropped out of the denominator.
//
// FAIL CLOSED, AND ENOENT IS THE ONLY ABSENCE. A rollup that cannot be parsed is `unreadable` and
// contributes to NO total; a rollup that is not there is `never-swept`, which is a coverage void and
// is never a clean area. Both are counted and both are named. The one thing this route will not do
// is let a read failure look like a zero.
//
// HEALTH COMES FROM THE DEADMAN, NOT FROM A SECOND OPINION. monitor/liveness.mjs is what the hourly
// launchd agent runs and what decides whether the fleet alarms; its checkOne() is imported here
// rather than reimplemented, so the page and the alarm cannot disagree about whether an area is
// stale. That import is also why liveness.mjs's registry snapshot had to become call-time: this
// process runs for days.
//
// Every path is env-overridable at CALL time (CW_REGISTRY via registry(), CW_NOW for the clock), so
// the tests run entirely on fixtures.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CW, registry, registryStale } from '../lib/core.mjs';
import { areaOut } from '../../monitor/registry.mjs';
import { checkOne, RANK } from '../../monitor/liveness.mjs';
import { sliceScanIso } from '../../monitor/freshness.mjs';
import { readExportHealth, exportVerdict, summariseExports } from '../../monitor/memory-export-health.mjs';

// The clock, honoured at call time. CW_NOW makes the whole payload reproducible; an unparseable
// value falls back to the real clock rather than to NaN, and says so in the payload.
function nowFrom(nowMs) {
  if (Number.isFinite(nowMs)) return { ms: nowMs, source: 'caller' };
  const env = process.env.CW_NOW;
  if (env) {
    const t = Date.parse(env);
    if (Number.isFinite(t)) return { ms: t, source: 'CW_NOW' };
    return { ms: Date.now(), source: 'clock', note: `CW_NOW=${JSON.stringify(env)} could not be parsed — the real clock was used` };
  }
  return { ms: Date.now(), source: 'clock' };
}

// A single path segment, the same guard reportsFor() applies. An area whose declared `out` fails it
// is reported as MISDECLARED rather than skipped: a directory name this process refuses to build is
// a registry defect somebody has to see, and dropping the row hides an area entirely.
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

// ── WHAT TO DO ABOUT A STATE, WHICH IS NOT THE SAME QUESTION AS HOW BAD IT IS ───────────────────
// liveness.mjs's RANK orders states by severity, and that is the right input for an exit code: one
// number, worst wins. It is the wrong input for a dashboard headline, because states that rank alike
// can want opposite responses.
//
// MEASURED 2026-09-11, and this is why the split exists. The box was mid-sweep: 18 live sweep pids
// staggered 183-498 minutes, plus 3 markers whose pids were long dead. Ranked alone, that reads as
// "27 of 39 areas need attention", which is true of nothing — 15 of those areas had a sweep running
// in them at that moment and wanted no action whatever, while the 3 dead markers were the entire
// actionable content of the number and sat buried inside it.
//
// That is the failure liveness itself named when it SPLIT `overrunning` out of `hung`: "a reader can
// tell 'still working' from 'died without publishing' — they were the same word until 2026-08-23 and
// the word was wrong for every healthy run of the two biggest areas." This page had quietly
// re-merged them one layer up, in the summary, which is where a reader actually looks.
//
//   in-flight — a sweep is RUNNING in this area right now (live pid). Nothing to do; it is progress.
//   behind    — swept, but not recently enough or not completely enough. Wants scheduling attention.
//   broken    — the sweep or its evidence failed. Wants a human now.
//   ok        — rank 0: fresh, or deliberately quiet (paused/unscheduled/pending).
//
// FAILS CLOSED, and that is the half that matters: a state absent from this table is classified by
// its RANK, so anything liveness adds later surfaces as `broken` rather than falling out of every
// bucket into silence. The client is handed this map with the payload for the same reason it is
// handed RANK — a hand-kept copy grades the next state benign by omission.
const HEALTH_KIND = Object.freeze({
  fresh: 'ok', paused: 'ok', unscheduled: 'ok', pending: 'ok',
  overrunning: 'in-flight',
  stale: 'behind', degraded: 'behind', 'never-swept': 'behind', unjournaled: 'behind',
  hung: 'broken', expired: 'broken', unknown: 'broken', tampered: 'broken',
});
const kindOf = (state) => (Object.prototype.hasOwnProperty.call(HEALTH_KIND, state)
  ? HEALTH_KIND[state]
  // Unclassified: rank decides, and the benefit of the doubt goes the safe way. Same closed-set
  // discipline as groupOf() in the panel — a lookup whose miss path can return anything other than
  // the declared fallback is not a closed set.
  : ((RANK[state] ?? 3) >= 1 ? 'broken' : 'ok'));

const SEV_KEYS = ['crit', 'high', 'med', 'low'];
const zeroSev = () => ({ crit: 0, high: 0, med: 0, low: 0 });
const addSev = (into, from) => { for (const k of SEV_KEYS) into[k] += Number((from || {})[k]) || 0; };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Read one area's rollup, discriminating absence from corruption.
 * -> { state: 'ok'|'never-swept'|'unreadable', rollup?, detail? }
 * ENOENT is the ONLY code that means "legitimately absent". Everything else — EACCES, EISDIR, a
 * truncated write, a half-flushed file — is unreadable, because a permission error that reads as an
 * empty store is how a scanner reports a clean repo it was never allowed to open.
 */
function readRollup(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { state: 'never-swept' };
    return { state: 'unreadable', detail: e.code || String(e.message || e) };
  }
  try { return { state: 'ok', rollup: JSON.parse(raw) }; }
  catch (e) { return { state: 'unreadable', detail: `unparseable (${String(e.message || e).slice(0, 120)})` }; }
}

/**
 * The fleet overview.
 * @param {object} opts
 * @param {number} [opts.nowMs]   injected clock; otherwise CW_NOW, otherwise Date.now()
 * @param {object} [opts.reg]     an already-parsed registry; otherwise read at call time
 * @param {string} [opts.root]    reports root override, for fixtures
 */
export function fleetOverview({ nowMs, reg = null, root = null } = {}) {
  const clock = nowFrom(nowMs);
  let live = reg;
  if (!live) {
    // A registry that cannot be read is NOT an empty fleet. Returning {areas: []} here would render
    // as "nothing is declared, nothing to sweep" — the silent-green shape — so the whole payload
    // fails instead, with the reason, and the page says it cannot describe the fleet.
    try { live = registry(); }
    catch (e) { return { ok: false, reason: `the registry could not be read (${e.message}) — the fleet is UNKNOWN, not empty` }; }
  }

  const reportsRoot = root ? resolve(root) : resolve(CW, live.reportsRoot || 'reports');

  // ── the declared areas, then whatever else on disk holds a rollup ──────────────────────────────
  // An UNDECLARED directory carrying a rollup is real evidence about a real scan, and hiding it
  // would let an area be swept by hand and reported nowhere. It is bucketed separately because
  // nothing schedules it — the same distinction liveness.mjs draws with `unscheduled`.
  const declared = [];
  const misdeclared = [];
  const seenOut = new Set();
  for (const a of live.areas || []) {
    const out = areaOut(a.slug, live) || a.slug;
    if (!SAFE_SEGMENT.test(String(out || ''))) {
      misdeclared.push({ slug: a.slug || null, label: a.label || a.slug || null, out: out ?? null,
        reason: 'the declared report directory is not a single safe path segment, so no report path can be built for it' });
      continue;
    }
    seenOut.add(out);
    declared.push({
      slug: a.slug, label: a.label || a.slug, out,
      cadenceMs: num(a.cadenceMs),
      // Capped like every other free-text field this panel serves: a pause reason is an operator's
      // note and one of them is 1,400 characters of sweep archaeology. The page needs the fact and
      // its first sentence; the registry holds the whole thing.
      paused: a.paused ? { since: a.paused.since || null, reason: String(a.paused.reason || '').slice(0, 300) || null } : null,
      batch: a.rollupBatch ? String(a.rollupBatch) : null,
      declared: true,
    });
  }
  const undeclared = [];
  // null while the walk succeeded; an object naming the failure otherwise. Distinct from an empty
  // `undeclared` list, which is the positive claim that the walk ran and found none.
  let undeclaredScan = null;
  try {
    for (const d of readdirSync(reportsRoot, { withFileTypes: true })) {
      if (!d.isDirectory() || seenOut.has(d.name) || !SAFE_SEGMENT.test(d.name)) continue;
      if (!existsSync(join(reportsRoot, d.name, 'rollup.json'))) continue;
      undeclared.push({ slug: null, label: d.name, out: d.name, cadenceMs: null, paused: null, batch: null, declared: false });
    }
  } catch (e) {
    // The reports root itself could not be walked. Declared areas are still read below by exact
    // path, so the payload keeps its spine; what is lost is the ability to see undeclared ones, and
    // that loss is stated rather than presented as "there are none".
    undeclared.length = 0;
    undeclaredScan = { ok: false, reason: `the reports root could not be listed (${e.code || e.message}) — undeclared areas are UNKNOWN, not absent` };
  }

  const rows = [];
  for (const a of [...declared, ...undeclared].sort((x, y) => String(x.label).localeCompare(String(y.label)))) {
    const path = join(reportsRoot, a.out, 'rollup.json');
    const read = readRollup(path);

    // The deadman's verdict, from the deadman. `scheduled` is what makes an old undeclared rollup
    // report `unscheduled` (rank 0) instead of `expired` — an alarm nobody can satisfy gets muted —
    // and `missingOk` is what turns a declared area with no rollup into `never-swept` rather than a
    // generic read failure. Both flags mean exactly what they mean in liveness's own fan-out.
    let health = null;
    try {
      const r = checkOne(path, a.out, { scheduled: a.declared, missingOk: a.declared, nowMs: clock.ms });
      health = { state: r.state, rank: RANK[r.state] ?? 3, kind: kindOf(r.state), line: r.line };
    } catch (e) {
      // A health lane that could not run is UNKNOWN, and unknown ranks — never silence. Same rule
      // liveness.mjs applies to its own service and journal lanes.
      health = { state: 'unknown', rank: 3, kind: 'broken', line: `${a.out}: the freshness check itself failed (${e.message}) — health is UNKNOWN this read, not ok` };
    }

    // THE MEMORY-LAYER EXPORT, FROM ITS OWN RECEIPTS. The lane exits 0 on every outcome, so its
    // only evidence is the receipts file beside the rollup; `since` is the rollup's own stamp, so a
    // receipt predating the aggregation it was supposed to export reports `stale` rather than
    // passing last week's result off as this one's.
    const since = read.state === 'ok' && typeof read.rollup.generated === 'string' ? read.rollup.generated : null;
    const mh = readExportHealth({ dir: join(reportsRoot, a.out), since });
    const memoryExport = { ...exportVerdict(mh), area: a.label };

    const row = { ...a, read: read.state, health, memoryExport };
    if (read.state !== 'ok') {
      if (read.detail) row.readDetail = read.detail;
      rows.push(row);
      continue;
    }

    const j = read.rollup;
    const t = j.totals || {};
    const cve = t.cveTotals || null;
    // `generated` is re-stamped on every re-rollup; the sliceId stamp names when the SCAN ran and is
    // never rewritten. Both travel, under names that say which is which, because a page headed "last
    // scanned" that shows an aggregation time is answering a different question than the one asked.
    const scanAt = sliceScanIso(j.sliceId);
    Object.assign(row, {
      sliceId: j.sliceId || null,
      lastScannedAt: scanAt,
      lastRolledUpAt: j.generated || null,
      repos: { scanned: num((j.scanned || {}).repos), intended: num((j.scanned || {}).intendedRepos) },
      coverage: j.coverage
        ? { resolved: num(j.coverage.resolved), swept: num(j.coverage.swept),
          unsweptInScope: Array.isArray(j.coverage.unsweptInScope) ? j.coverage.unsweptInScope.length : null }
        : null,
      // Two populations, never added together. `all` is every scanner lane minus the excluded ones;
      // `cve` is the dependency-CVE feed alone. They are different questions and the rollup keeps
      // them apart for that reason (monitor/extractors.mjs sumTotals), so this does too.
      all: { ...zeroSev(), ...Object.fromEntries(SEV_KEYS.map((k) => [k, Number(t[k]) || 0])), undetermined: num(t.undetermined) },
      cve: cve
        ? { ...Object.fromEntries(SEV_KEYS.map((k) => [k, Number(cve[k]) || 0])), unknown: num(cve.unknown), cves: num(cve.cves) }
        : null,
      // TRI-STATE ON PURPOSE. `kevConsulted !== true` means this area's KEV figure is not a
      // measurement, whether because the catalogue failed to load or because the rollup predates the
      // flag. It is excluded from the fleet KEV total and named in the payload instead.
      kev: { count: num(t.kev), claimed: num(t.kevClaimed), consulted: t.kevConsulted === true ? true : (t.kevConsulted === false ? false : null) },
    });
    rows.push(row);
  }

  // ── aggregates, each with the population it was summed over ────────────────────────────────────
  const usable = rows.filter((r) => r.read === 'ok');
  const totals = {
    all: { ...zeroSev(), undetermined: 0, areasCounted: 0 },
    cve: { ...zeroSev(), unknown: 0, cves: 0, areasCounted: 0, areasWithoutCveTotals: [] },
    kev: { count: 0, claimed: 0, areasConsulted: 0, areasNotConsulted: [], areasUnknown: [] },
  };
  for (const r of usable) {
    addSev(totals.all, r.all);
    totals.all.undetermined += Number(r.all.undetermined) || 0;
    totals.all.areasCounted++;
    if (r.cve) {
      addSev(totals.cve, r.cve);
      totals.cve.unknown += Number(r.cve.unknown) || 0;
      totals.cve.cves += Number(r.cve.cves) || 0;
      totals.cve.areasCounted++;
    } else {
      // A rollup written before cveTotals existed. Its CVE split is not zero, it is absent.
      totals.cve.areasWithoutCveTotals.push(r.label);
    }
    if (r.kev.consulted === true) {
      totals.kev.count += Number(r.kev.count) || 0;
      totals.kev.claimed += Number(r.kev.claimed) || 0;
      totals.kev.areasConsulted++;
    } else if (r.kev.consulted === false) totals.kev.areasNotConsulted.push(r.label);
    else totals.kev.areasUnknown.push(r.label);
  }

  // ── fleet status: what exists, what has been swept, what never has ─────────────────────────────
  const neverSwept = rows.filter((r) => r.read === 'never-swept');
  const unreadable = rows.filter((r) => r.read === 'unreadable');
  const status = {
    areasDeclared: declared.length,
    areasUndeclaredOnDisk: undeclared.length,
    areasMisdeclared: misdeclared,
    swept: usable.length,
    neverSwept: neverSwept.map((r) => r.label),
    unreadable: unreadable.map((r) => ({ area: r.label, detail: r.readDetail || null })),
    paused: rows.filter((r) => r.paused).map((r) => r.label),
    // Repos, summed only over areas that reported a figure — the same denominator discipline as the
    // severity totals above. `resolved` is what discovery found in scope; `swept` is what the slice
    // actually scanned, and the gap between them is the coverage void.
    repos: usable.reduce((acc, r) => {
      const s = r.repos.scanned;
      if (s != null) { acc.scanned += s; acc.areasCounted++; }
      if (r.coverage && r.coverage.resolved != null) acc.resolvedSeen = Math.max(acc.resolvedSeen, r.coverage.resolved);
      return acc;
    }, { scanned: 0, areasCounted: 0, resolvedSeen: 0 }),
  };

  // ── fleet health: the deadman's states, tallied, worst first ───────────────────────────────────
  const byState = {};
  for (const r of rows) byState[r.health.state] = (byState[r.health.state] || 0) + 1;
  const alarming = rows.filter((r) => r.health.rank >= 1)
    .sort((a, b) => b.health.rank - a.health.rank || String(a.label).localeCompare(String(b.label)))
    .map((r) => ({ area: r.label, slug: r.slug, state: r.health.state, rank: r.health.rank, line: r.health.line, kind: kindOf(r.health.state) }));
  const groups = { ok: [], 'in-flight': [], behind: [], broken: [] };
  for (const r of rows) groups[kindOf(r.health.state)].push(r.label);
  const health = {
    byState,
    worstRank: rows.reduce((n, r) => Math.max(n, r.health.rank), 0),
    // The rank vocabulary, so the client renders a state it has never heard of as ALARMING rather
    // than as unstyled text. liveness.mjs adds states over time and a hand-kept client copy would
    // grade the next one as clean by omission.
    rankOf: Object.fromEntries(Object.entries(RANK)),
    // The same partition the client headlines on, computed HERE so every consumer agrees. Rank
    // orders severity; kind says what to DO, and one number cannot carry both.
    kindOf: Object.fromEntries(Object.entries(HEALTH_KIND)),
    groups,
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    // What actually wants a human. `in-flight` is deliberately NOT in it — see HEALTH_KIND.
    needsAttention: groups.broken.length + groups.behind.length,
    alarming,
    clean: rows.length - alarming.length,
  };

  // ── last scanned ───────────────────────────────────────────────────────────────────────────────
  // Ordered on the SCAN time, falling back to the roll-up stamp only for rows whose sliceId carried
  // no parseable stamp — and those rows say which basis was used, because "scanned 3 days ago" and
  // "aggregated 3 days ago" are different claims and only one of them is about a scan.
  const dated = usable.map((r) => {
    const basis = r.lastScannedAt ? 'scan' : (r.lastRolledUpAt ? 'rollup' : null);
    const at = r.lastScannedAt || r.lastRolledUpAt || null;
    const ms = at ? Date.parse(at) : NaN;
    return { area: r.label, slug: r.slug, at, basis, ageMs: Number.isFinite(ms) ? Math.max(0, clock.ms - ms) : null, state: r.health.state };
  }).filter((x) => x.ageMs != null).sort((a, b) => a.ageMs - b.ageMs);
  const lastScanned = {
    newest: dated[0] || null,
    oldest: dated[dated.length - 1] || null,
    // Rows whose timestamp could not be parsed at all are UNDATED, not old — sorting them to one end
    // would put a fabricated position on a number nobody has.
    undated: usable.filter((r) => !r.lastScannedAt && !r.lastRolledUpAt).map((r) => r.label),
    areas: dated,
  };

  return {
    ok: true,
    generatedAt: new Date(clock.ms).toISOString(),
    clock: clock.source === 'clock' ? { source: 'clock', ...(clock.note ? { note: clock.note } : {}) } : { source: clock.source },
    reportsRoot,
    // Surfaced, never swallowed: while the panel serves a last-good registry the operator is reading
    // a fleet that may already have been re-declared.
    registryStale: registryStale(),
    ...(undeclaredScan ? { undeclaredScan } : {}),
    totals, status, health, lastScanned,
    // A SEPARATE LANE WITH A SEPARATE VERDICT. The sweep can be fresh and clean while every record
    // it produced failed to reach the backend, so this is never folded into `health` — summing them
    // would let an export outage be answered by a recent scan.
    memoryExport: summariseExports(rows.map((r) => r.memoryExport)),
    areas: rows,
  };
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────
// Same gate as the rest of the panel's read routes: loopback operator OR a signed-in session. The
// payload names every area on the box, which is the class of detail the published port keeps behind
// a session — so remote-without-session gets a 401, never a redacted half-answer.
const authed = (ctx) => {
  if (ctx.isLoopbackReq) return { who: 'operator@loopback' };
  const s = ctx.adminSession && ctx.adminSession(ctx.req);
  // Sessions store `user` as the account's email (routes/auth.mjs); an object shape is tolerated.
  if (!s || !s.user) return null;
  return { who: typeof s.user === 'string' ? s.user : (s.user.email || s.user.name || 'session') };
};

// ── A SHORT CACHE, IN THE ROUTE AND NOT IN THE FUNCTION ─────────────────────────────────────────
// Measured on the live tree: ~420 ms per assembly, because it reads 39 rollups and three of them are
// 42 MB — and each is parsed twice, once here and once inside checkOne(), which takes a path rather
// than a parsed object. This is the panel's DEFAULT landing page now, so every open pays that, and a
// reload held down would queue hundreds of megabytes of parsing behind itself.
//
// 15 s, against a client that polls at 30 s: a poll always recomputes, while a burst — several tabs,
// a reload, two operators — shares one assembly. THE STALENESS IS NOT HIDDEN: `generatedAt` is
// stamped when the payload was ASSEMBLED, not when it was served, so a reader comparing it to the
// clock sees the real age rather than a timestamp the cache refreshed on the way out. That is the
// whole reason the stamp is inside fleetOverview() rather than added here.
//
// Deliberately NOT inside fleetOverview(): the pure function stays pure, so a test injecting nowMs
// or a fixture root measures what it asked for rather than whatever a previous call left behind.
const CACHE_MS = 15_000;
let _cache = null;

export const routes = [
  {
    method: 'GET', path: '/api/fleet/overview',
    handle: (ctx) => {
      if (!authed(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
      if (_cache && Date.now() - _cache.at < CACHE_MS) return ctx.send(_cache.body.ok ? 200 : 503, _cache.body);
      let body;
      try { body = fleetOverview({}); }
      catch (e) { return ctx.send(500, { ok: false, reason: `the fleet overview could not be assembled (${e.message}) — nothing below is a reading` }); }
      // A FAILED assembly is cached too, and on purpose: a broken registry re-read 39 rollups every
      // 30 s to produce the same refusal. The reason travels with it, so nothing about the failure
      // is quieter for having been remembered.
      _cache = { at: Date.now(), body };
      return ctx.send(body.ok ? 200 : 503, body);
    },
  },
];

export default routes;
