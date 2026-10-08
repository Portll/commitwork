// sweep-verdict — the builders must map every rollup exit, sanitize for the tunnel, render
// absence as unknown, and produce filenames compaction can never eat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollupOutcome, sanitizeServed, assertServedSafe, buildAreaVerdict, buildFleetVerdict, canaryVerdict } from '../sweep-verdict.mjs';

test('rollupOutcome: the pinned exit→enum map, every value (C10)', () => {
  assert.equal(rollupOutcome(null), 'published');
  assert.equal(rollupOutcome(undefined), 'published');
  assert.equal(rollupOutcome(0), 'published');
  assert.equal(rollupOutcome(2), 'refused-empty');
  assert.equal(rollupOutcome(3), 'lock-contention');   // NOT nothing-to-roll-up — the stale-comment trap
  assert.equal(rollupOutcome(4), 'nothing-to-roll-up');
  assert.equal(rollupOutcome(5), 'failed:5');
  assert.equal(rollupOutcome(6), 'failed:6');
  assert.equal(rollupOutcome(1), 'failed:1');
});

test('sanitizeServed: relativizes root-prefixed paths, drops session/pid at any depth', () => {
  const root = '/work/repo';
  const dirty = {
    logPath: `${root}/reports/sweep-x.log`,
    nested: { pid: 123, session: 'abcd', keep: `${root}/reports/a`, other: '/etc/passwd' },
    list: [{ pid: 9, p: `${root}/x` }],
  };
  const clean = sanitizeServed(dirty, root);
  assert.equal(clean.logPath, 'reports/sweep-x.log');
  assert.equal(clean.nested.pid, undefined);
  assert.equal(clean.nested.session, undefined);
  assert.equal(clean.nested.keep, 'reports/a');
  assert.equal(clean.nested.other, '/etc/passwd', 'non-root absolutes are not silently rewritten');
  assert.equal(clean.list[0].pid, undefined);
  assert.equal(clean.list[0].p, 'x');
});

test('assertServedSafe: throws on absolute-path VALUES and forbidden keys', () => {
  assert.throws(() => assertServedSafe({ a: '/srv/x/y' }), /absolute path/);
  assert.throws(() => assertServedSafe({ deep: [{ session: 'x' }] }), /forbidden key/);
  assert.throws(() => assertServedSafe({ deep: { pid: 1 } }), /forbidden key/);
  assert.equal(assertServedSafe({ a: 'reports/x', n: 3, arr: ['ok'] }), true);
});

test('buildAreaVerdict: absent steps render unknown — never omitted, never clean', () => {
  const rec = buildAreaVerdict({
    sliceId: 'sweep-20260810000000', area: 'clientD', group: 'all', sweptAll: false,
    startedAt: 's', finishedAt: 'f', durationSecs: 12,
  });
  assert.equal(rec.kind, 'sweep-area-verdict');
  assert.equal(rec.rollup, 'unknown');
  assert.equal(rec.issues, 'unknown');
  assert.equal(rec.preflight, 'unknown');
  assert.equal(rec.hostInventory, 'unknown');
  assert.equal(rec.races, 'unknown');
  assert.equal(rec.repos, 'unknown');
  assert.equal(rec.inflightCleared, 'unknown');
  assert.equal(rec.at, 'f');
  assert.equal(assertServedSafe(rec), true);
});

test('buildAreaVerdict output with real absolute inputs passes the served-safety gate', () => {
  const root = '/work/commitwork';
  const rec = buildAreaVerdict({
    sliceId: 's', area: 'a', group: 'fast', sweptAll: false,
    repos: { resolved: 3, present: 2, scanned: 2, missing: ['gone-repo'] },
    rollup: 'published', inflightCleared: true,
    issues: { status: 'ok', created: 1, reopened: 0, closed: 2, suspect: 0, carried: 5 },
    preflight: { ok: 2, blind: 0, 'no-surface': 1, missing: 0 },
    hostInventory: 'ok', races: 'skipped',
    steps: { codeqlFleet: 'ok', liveness: 'ok', batchDir: `${root}/reports/sweep-x-a` },
    startedAt: 's', finishedAt: 'f', durationSecs: 100,
  }, { root });
  assert.equal(assertServedSafe(rec), true);
  assert.equal(rec.steps.batchDir, 'reports/sweep-x-a');
});

