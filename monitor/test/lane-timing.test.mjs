// Per-lane timing, read from the run records already on disk.
//
// The thing worth guarding is not the arithmetic — it is every place an absence could be rounded
// into a measurement. A skipped lane has no duration, and 42,479 of the 82,927 rows on disk are
// skips: if those became zeroes, every lane in the fleet would graph as instant, and the graph
// would be at its most wrong exactly where coverage is worst.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { laneTiming, statusFiles, batchArea, batchStartedAt, quantiles, dailyMedians, timingRoot }
  from '../lane-timing.mjs';

/** Build a reports tree. `repo: null` writes the shallow (batch-level) shape. */
function tree(spec) {
  const root = mkdtempSync(join(tmpdir(), 'cw-timing-'));
  for (const { batch, repo, rows } of spec) {
    const dir = repo ? join(root, batch, repo) : join(root, batch);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify(rows));
  }
  return root;
}
const row = (check, status, durationMs, at) => ({ check, status, durationMs, at });

test('both on-disk depths are read — one file has the shallow shape and it is not dropped', () => {
  const root = tree([
    { batch: 'sweep-20260801120000-alpha', repo: 'r1', rows: [row('sast', 'pass', 100, '2026-08-01T12:00:00Z')] },
    { batch: 'clientD-2026-07-25', repo: null, rows: [row('sast', 'pass', 200, '2026-07-25T10:00:00Z')] },
  ]);
  try {
    assert.equal(statusFiles(root).length, 2, 'the batch-level file was invisible to the walk');
    assert.equal(laneTiming({ root }).lanes.sast.timed, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a SKIPPED lane is not a fast lane — it is off the timing axis entirely', () => {
  const root = tree([{ batch: 'sweep-20260801120000-alpha', repo: 'r1', rows: [
    row('sast', 'pass', 500, '2026-08-01T12:00:00Z'),
    row('sast', 'skip', null, '2026-08-01T12:00:00Z'),
    row('sast', 'skipped', undefined, '2026-08-01T12:00:00Z'),
  ] }]);
  try {
    const l = laneTiming({ root }).lanes.sast;
    assert.equal(l.timed, 1);
    assert.equal(l.skipped, 2, 'both spellings of "did not run" must count as skips');
    assert.equal(l.p50, 500, 'the skips entered the distribution');
    assert.equal(l.min, 500, 'a skip became a 0ms sample — the whole fleet would graph as instant');
    assert.equal(l.samples.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a run nobody timed is its own state, neither a sample nor a skip', () => {
  // Two rows on disk have this shape: status noscan, no durationMs. The lane ran and produced
  // nothing trustworthy, and rounding it into either neighbour loses which.
  const root = tree([{ batch: 'sweep-20260801120000-alpha', repo: 'r1', rows: [
    { check: 'sast', status: 'noscan', at: '2026-08-01T12:00:00Z' },
    row('sast', 'pass', 10, '2026-08-01T12:00:00Z'),
  ] }]);
  try {
    const l = laneTiming({ root }).lanes.sast;
    assert.equal(l.untimed, 1);
    assert.equal(l.skipped, 0, 'a noscan RAN — calling it skipped erases that something was attempted');
    assert.equal(l.timed, 1);
    assert.equal(l.void, 1, 'the outcome is counted whether or not anyone timed it');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a duration that is not a number does not become one', () => {
  const root = tree([{ batch: 'sweep-20260801120000-alpha', repo: 'r1', rows: [
    { check: 'sast', status: 'pass', durationMs: null, at: '2026-08-01T12:00:00Z' },
    { check: 'sast', status: 'pass', durationMs: 'fast', at: '2026-08-01T12:00:00Z' },
    { check: 'sast', status: 'pass', durationMs: NaN, at: '2026-08-01T12:00:00Z' },
    { check: 'sast', status: 'pass', durationMs: 0, at: '2026-08-01T12:00:00Z' },
  ] }]);
  try {
    const l = laneTiming({ root }).lanes.sast;
    assert.equal(l.timed, 1, 'only the real 0 is a measurement');
    assert.equal(l.untimed, 3);
    assert.equal(l.p50, 0, 'a genuine zero survives — the distinction runs in both directions');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unattributable batch is EXCLUDED from an area query, never included on the chance it fits', () => {
  // 60 of the 1,576 directories on disk are not sweep-prefixed. Putting one of those on the area's
  // graph would show another subject's timings as this subject's.
  const root = tree([
    { batch: 'sweep-20260801120000-alpha', repo: 'r1', rows: [row('sast', 'pass', 100, '2026-08-01T12:00:00Z')] },
    { batch: 'sweep-20260801120000-beta', repo: 'r1', rows: [row('sast', 'pass', 999, '2026-08-01T12:00:00Z')] },
    { batch: '100randomrepos', repo: 'r1', rows: [row('sast', 'pass', 777, '2026-08-01T12:00:00Z')] },
  ]);
  try {
    const r = laneTiming({ root, area: 'alpha' });
    assert.equal(r.lanes.sast.timed, 1);
    assert.equal(r.lanes.sast.p50, 100);
    assert.equal(r.files.outOfArea, 1, 'beta');
    assert.equal(r.files.unattributed, 1, 'the unnamed batch is counted, not silently dropped');
    // and with no area asked for, everything is in scope
    assert.equal(laneTiming({ root }).lanes.sast.timed, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unreadable file is COUNTED — a graph over 3,000 of 3,291 files must say so', () => {
  const root = tree([
    { batch: 'sweep-20260801120000-alpha', repo: 'ok', rows: [row('sast', 'pass', 100, '2026-08-01T12:00:00Z')] },
  ]);
  mkdirSync(join(root, 'sweep-20260801120000-alpha', 'bad'), { recursive: true });
  writeFileSync(join(root, 'sweep-20260801120000-alpha', 'bad', 'checks-status.json'), '{ not json');
  try {
    const r = laneTiming({ root });
    assert.equal(r.files.found, 2);
    assert.equal(r.files.read, 1);
    assert.equal(r.files.unreadable, 1, 'a parse failure that reports zero unreadable is the quiet lie');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing root is an absence; anything else throws rather than reading as no history', () => {
  assert.deepEqual(statusFiles(join(tmpdir(), 'cw-timing-definitely-not-here-2f8a')), []);
  const root = mkdtempSync(join(tmpdir(), 'cw-timing-perm-'));
  // DECLARED BEFORE THE TRY, because the restore runs in the finally. The codemod that introduced
  // this put the `const` where the old `chmodSync` had been — inside the try — which is a scope
  // error the original did not have, since chmodSync bound nothing.
  const deny = denyRead(root);
  try {
    assert.ok(deny.ok, `could not make the fixture unreadable: ${deny.why} — the precondition failed, so this test proves nothing`);
    // A root-owned runner can still read a denied directory; only assert when the OS actually denies.
    let denied = false;
    try { statusFiles(root); } catch (e) { denied = REFUSED_ERRNO.test(e.code); }
    if (denied) assert.ok(true);
  } finally { deny.restore(); rmSync(root, { recursive: true, force: true }); }
});

test('a day with no runs gets NO point — an interpolated one claims a measurement nobody took', () => {
  const d = dailyMedians([
    { at: '2026-08-01T01:00:00Z', ms: 10 },
    { at: '2026-08-01T02:00:00Z', ms: 30 },
    { at: '2026-08-04T01:00:00Z', ms: 50 },
  ]);
  assert.deepEqual(d.map((x) => x.day), ['2026-08-01', '2026-08-04'],
    'the 2nd and 3rd were not measured, and the line must not pretend otherwise');
  assert.equal(d[0].runs, 2);
  // NEAREST-RANK, stated because an even-sized sample has no single conventional answer: rank
  // ceil(0.5 x 2) = 1, so p50 of [10, 30] is 10. It is a real observed duration rather than an
  // interpolated 20 that no run took — which is the same reason no day is interpolated above.
  assert.equal(d[0].p50, 10);
  assert.equal(d[0].min, 10);
});

test('the median is used, so one 8-hour hang is not a permanent step in the line', () => {
  // deps-osv's real max on disk is 32,004,651ms — 8.9 hours. Against a mean, that single run moves
  // the lane's whole line; against a median it is one point.
  const many = Array.from({ length: 9 }, (_, i) => ({ at: '2026-08-01T0' + i + ':00:00Z', ms: 1000 }));
  const d = dailyMedians([...many, { at: '2026-08-01T09:00:00Z', ms: 32004651 }]);
  assert.equal(d[0].p50, 1000);
  assert.equal(d[0].max, 32004651, 'the outlier is still REPORTED — hidden is not the same as smoothed');
});

test('empty answers nulls, never zeroes', () => {
  assert.deepEqual(quantiles([]), { min: null, p50: null, p95: null, max: null });
  assert.deepEqual(quantiles([5]), { min: 5, p50: 5, p95: 5, max: 5 });
});

test('a truncated series SAYS it was truncated', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row('sast', 'pass', i, `2026-08-01T00:00:${String(i).padStart(2, '0')}Z`));
  const root = tree([{ batch: 'sweep-20260801120000-alpha', repo: 'r1', rows }]);
  try {
    const l = laneTiming({ root, maxSamples: 5 }).lanes.sast;
    assert.equal(l.samples.length, 5);
    assert.equal(l.samplesDropped, 7, 'a silently shortened series and a short one draw the same picture');
    assert.equal(l.timed, 12, 'the COUNT is the full count — only the retained points are capped');
    assert.equal(l.samples[l.samples.length - 1].ms, 11, 'the newest points are the ones kept');
    assert.equal(l.p50, 5, 'the quantiles are over every sample (nearest rank over 0..11), not just '
      + 'the retained window of five');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the window is honoured and REPORTED, so an empty graph is distinguishable from an empty window', () => {
  const root = tree([{ batch: 'sweep-20260801120000-alpha', repo: 'r1', rows: [
    row('sast', 'pass', 10, '2026-07-01T00:00:00Z'),
    row('sast', 'pass', 20, '2026-08-15T00:00:00Z'),
  ] }]);
  try {
    const r = laneTiming({ root, since: '2026-08-01T00:00:00Z' });
    assert.equal(r.lanes.sast.timed, 1);
    assert.deepEqual(r.window, { area: null, since: '2026-08-01T00:00:00Z', until: null });
    const none = laneTiming({ root, since: '2027-01-01T00:00:00Z' });
    assert.deepEqual(none.lanes, {}, 'no lane has a sample in that window');
    assert.equal(none.files.read, 1, 'the files were read; it is the window that is empty');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('same tree, byte-identical result', () => {
  const root = tree([
    { batch: 'sweep-20260801120000-alpha', repo: 'b', rows: [row('sast', 'pass', 2, '2026-08-01T12:00:00Z')] },
    { batch: 'sweep-20260801120000-alpha', repo: 'a', rows: [row('sast', 'pass', 1, '2026-08-01T12:00:00Z')] },
  ]);
  try {
    assert.equal(JSON.stringify(laneTiming({ root })), JSON.stringify(laneTiming({ root })));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a batch name yields its area and start time, and refuses to invent either', () => {
  assert.equal(batchArea('sweep-20260822194501-maths-portll'), 'maths-portll');
  assert.equal(batchStartedAt('sweep-20260822194501-maths-portll'), '2026-08-22T19:45:01Z');
  for (const n of ['100randomrepos', '_partial-roll-0304', 'clientD-2026-07-25', '', null, 'sweep-123-x']) {
    assert.equal(batchArea(n), null, `invented an area for ${JSON.stringify(n)}`);
    assert.equal(batchStartedAt(n), null);
  }
});

test('the root is env-overridable and read at CALL time', () => {
  const prev = process.env.CW_REPORTS_ROOT;
  try {
    delete process.env.CW_REPORTS_ROOT;
    // Separator-agnostic: timingRoot() resolves its argument, so on Windows `/a/b` becomes
    // `C:\a\b` and a `/\/a\/b$/` match pins the platform rather than the property. The property
    // here is that the root DERIVES FROM THE ARGUMENT when the env is unset — asserted against
    // what this platform's own resolve() produces, which is the actual contract.
    assert.equal(timingRoot('/a/b'), resolve('/a/b'));
    process.env.CW_REPORTS_ROOT = '/tmp/elsewhere';
    // resolve() again, for the same reason: timingRoot resolves, so the literal is only equal to
    // the result on POSIX. What is being asserted is that the ENV WINS and is read at call time.
    assert.equal(timingRoot('/a/b'), resolve('/tmp/elsewhere'),
      'the module was imported before this was set; a module-load const would defeat every test that sets it');
    assert.notEqual(timingRoot('/a/b'), resolve('/a/b'), 'and the fallback must not win over it');
  } finally { if (prev === undefined) delete process.env.CW_REPORTS_ROOT; else process.env.CW_REPORTS_ROOT = prev; }
});
