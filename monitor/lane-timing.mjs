// monitor/lane-timing.mjs — how long each lane takes, over time, from the evidence already on disk.
//
// NO NEW LEDGER. Every run already writes a per-repo `checks-status.json` carrying `check`,
// `status`, `durationMs` and `at`, and the batch directories are never overwritten — so the history
// exists and has existed since 2026-07-25. A parallel timing log would have started empty, would
// have had to be kept in step with the thing it duplicates, and would have been a second answer to
// a question that already has one.
//
// MEASURED BEFORE IT WAS BUILT, because the shape of the absence decides the shape of the graph:
// across 3,291 files and 82,927 rows, 40,446 carry a duration and 42,481 do not — and the split is
// exactly `skip`. 42,479 of the 42,481 absences are skipped lanes, and a skipped lane NEVER records
// a duration. So timing is complete for everything that ran, and the denominator here is RUNS, not
// rows. A skipped lane is not a fast lane; it is not on the timing axis at all, and it is counted
// separately so that saying so is possible.
//
// The other two absences are `noscan` rows with no duration: a lane that ran, produced nothing
// trustworthy, and was not timed. They are neither runs-with-a-duration nor skips, and they get
// their own counter rather than being rounded into whichever neighbour is convenient.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** A batch directory name that carries its own timestamp and area: `sweep-YYYYMMDDHHMMSS-<area>`. */
const BATCH_RE = /^sweep-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-(.+)$/;

/**
 * The area a batch directory belongs to, or null. NEVER a guess: 60 of the 1,576 directories on
 * disk are not sweep-prefixed at all (`100randomrepos`, `_partial-roll-0304`, `clientD-2026-07-25`),
 * and attributing one of those to the area a caller happened to ask about would put another
 * subject's timings on this subject's graph.
 */
export function batchArea(name) {
  const m = BATCH_RE.exec(String(name || ''));
  return m ? m[7] : null;
}

/** The batch's own start time, from its name. Informational — a row's `at` is the timing fact. */
export function batchStartedAt(name) {
  const m = BATCH_RE.exec(String(name || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/**
 * Every checks-status.json under the reports root.
 *
 * BOTH DEPTHS. The layout is `<root>/<batch>/<repo>/checks-status.json`, except where it is
 * `<root>/<batch>/checks-status.json` — one file on disk today has the second shape, and a reader
 * that knew only the first would have dropped it without a word. One file is a rounding error in
 * the numbers and a signature in the layout: whatever wrote that one can write more.
 *
 * A directed two-level walk rather than a recursive find: the recursive form descends into every
 * report subdirectory and takes 6.2s against 245ms for this, and this runs behind a panel request.
 */
export function statusFiles(root) {
  const out = [];
  let batches = [];
  try { batches = readdirSync(root, { withFileTypes: true }); }
  // A missing reports root is a legitimate absence; anything else is not, and must not read as
  // "no history". The caller gets the throw.
  catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const b of batches) {
    if (!b.isDirectory()) continue;
    const bdir = join(root, b.name);
    const shallow = join(bdir, 'checks-status.json');
    try { statSync(shallow); out.push({ file: shallow, batch: b.name, repo: null }); } catch { /* the usual shape */ }
    let inner = [];
    try { inner = readdirSync(bdir, { withFileTypes: true }); } catch { continue; }
    for (const r of inner) {
      if (!r.isDirectory()) continue;
      const f = join(bdir, r.name, 'checks-status.json');
      try { statSync(f); out.push({ file: f, batch: b.name, repo: r.name }); } catch { /* no status here */ }
    }
  }
  // Sorted so the same tree yields the same series in the same order, run to run.
  out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return out;
}

/** The rows in one status file, whatever container shape it uses. */
function rowsOf(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.checks)) return parsed.checks;
  if (parsed && typeof parsed === 'object') return Object.values(parsed).filter((v) => v && typeof v === 'object');
  return [];
}

const laneAcc = () => ({
  // runs that produced a duration — the only rows on the timing axis
  timed: 0,
  // ran, but nothing timed it. Two rows on disk today; a third state, not a fast run.
  untimed: 0,
  // did not run. NOT zero milliseconds, and not on the axis.
  skipped: 0,
  ok: 0, failed: 0, void: 0,
  samples: [],
  firstAt: null, lastAt: null,
});

/**
 * Per-lane timing over a window.
 *
 * @param {object} o
 * @param {string} o.root reports root (resolved by the caller; see area.mjs reportsRootDir)
 * @param {string|null} [o.area] restrict to one area's batches. A batch whose area cannot be read
 *   from its name is EXCLUDED when an area is named — never included on the chance it belongs.
 * @param {string|null} [o.since] ISO lower bound on a row's `at`, inclusive
 * @param {string|null} [o.until] ISO upper bound on a row's `at`, exclusive
 * @param {number} [o.maxSamples] per-lane cap on retained samples (newest kept)
 */