test('buildFleetVerdict: logPath relativized, session/pid stripped, passes served safety', () => {
  const root = '/work/commitwork';
  const rec = buildFleetVerdict({
    stamp: '20260810000000', group: 'all', jobs: 3,
    areas: [{ slug: 'clientD', code: 0, secs: 40, timedOut: false, logPath: `${root}/reports/sweep-20260810000000-clientD.log`, pid: 999 }],
    finalize: { timeline: 'ok', runtime: 'ok', compact: 'failed', projectstatus: 'skipped' },
    clean: '24/25', exit: 1, startedAt: 's', finishedAt: 'f',
  }, { root });
  assert.equal(rec.areas[0].logPath, 'reports/sweep-20260810000000-clientD.log');
  assert.equal(rec.areas[0].pid, undefined);
  assert.equal(assertServedSafe(rec), true);
});

test('journal filenames can never be batch-compaction candidates', () => {
  // compact-reports.mjs:79 — BATCH_RE, plus its .filter(e.isDirectory()) guard. Both names must
  // fail the regex so even a future regression on the directory check cannot eat a journal.
  const BATCH_RE = /^sweep-\d{14}(-[a-z0-9][a-z0-9-]*)?\.?$/;
  assert.equal(BATCH_RE.test('sweep-journal.jsonl'), false);
  assert.equal(BATCH_RE.test('sweep-fleet-journal.jsonl'), false);
  // The slug here is deliberately NOT a redaction placeholder. It was `client-d` until a redaction pass
  // mapped placeholders to camelCase across ten files; `clientD` cannot match `[a-z0-9][a-z0-9-]*`,
  // so the sanity arm inverted and this test failed AT HEAD while every session's working-tree run
  // stayed green — the redaction landed as content without refreshing the worktree, so nobody could
  // see it locally. A fixture whose job is to satisfy a lowercase regex must not be spelled with a
  // name any rename campaign is entitled to rewrite.
  assert.equal(BATCH_RE.test('sweep-20260810000000-area-one'), true, 'sanity: real batches still match');
});

// ── THE MEMORY-LAYER EXPORT FIELD ───────────────────────────────────────────────────────────────
// monitor/export-overwatch.mjs exits 0 on every outcome, so this field is the only place a slice
// records whether its records reached the backend. Before it existed the verdict carried nothing
// about the export at all: 42 failed writes across 6 areas were on disk on 2026-10-03 and no
// batch-verdict.json or sweep-journal.jsonl line mentioned them.

test('a sweep that never reported an export outcome records UNKNOWN, never a pass', () => {
  const rec = buildAreaVerdict({ sliceId: 's', area: 'a', startedAt: 'T', finishedAt: 'T', durationSecs: 1 }, { root: '/r' });
  assert.equal(rec.memoryExport, 'unknown',
    'an unsupplied step is written unknown and never omitted — an absent key reads as "no data" and this one must read as "nobody looked"');
});

test('the export verdict rides the record and survives the tunnel-safety assertion', () => {
  const rec = buildAreaVerdict({
    sliceId: 's', area: 'a', startedAt: 'T', finishedAt: 'T', durationSecs: 1,
    memoryExport: {
      state: 'failed', rank: 3, kind: 'broken', reason: '22 of 22 record(s) were NOT written',
      counts: { total: 22, verified: 0, acceptedUnverified: 0, failed: 22, notAttempted: 0, unknownState: 0 },
      tallyDivergence: 'agrees', receiptsAt: '2026-10-03T10:00:00.000Z', undated: false,
      failedReasons: [{ reason: 'HTTP <n>', count: 22 }],
    },
  }, { root: '/r' });
  assert.equal(rec.memoryExport.state, 'failed');
  assert.equal(rec.memoryExport.counts.failed, 22);
  assert.equal(assertServedSafe(rec), true, 'the field carries no absolute path and no session/pid key');
});

test('an absolute receipts path in the export verdict is relativized, not served raw', () => {
  const root = '/work/repo';
  const rec = buildAreaVerdict({
    sliceId: 's', area: 'a', startedAt: 'T', finishedAt: 'T', durationSecs: 1,
    memoryExport: { state: 'absent', path: `${root}/reports/a/memory-layer-receipts.json` },
  }, { root });
  assert.equal(rec.memoryExport.path, 'reports/a/memory-layer-receipts.json');
  assert.equal(assertServedSafe(rec), true);
});