export function laneTiming({ root, area = null, since = null, until = null, maxSamples = 500 } = {}) {
  const lanes = new Map();
  const files = statusFiles(root);
  let read = 0;
  // Files that exist and could not be read are COUNTED, not skipped silently. A parse failure is
  // not an empty history, and a graph drawn over 3,000 of 3,291 files while claiming to describe
  // the fleet is a quieter lie than one that draws nothing.
  let unreadable = 0;
  let outOfArea = 0;
  let unattributed = 0;

  for (const { file, batch, repo } of files) {
    if (area) {
      const a = batchArea(batch);
      if (a === null) { unattributed++; continue; }
      if (a !== area) { outOfArea++; continue; }
    }
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
    catch { unreadable++; continue; }
    read++;
    for (const row of rowsOf(parsed)) {
      if (!row || typeof row !== 'object' || !row.check) continue;
      const at = typeof row.at === 'string' ? row.at : null;
      if (since && (!at || at < since)) continue;
      if (until && (!at || at >= until)) continue;
      const acc = lanes.get(row.check) || lanes.set(row.check, laneAcc()).get(row.check);
      if (at) {
        if (!acc.firstAt || at < acc.firstAt) acc.firstAt = at;
        if (!acc.lastAt || at > acc.lastAt) acc.lastAt = at;
      }
      if (row.status === 'pass') acc.ok++;
      else if (row.status === 'fail') acc.failed++;
      else if (row.status === 'noscan') acc.void++;
      // `skip` on the wire, `skipped` in some older rows: both mean the lane did not run.
      if (row.status === 'skip' || row.status === 'skipped') { acc.skipped++; continue; }
      if (typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs)) { acc.untimed++; continue; }
      acc.timed++;
      acc.samples.push({ at, ms: row.durationMs, status: row.status || null, repo: repo || null, batch });
    }
  }

  const out = {};
  for (const [check, acc] of lanes) {
    acc.samples.sort((a, b) => (a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : 0);
    const dropped = Math.max(0, acc.samples.length - maxSamples);
    const kept = dropped ? acc.samples.slice(-maxSamples) : acc.samples;
    out[check] = {
      timed: acc.timed, untimed: acc.untimed, skipped: acc.skipped,
      ok: acc.ok, failed: acc.failed, void: acc.void,
      firstAt: acc.firstAt, lastAt: acc.lastAt,
      ...quantiles(acc.samples.map((s) => s.ms)),
      // Truncation is DECLARED. A silently shortened series and a genuinely short one draw the
      // same picture, and only one of them is honest about what the reader is looking at.
      samples: kept, samplesDropped: dropped,
      daily: dailyMedians(acc.samples),
    };
  }
  return {
    lanes: out,
    files: { found: files.length, read, unreadable, outOfArea, unattributed },
    // The window as ASKED FOR, so a reader can tell an empty graph from an empty window.
    window: { area, since, until },
  };
}

/**
 * min/median/p95/max over a sample of durations. Empty answers nulls, never zeroes.
 *
 * NEAREST-RANK (rank = ceil(q x n)), so every value returned is a duration some run actually took.
 * The interpolating definitions would answer 20ms for a lane that ran twice at 10ms and 30ms — a
 * number describing no run, on a graph whose whole purpose is to show what runs cost.
 */
export function quantiles(ms) {
  const v = ms.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { min: null, p50: null, p95: null, max: null };
  const at = (q) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
  return { min: v[0], p50: at(0.5), p95: at(0.95), max: v[v.length - 1] };
}

/**
 * One point per UTC day: the median of that day's runs, and how many there were.
 *
 * The median rather than the mean because a lane's duration distribution here is dominated by
 * outliers — a cold container pull, a machine under a parallel sweep — and a mean turns one 8-hour
 * hang into a permanent step in the line. A day with no runs produces NO POINT: interpolating one
 * would draw a lane as having been measured on a day nobody measured it.
 */
export function dailyMedians(samples) {
  const byDay = new Map();
  for (const s of samples) {
    if (!s.at || typeof s.ms !== 'number') continue;
    const d = s.at.slice(0, 10);
    (byDay.get(d) || byDay.set(d, []).get(d)).push(s.ms);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, v]) => {
      v.sort((a, b) => a - b);
      return { day, runs: v.length, p50: v[Math.ceil(0.5 * v.length) - 1], min: v[0], max: v[v.length - 1] };
    });
}

/** Resolve the reports root, reading the env at CALL time so a test can point it at a fixture. */
export const timingRoot = (fallback) => resolve(process.env.CW_REPORTS_ROOT || fallback || 'reports');