// ── the gate's own error rate (W1) ─────────────────────────────────────────────────────────────
const row = (id, truth, extra = {}) => ({ id, gate: 'gate-ratchet', expect: 'x', truth, observed: 'exit 0', record: { verdict: 'v', note: 'from a scratch journal' }, what: 'planted', ...extra });
const harness = (results, summary = {}) => ({ exit: 0, summary: { requiredSkipped: [], ...summary }, results });

test('canaryVerdict: each rate divides by the stratum that could exhibit it, with n and of kept', () => {
  const v = canaryVerdict(harness([
    row('A', 'true-alarm'), row('B', 'true-alarm'), row('C', 'false-clean'),
    row('D', 'true-clean'), row('E', 'false-alarm'), row('F', 'true-clean'),
    { id: 'G', expect: 'alarm', skipped: 'tree cannot host it' },
  ]));
  assert.equal(v.state, 'measured');
  // false-clean over what the gate called clean (D, F, C); false-alarm over what it alarmed on (A, B, E)
  assert.deepEqual(v.falseClean, { state: 'measured', n: 1, of: 3, rate: 1 / 3 });
  assert.deepEqual(v.falseAlarm, { state: 'measured', n: 1, of: 3, rate: 1 / 3 });
  assert.equal(v.scored, 6);
  assert.equal(v.skipped, 1);
});

test('canaryVerdict: an empty stratum is not-measured with a null rate — never 0%', () => {
  const v = canaryVerdict(harness([row('A', 'true-alarm'), row('B', 'true-alarm')]));
  assert.equal(v.state, 'measured');
  assert.deepEqual(v.falseAlarm, { state: 'measured', n: 0, of: 2, rate: 0 }, 'a measured zero has a denominator');
  assert.equal(v.falseClean.state, 'not-measured');
  assert.equal(v.falseClean.rate, null);
  assert.equal(v.falseClean.of, 0);
});

test('canaryVerdict: a canary that did not run is its own state, with no rate fields at all', () => {
  for (const [input, state] of [['skipped', 'not-measured'], ['child', 'not-measured'], ['fleet', 'not-measured'],
    [undefined, 'not-measured'], [null, 'not-measured'], ['failed', 'failed']]) {
    const v = canaryVerdict(input);
    assert.equal(v.state, state, String(input));
    assert.ok(v.why, `${input} says why`);
    assert.equal(v.falseClean, undefined, `${input} carries no rate`);
    assert.equal(v.falseAlarm, undefined, `${input} carries no rate`);
  }
});

test('canaryVerdict: output with no per-scenario results fails closed, and nothing scored is not measured', () => {
  assert.equal(canaryVerdict({ exit: 2, summary: { falseClean: 1 } }).state, 'failed');
  assert.equal(canaryVerdict({ exit: 0, summary: {}, results: 'nope' }).state, 'failed');
  const none = canaryVerdict(harness([{ id: 'A', skipped: 'unhostable' }], { requiredSkipped: ['A'] }));
  assert.equal(none.state, 'not-measured');
  assert.equal(none.falseClean.state, 'not-measured');
  assert.deepEqual(none.requiredSkipped, ['A']);
});

test('buildAreaVerdict journals the canary as aggregates only, and a missing one as not-measured', () => {
  const base = { sliceId: 's', area: 'a', group: 'all', sweptAll: false, startedAt: 's', finishedAt: 'f', durationSecs: 1 };
  assert.equal(buildAreaVerdict(base).canary.state, 'not-measured');
  const rec = buildAreaVerdict({ ...base, canary: harness([row('A', 'true-alarm', { target: '/work/x' }), row('B', 'false-alarm')]) }, { root: '/work' });
  assert.equal(rec.canary.state, 'measured');
  assert.deepEqual(rec.canary.falseAlarm, { state: 'measured', n: 1, of: 2, rate: 0.5 });
  const text = JSON.stringify(rec.canary);
  assert.ok(!/scratch journal|planted|"record"|"results"|\/work/.test(text), 'per-scenario records never reach the served journal');
  assert.equal(assertServedSafe(rec), true);
});

test('buildFleetVerdict says the fleet parent did not measure the canary', () => {
  const rec = buildFleetVerdict({ stamp: 's', group: 'all', jobs: 1, areas: [], exit: 0, startedAt: 's', finishedAt: 'f' });
  assert.equal(rec.canary.state, 'not-measured');
  assert.match(rec.canary.why, /fleet parent/);
});
