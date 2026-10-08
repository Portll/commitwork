// bin/test/lane-staleness.test.mjs — the staleness reporter's floor.
//
// The module's whole value is that it separates answers a proxy check collapses into "fine". So the
// weight here is on the FOUR non-findings — absent, unreadable, undatable, cadence-undeclared —
// because those are the ones a careless implementation renders as clean, and the ones an
// over-eager implementation renders as catastrophe. A checker that fails ~100% of lanes because it
// invented its own expectation is a defect in the checker, and there are tests for that below.
//
// Every fs test runs on a mkdtemp fixture routed by CW_*, and asserts that the routing actually
// took: a fixture path that silently falls through to the live store makes every other test in the
// file prove nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assessLane, assessFleet, rollup, summarise, summariseFleet, humanAge, sampleMs, isProductive, RANK,
  LANE_ABSENT, LANE_UNREADABLE, CLOCK_UNREADABLE, NEVER_PRODUCED, VOIDS_ONLY,
  CADENCE_UNDECLARED, PRODUCING, STALE, FINDINGS, FAULTS, UNKNOWNS,
} from '../lane-staleness-core.mjs';
import {
  run, nowMs, readManifest, mergeLanes, cadenceOf, graceOf, productiveByField,
  readJsonlLane, readSqliteLane, readLane, builtinLanes, safeIdent,
} from '../lane-staleness.mjs';

const NOW = Date.parse('2026-09-07T00:00:00.000Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();
const out = (at) => ({ at, productive: true });
const empty = (at, reason) => ({ at, productive: false, reason });

/** Scratch dir that cleans itself up, and whose path is asserted to be the one actually read. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lane-staleness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Set env for one test and put it back, whatever the test does. */
function withEnv(t, vars) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

// ── The four non-findings ───────────────────────────────────────────────────

test('an absent lane is UNKNOWN, never a finding — absence cannot evidence that anything stopped', () => {
  const r = assessLane({ name: 'never-installed', present: false, samples: null, now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, LANE_ABSENT);
  assert.equal(r.grey, true);
  assert.equal(r.fault, false);
  assert.equal(FINDINGS.has(r.verdict), false);
  assert.equal(r.rows, null, 'an absent lane must not report a row COUNT it never read');
  assert.equal(r.ageMs, null);
  assert.match(r.detail, /"not installed" and "stopped producing" are different states/);
});

test('an absent lane stays UNKNOWN even with a cadence declared and long overdue', () => {
  // The tempting bug: a declared cadence plus no output "obviously" means stale. It does not — the
  // lane was never here to produce anything.
  const r = assessLane({ name: 'x', present: false, samples: null, now: NOW, cadenceMs: HOUR });
  assert.equal(r.verdict, LANE_ABSENT);
  assert.notEqual(r.verdict, STALE);
});

test('a present-but-unreadable lane is a FAULT and explicitly NOT "produced nothing"', () => {
  const r = assessLane({ name: 'locked', present: true, samples: null, now: NOW, cadenceMs: DAY, why: 'EACCES' });
  assert.equal(r.verdict, LANE_UNREADABLE);
  assert.equal(r.grey, true);
  assert.equal(r.fault, true);
  assert.equal(FINDINGS.has(r.verdict), false, 'a permission bit must not be published as an outage');
  assert.equal(r.rows, null);
  assert.equal(r.why, 'EACCES', "the reader's verbatim explanation survives to the report");
  assert.match(r.detail, /UNKNOWN — not "nothing"/);
});

test('an undeclared cadence is UNKNOWN, not stale, no matter how old the output is', () => {
  const r = assessLane({ name: 'no-cadence', present: true, samples: [out(ago(90 * DAY))], now: NOW });
  assert.equal(r.verdict, CADENCE_UNDECLARED);
  assert.equal(r.grey, true);
  assert.equal(r.fault, false);
  assert.equal(FINDINGS.has(r.verdict), false);
  assert.equal(r.cadenceMs, null);
  assert.equal(r.overdueMs, null, 'overdue against WHAT? there is no declared expectation to be overdue against');
  assert.match(r.detail, /will not invent an interval/);
});

test('a grey verdict suppresses the CONCLUSION, never the evidence', () => {
  // The failure this guards: "unknown" implemented as "report nothing", which hides the very rows
  // that would let a human declare the cadence and get a verdict.
  const r = assessLane({
    name: 'no-cadence',
    present: true,
    samples: [out(ago(9 * DAY)), empty(ago(HOUR), 'input/output error'), empty(ago(2 * HOUR), 'input/output error')],
    now: NOW,
  });
  assert.equal(r.verdict, CADENCE_UNDECLARED);
  assert.equal(r.rows, 3);
  assert.equal(r.productiveRows, 1);
  assert.equal(r.voidRows, 2);
  assert.equal(r.lastProduction, ago(9 * DAY));
  assert.equal(r.lastActivity, ago(HOUR), 'activity and production are reported separately even when grey');
  assert.deepEqual(r.reasons, [{ reason: 'input/output error', count: 2 }]);
  assert.ok(r.ageMs > 8 * DAY);
});

test('output that carries no parseable clock is UNKNOWN, never "recent"', () => {
  const r = assessLane({
    name: 'undatable', present: true, cadenceMs: DAY, now: NOW,
    samples: [{ at: 'yesterdayish', productive: true }, { at: null, productive: true }],
  });
  assert.equal(r.verdict, CLOCK_UNREADABLE);
  assert.equal(r.grey, true);
  assert.equal(r.fault, true);
  assert.equal(r.rows, 2, 'the rows exist and are counted — what is unknown is WHEN');
  assert.equal(r.lastProduction, null);
  assert.notEqual(r.verdict, PRODUCING);
  assert.notEqual(r.verdict, STALE);
});

test('a run with no usable clock cannot call anything fresh', () => {
  const r = assessLane({ name: 'x', present: true, cadenceMs: DAY, samples: [out(ago(HOUR))], now: NaN });
  assert.equal(r.verdict, CLOCK_UNREADABLE);
  assert.equal(r.grey, true);
  assert.equal(r.lastProduction, ago(HOUR), 'what IS known is still reported');
});

test('no lane ever blocks, in any verdict — a reporter that blocked fleet-wide gets uninstalled', () => {
  const cases = [
    { name: 'a', present: false, samples: null },
    { name: 'b', present: true, samples: null },
    { name: 'c', present: true, samples: [] },
    { name: 'd', present: true, samples: [empty(ago(HOUR), 'boom')] },
    { name: 'e', present: true, samples: [out(ago(90 * DAY))], cadenceMs: HOUR },
    { name: 'f', present: true, samples: [out(ago(HOUR))], cadenceMs: DAY },
    { name: 'g', present: true, samples: [out(ago(90 * DAY))] },
  ];
  const seen = new Set();
  for (const c of cases) {
    const r = assessLane({ ...c, now: NOW });
    assert.equal(r.block, false, `${c.name} must not block`);
    seen.add(r.verdict);
  }
  assert.equal(seen.size, 7, 'the seven reachable verdicts are all exercised here');
});

// ── The findings ────────────────────────────────────────────────────────────

test('a readable lane holding nothing has NEVER PRODUCED — distinct from absent, and not a clean result', () => {
  const r = assessLane({ name: 'fresh-install', present: true, samples: [], now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, NEVER_PRODUCED);
  assert.equal(r.grey, false);
  assert.equal(r.rows, 0);
  assert.notEqual(r.verdict, LANE_ABSENT, 'a path that exists and one that does not are different answers');
  assert.match(r.detail, /never produced output here/);
  assert.match(r.detail, /NOT is a clean result/);
});

test('records that all say "I produced nothing" are VOIDS-ONLY, and the recorded reason is quoted verbatim', () => {
  // The dep-scan shape: 82 consecutive voids, each carrying its reason, every proxy reading healthy.
  const samples = Array.from({ length: 82 }, (_, i) =>
    empty(ago(i * HOUR), 'write /var/lib/containerd/io.containerd.metadata.v1.bolt/meta.db: input/output error'));
  const r = assessLane({ name: 'dep-scan', present: true, samples, now: NOW });
  assert.equal(r.verdict, VOIDS_ONLY);
  assert.equal(r.rows, 82);
  assert.equal(r.productiveRows, 0);
  assert.equal(r.reasons[0].count, 82);
  assert.match(r.detail, /input\/output error/, 'the reason was written down 82 times; the report reads it');
  assert.match(r.detail, /opposite diagnosis from `stale`/);
  assert.equal(FINDINGS.has(r.verdict), true);
});

test('voids-only needs no cadence — "every run produced nothing" is a count, not an interval', () => {
  const r = assessLane({ name: 'x', present: true, samples: [empty(ago(HOUR), 'boom')], now: NOW });
  assert.equal(r.verdict, VOIDS_ONLY);
  assert.equal(r.cadenceMs, null);
});

test('output inside the declared cadence is PRODUCING', () => {
  const r = assessLane({ name: 'ok', present: true, samples: [out(ago(2 * HOUR))], now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, PRODUCING);
  assert.equal(r.grey, false);
  assert.ok(r.overdueMs < 0);
});

test('nothing inside the declared cadence is STALE, and names what arrived instead', () => {
  const samples = [out(ago(8 * DAY)), ...Array.from({ length: 5 }, (_, i) => empty(ago(i * HOUR), 'i/o error'))];
  const r = assessLane({ name: 'dep-scan', present: true, samples, now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, STALE);
  assert.equal(r.lastProduction, ago(8 * DAY));
  assert.equal(r.lastActivity, ago(0));
  assert.ok(r.overdueMs > 6 * DAY);
  assert.match(r.detail, /5 record\(s\) have arrived since, 5 of them void/);
  assert.match(r.detail, /"i\/o error"/, 'the reason is quoted, not paraphrased');
  assert.match(r.detail, /running and producing nothing/);
});

test('stale with NO activity since reads as a stopped producer, not a broken one', () => {
  const r = assessLane({ name: 'x', present: true, samples: [out(ago(8 * DAY))], now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, STALE);
  assert.match(r.detail, /stopped rather than broken/);
});

// ── Cadence handling: the checker must not supply its own expectation ───────

test('a non-positive, non-finite or non-numeric cadence is UNDECLARED, never coerced into a default', () => {
  for (const c of [0, -1, NaN, Infinity, null, undefined, '24h', {}]) {
    const r = assessLane({ name: 'x', present: true, samples: [out(ago(90 * DAY))], now: NOW, cadenceMs: c });
    assert.equal(r.verdict, CADENCE_UNDECLARED, `cadenceMs=${String(c)} must not become an interval`);
    assert.equal(r.cadenceMs, null);
  }
});

test('grace defaults to ZERO — a default grace is an invented interval wearing a smaller hat', () => {
  const justOver = assessLane({ name: 'x', present: true, samples: [out(ago(DAY + 60000))], now: NOW, cadenceMs: DAY });
  assert.equal(justOver.verdict, STALE);
  assert.equal(justOver.graceMs, 0);
  const withGrace = assessLane({ name: 'x', present: true, samples: [out(ago(DAY + 60000))], now: NOW, cadenceMs: DAY, graceMs: 2 * HOUR });
  assert.equal(withGrace.verdict, PRODUCING, 'a DECLARED grace is honoured; only an invented one is refused');
});

test('exactly at the cadence boundary is still producing — the deadline is not yet missed', () => {
  const r = assessLane({ name: 'x', present: true, samples: [out(ago(DAY))], now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, PRODUCING);
  assert.equal(r.overdueMs, 0);
});

// ── mtime is not production ─────────────────────────────────────────────────

test('a file touched today with a three-week-old newest row is dated by the ROW', () => {
  // The measured case, verbatim: .claude/store/spine-touches.jsonl, mtime 2026-09-06 21:31,
  // newest row 2026-08-31T03:20. A count/mtime delta was read as live activity today.
  const r = assessLane({
    name: 'spine-ledger', present: true, cadenceMs: DAY, now: NOW,
    samples: [out('2026-08-31T03:20:18.356Z')],
    mtimeMs: Date.parse('2026-09-06T21:31:00.000Z'),
  });
  assert.equal(r.verdict, STALE);
  assert.equal(r.lastProduction, '2026-08-31T03:20:18.356Z');
  assert.equal(r.mtime, '2026-09-06T21:31:00.000Z');
  assert.ok(r.mtimeAheadOfNewestMs > 6 * DAY, 'the misleading proxy is measured and displayed, not merely avoided');
});

test('an mtime BEHIND the newest row reports a negative gap rather than a fault', () => {
  const r = assessLane({
    name: 'x', present: true, now: NOW, cadenceMs: DAY,
    samples: [out(ago(HOUR))], mtimeMs: NOW - 5 * HOUR,
  });
  assert.equal(r.verdict, PRODUCING);
  assert.ok(r.mtimeAheadOfNewestMs < 0);
});

// ── Record handling ─────────────────────────────────────────────────────────

test('an ABSENT `productive` field is an output, never a void — an unknown schema must not publish 82 failures', () => {
  const r = assessLane({ name: 'x', present: true, samples: [{ at: ago(HOUR) }], now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, PRODUCING);
  assert.equal(r.voidRows, 0);
  assert.equal(isProductive({ at: 'x' }), true);
  assert.equal(isProductive({ at: 'x', productive: false }), false);
  assert.equal(isProductive({ at: 'x', productive: null }), true, 'only an explicit false is a void');
});

test('an unparseable clock costs the timestamp, not the row', () => {
  const r = assessLane({
    name: 'x', present: true, cadenceMs: DAY, now: NOW,
    samples: [out(ago(HOUR)), { at: 'not-a-date', productive: true }],
  });
  assert.equal(r.rows, 2);
  assert.equal(r.lastProduction, ago(HOUR));
});

test('epoch-ms and ISO clocks are both accepted, because a JSONL row and a SQLite column disagree', () => {
  assert.equal(sampleMs({ at: NOW }), NOW);
  assert.equal(sampleMs({ at: '2026-09-07T00:00:00.000Z' }), NOW);
  assert.equal(sampleMs({ at: '' }), null);
  assert.equal(sampleMs({ at: null }), null);
  assert.equal(sampleMs(null), null);
});

test('void reasons are tallied worst-first, ties by text, and never depend on insertion order', () => {
  const s = [empty(ago(1), 'zzz'), empty(ago(2), 'aaa'), empty(ago(3), 'aaa'), empty(ago(4), null)];
  const a = assessLane({ name: 'x', present: true, samples: s, now: NOW });
  const b = assessLane({ name: 'x', present: true, samples: [...s].reverse(), now: NOW });
  assert.deepEqual(a.reasons, [
    { reason: 'aaa', count: 2 }, { reason: '(no reason recorded)', count: 1 }, { reason: 'zzz', count: 1 },
  ]);
  assert.deepEqual(a.reasons, b.reasons);
});

// ── Rollup: undetermined lives outside the finding buckets ──────────────────

test('unknown and fault counts sit OUTSIDE findings — neither folded into pass nor into fail', () => {
  const { lanes, rollup: ro } = assessFleet({
    now: NOW,
    lanes: [
      { name: 'absent', present: false, samples: null },
      { name: 'locked', present: true, samples: null },
      { name: 'nocadence', present: true, samples: [out(ago(90 * DAY))] },
      { name: 'stale', present: true, samples: [out(ago(9 * DAY))], cadenceMs: DAY },
      { name: 'fine', present: true, samples: [out(ago(HOUR))], cadenceMs: DAY },
    ],
  });
  assert.equal(ro.total, 5);
  assert.equal(ro.findings, 1, 'only the stale lane is a finding');
  assert.equal(ro.faults, 1);
  assert.equal(ro.unknown, 2);
  assert.equal(ro.producing, 1);
  assert.equal(ro.findings + ro.faults + ro.unknown + ro.producing, ro.total, 'the buckets partition the fleet');
  // And the greys must not have been quietly counted as either.
  for (const r of lanes) {
    if (UNKNOWNS.has(r.verdict)) assert.equal(FINDINGS.has(r.verdict), false);
    if (FAULTS.has(r.verdict)) assert.equal(FINDINGS.has(r.verdict), false);
  }
});

test('rollup() is callable standalone, and byVerdict never double-counts a lane', () => {
  // Exported on its own so a panel can re-derive the buckets from stored lane results without
  // re-running the assessment. If the two ever disagree, the number on the page is not the number
  // the checker produced.
  const results = assessFleet({
    now: NOW,
    lanes: [
      { name: 'a', present: false, samples: null },
      { name: 'b', present: true, samples: [] },
      { name: 'c', present: true, samples: [out(ago(HOUR))], cadenceMs: DAY },
    ],
  }).lanes;
  const ro = rollup(results);
  assert.equal(Object.values(ro.byVerdict).reduce((n, x) => n + x, 0), ro.total, 'every lane lands in exactly one verdict');
  assert.equal(ro.byVerdict[LANE_ABSENT], 1);
  assert.equal(ro.byVerdict[NEVER_PRODUCED], 1);
  assert.equal(ro.byVerdict[PRODUCING], 1);
  assert.equal(ro.unknown, 1, 'the absent lane is UNKNOWN, and the never-produced one is not');
});

test('display RANK is not a bucket — being sorted near the findings is not being one', () => {
  assert.ok(RANK[LANE_UNREADABLE] > RANK[PRODUCING], 'a fault is shown high so a human sees it');
  assert.equal(FINDINGS.has(LANE_UNREADABLE), false, 'and it is still not a finding');
  assert.ok(RANK[CADENCE_UNDECLARED] > RANK[PRODUCING]);
  assert.equal(FINDINGS.has(CADENCE_UNDECLARED), false);
});

test('an empty fleet is reported as "nothing was checked", never as a clean bill of health', () => {
  const { rollup: ro } = assessFleet({ lanes: [], now: NOW });
  assert.equal(ro.total, 0);
  assert.equal(ro.findings, 0);
  assert.match(summariseFleet(ro), /not a clean result/);
});

test('fleet ordering is deterministic — same lanes in any order produce identical output', () => {
  const decls = [
    { name: 'zeta', present: true, samples: [out(ago(9 * DAY))], cadenceMs: DAY },
    { name: 'alpha', present: true, samples: [out(ago(9 * DAY))], cadenceMs: DAY },
    { name: 'mid', present: false, samples: null },
    { name: 'beta', present: true, samples: [] },
  ];
  const a = assessFleet({ lanes: decls, now: NOW });
  const b = assessFleet({ lanes: [...decls].reverse(), now: NOW });
  assert.deepEqual(a.lanes.map((l) => l.name), ['alpha', 'zeta', 'beta', 'mid']);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'byte-identical, not merely equivalent');
});

test('summarise never renders an unknown the way it renders a pass', () => {
  const mk = (o) => summarise(assessLane({ name: 'x', now: NOW, ...o }));
  assert.match(mk({ present: false, samples: null }), /UNKNOWN, not a finding/);
  assert.match(mk({ present: true, samples: null }), /not an empty lane/);
  assert.match(mk({ present: true, samples: [out(ago(9 * DAY))] }), /UNKNOWN, not stale/);
  assert.match(mk({ present: true, samples: [out(ago(HOUR))], cadenceMs: DAY }), /^x: producing/);
});

test('humanAge is deterministic and signs a negative', () => {
  assert.equal(humanAge(0), '0m');
  assert.equal(humanAge(90 * 60000), '1h 30m');
  assert.equal(humanAge(8 * DAY + 4 * HOUR), '8d 4h');
  assert.equal(humanAge(-HOUR), '-1h 0m');
  assert.equal(humanAge(NaN), 'unknown');
});

// ── The I/O half: env overrides must actually route ─────────────────────────

test('CW_NOW is honoured, and an unparseable CW_NOW THROWS rather than silently using wall-clock', (t) => {
  withEnv(t, { CW_NOW: '2026-09-07T00:00:00.000Z' });
  assert.equal(nowMs(), NOW);
  process.env.CW_NOW = 'tuesday-ish';
  assert.throws(() => nowMs(), /not a parseable date/);
  delete process.env.CW_NOW;
  assert.ok(Math.abs(nowMs() - Date.now()) < 5000, 'no override ⇒ wall clock, which is the only legitimate fallback');
});

test('CW_STORE_DIR actually routes the built-in lanes — a fixture that falls through proves nothing', (t) => {
  const dir = scratch(t);
  withEnv(t, { CW_STORE_DIR: dir, CW_SPINE_LEDGER: undefined, CW_TOUCH_LEDGER: undefined });
  for (const l of builtinLanes()) {
    assert.ok(l.path.startsWith(dir), `${l.name} resolved to ${l.path}, which is NOT the fixture — the override did not take`);
  }
  assert.equal(cadenceOf(builtinLanes()[0]), null, 'the built-ins ship with no fabricated cadence');
});

test('an absent manifest is legitimately absent; a corrupt one FAILS CLOSED and is not zero lanes', (t) => {
  const dir = scratch(t);
  const missing = join(dir, 'nope.json');
  const absent = readManifest(missing);
  assert.deepEqual(absent.lanes, []);
  assert.equal(absent.absent, true);
  assert.equal(absent.why, null);

  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  const corrupt = readManifest(bad);
  assert.equal(corrupt.lanes, null, 'a corrupt config must NOT read as "0 lanes, all clear"');
  assert.equal(corrupt.absent, false);
  assert.match(corrupt.why, /not parseable JSON/);

  const wrong = join(dir, 'wrong.json');
  writeFileSync(wrong, '{"lanez": []}');
  assert.equal(readManifest(wrong).lanes, null);

  const dirAsFile = join(dir, 'sub');
  mkdirSync(dirAsFile);
  const eisdir = readManifest(dirAsFile);
  assert.equal(eisdir.lanes, null, 'EISDIR is not ENOENT — only ENOENT means legitimately absent');
  assert.equal(eisdir.absent, false);
});

test('run() reports a corrupt manifest as a fault and still checks the built-in lanes', async (t) => {
  const dir = scratch(t);
  const man = join(dir, 'lanes.json');
  writeFileSync(man, 'nonsense');
  withEnv(t, { CW_LANES: man, CW_STORE_DIR: dir, CW_SPINE_LEDGER: undefined, CW_TOUCH_LEDGER: undefined });
  const r = await run({ now: NOW });
  assert.match(r.manifestWhy, /not parseable JSON/);
  assert.equal(r.declaredLanes, 0);
  assert.equal(r.rollup.total, 2, 'the built-ins are still reported rather than the whole run collapsing');
});

test('declared lanes merge over built-ins by name, and `builtins: false` drops them entirely', () => {
  const merged = mergeLanes(
    [{ name: 'spine-ledger', kind: 'jsonl', path: '/real' }],
    [{ name: 'spine-ledger', cadenceHours: 24 }, { name: 'extra', kind: 'jsonl', path: '/x' }, { name: '' }, null],
  );
  assert.equal(merged.length, 2, 'an unnamed lane cannot be reported about and is dropped');
  assert.equal(merged[0].path, '/real');
  assert.equal(cadenceOf(merged[0]), DAY, 'the declaration adds a cadence to a built-in path');
  assert.equal(graceOf(merged[0]), 0);
});

test('cadence and grace accept ms or hours, and reject anything non-positive', () => {
  assert.equal(cadenceOf({ cadenceMs: 5 }), 5);
  assert.equal(cadenceOf({ cadenceHours: 2 }), 2 * HOUR);
  assert.equal(cadenceOf({ cadenceMs: 9, cadenceHours: 2 }), 9, 'the explicit ms wins');
  assert.equal(cadenceOf({ cadenceHours: 0 }), null);
  assert.equal(cadenceOf({ cadenceHours: '2' }), null, 'a string is not a declaration');
  assert.equal(cadenceOf({}), null);
  assert.equal(graceOf({ graceHours: 2 }), 2 * HOUR);
  assert.equal(graceOf({}), 0);
});

test('productiveByField reads a positively-populated field as output and everything else as void', () => {
  assert.equal(productiveByField({ n: 3 }, 'n'), true);
  assert.equal(productiveByField({ n: 0 }, 'n'), false);
  assert.equal(productiveByField({ a: [1] }, 'a'), true);
  assert.equal(productiveByField({ a: [] }, 'a'), false);
  assert.equal(productiveByField({ s: 'x' }, 's'), true);
  assert.equal(productiveByField({ s: '  ' }, 's'), false);
  assert.equal(productiveByField({ b: true }, 'b'), true);
  assert.equal(productiveByField({}, 'missing'), false);
  assert.equal(productiveByField({}, null), true, 'no declared field ⇒ every record is an output');
});

// ── JSONL reader ────────────────────────────────────────────────────────────

test('a JSONL lane is dated by its newest ROW even when the file was touched minutes ago', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'spine-touches.jsonl');
  writeFileSync(p, [
    JSON.stringify({ plan: 'a', at: '2026-08-30T01:00:00.000Z' }),
    JSON.stringify({ plan: 'b', at: '2026-08-31T03:20:18.356Z' }),
    '',
  ].join('\n'));
  const touched = Date.parse('2026-09-06T21:31:00.000Z') / 1000;
  utimesSync(p, touched, touched);

  const ev = readJsonlLane({ path: p });
  assert.equal(ev.present, true);
  assert.equal(ev.samples.length, 2);
  const r = assessLane({ name: 'spine-ledger', present: ev.present, samples: ev.samples, mtimeMs: ev.mtimeMs, cadenceMs: DAY, now: NOW });
  assert.equal(r.lastProduction, '2026-08-31T03:20:18.356Z');
  assert.equal(r.verdict, STALE, 'six days of daylight between mtime and newest row, and the row wins');
  assert.ok(r.mtimeAheadOfNewestMs > 6 * DAY);
});

test('an unparseable JSONL line is counted, never silently dropped, and never fakes an empty lane', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'l.jsonl');
  writeFileSync(p, `{"at":"${ago(HOUR)}"}\nNOT JSON\n\n{"at":"${ago(2 * HOUR)}"}\n`);
  const ev = readJsonlLane({ path: p });
  assert.equal(ev.skipped, 1);
  assert.equal(ev.samples.length, 2);
  assert.equal(assessLane({ name: 'x', ...ev, cadenceMs: DAY, now: NOW }).skipped, 1);
});

test('a missing JSONL path is ABSENT; a present-but-unopenable one is a FAULT', (t) => {
  const dir = scratch(t);
  const gone = readJsonlLane({ path: join(dir, 'gone.jsonl') });
  assert.equal(gone.present, false);
  assert.equal(gone.samples, null);
  assert.equal(assessLane({ name: 'x', ...gone, now: NOW }).verdict, LANE_ABSENT);

  // A directory where a file was declared: present, and it will not read. ENOENT comes from stat(),
  // never from matching an error message, so this must not be mistaken for "never installed".
  const asDir = join(dir, 'adir.jsonl');
  mkdirSync(asDir);
  const ev = readJsonlLane({ path: asDir });
  assert.equal(ev.present, true);
  assert.equal(ev.samples, null);
  assert.equal(assessLane({ name: 'x', ...ev, now: NOW }).verdict, LANE_UNREADABLE);
});

test('an unreadable file (mode 000) is a FAULT, not an absent lane and not an empty one', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'locked.jsonl');
  writeFileSync(p, '{"at":"2026-09-01T00:00:00.000Z"}\n');
  chmodSync(p, 0o000);
  t.after(() => { try { chmodSync(p, 0o600); } catch { /* already gone */ } });
  const ev = readJsonlLane({ path: p });
  if (ev.samples !== null) {
    // Running as root defeats the mode bit; skip rather than assert a falsehood about the run.
    t.skip('this process can read a 000 file — the permission arm is untestable here');
    return;
  }
  assert.equal(ev.present, true, 'stat() succeeded, so the lane is present, not absent');
  const r = assessLane({ name: 'x', ...ev, now: NOW, cadenceMs: DAY });
  assert.equal(r.verdict, LANE_UNREADABLE);
  assert.equal(r.rows, null, 'a permission bit must never be published as "produced nothing"');
});

test('a lane declaring a productiveField reads reason-only rows as voids — the batch-manifest shape', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'runs.jsonl');
  const rows = [
    { at: '2026-08-30T00:00:00.000Z', findings: 12, reason: null },
    ...Array.from({ length: 3 }, (_, i) => ({
      at: `2026-09-0${i + 1}T00:00:00.000Z`, findings: 0,
      reason: 'write /var/lib/containerd/io.containerd.metadata.v1.bolt/meta.db: input/output error',
    })),
  ];
  writeFileSync(p, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const ev = readJsonlLane({ path: p, productiveField: 'findings' });
  const r = assessLane({ name: 'dep-scan', ...ev, cadenceMs: DAY, now: NOW });
  assert.equal(r.verdict, STALE);
  assert.equal(r.voidRows, 3);
  assert.equal(r.lastProduction, '2026-08-30T00:00:00.000Z');
  assert.match(r.detail, /input\/output error/);
});

// ── SQLite reader ───────────────────────────────────────────────────────────

test('a SQLite lane is dated by max(updated_at), and a missing db is ABSENT not empty', async (t) => {
  const dir = scratch(t);
  const dbPath = join(dir, 'store.db');
  const gone = await readSqliteLane({ path: dbPath, table: 'items' });
  assert.equal(gone.present, false);
  assert.equal(gone.samples, null);
  assert.equal(assessLane({ name: 'x', ...gone, now: NOW }).verdict, LANE_ABSENT);

  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE items (id TEXT, updated_at TEXT, n INTEGER)');
  db.exec(`INSERT INTO items VALUES ('a','2026-08-30T00:00:00.000Z',4), ('b','${ago(2 * DAY)}',0)`);
  db.close();

  const ev = await readSqliteLane({ path: dbPath, table: 'items' });
  assert.equal(ev.samples.length, 2);
  const r = assessLane({ name: 'store', ...ev, cadenceMs: DAY, now: NOW });
  assert.equal(r.verdict, STALE);
  assert.equal(r.lastProduction, ago(2 * DAY), 'newest first, and every row counts as output when no productiveColumn is declared');

  const pev = await readSqliteLane({ path: dbPath, table: 'items', productiveColumn: 'n' });
  const pr = assessLane({ name: 'store', ...pev, cadenceMs: DAY, now: NOW });
  assert.equal(pr.voidRows, 1);
  // The declaration changes the ANSWER, which is the point: the newest row is a void, so the lane
  // dates from the older row that actually produced something.
  assert.equal(pr.lastProduction, '2026-08-30T00:00:00.000Z');
  assert.ok(pr.ageMs > r.ageMs, 'a void row must never stand in for an output');
});

test('a SQLite declaration naming a non-identifier is REFUSED rather than interpolated', async () => {
  assert.equal(safeIdent('updated_at'), true);
  assert.equal(safeIdent('items; DROP TABLE x'), false);
  assert.equal(safeIdent('1bad'), false);
  assert.equal(safeIdent(undefined), false);
  const ev = await readSqliteLane({ path: '/nonexistent', table: 'x; DROP TABLE y' });
  assert.equal(ev.samples, null);
  assert.match(ev.why, /not a plain SQL identifier/);
});

test('a present-but-corrupt SQLite file is a FAULT, never an empty store', async (t) => {
  const dir = scratch(t);
  const p = join(dir, 'corrupt.db');
  writeFileSync(p, 'this is not a sqlite file at all, not even close');
  const ev = await readSqliteLane({ path: p, table: 'items' });
  assert.equal(ev.present, true);
  assert.equal(ev.samples, null, 'a corrupt store must not read as zero rows');
  assert.equal(assessLane({ name: 'x', ...ev, now: NOW }).verdict, LANE_UNREADABLE);
});

test('an unsupported lane kind is UNREADABLE, never an empty lane', async () => {
  const ev = await readLane({ name: 'x', kind: 'carrier-pigeon', path: '/tmp/whatever' });
  assert.equal(ev.samples, null);
  assert.match(ev.why, /unsupported lane kind/);
  assert.equal(assessLane({ name: 'x', ...ev, now: NOW }).verdict, LANE_UNREADABLE);
});

// ── End to end, on fixtures only ────────────────────────────────────────────

test('run() routes entirely to fixtures and re-runs byte-identically', async (t) => {
  const dir = scratch(t);
  const laneFile = join(dir, 'dep-scan.jsonl');
  writeFileSync(laneFile, [
    JSON.stringify({ at: '2026-08-30T00:00:00.000Z', findings: 7 }),
    JSON.stringify({ at: '2026-09-06T00:00:00.000Z', findings: 0, reason: 'input/output error' }),
  ].join('\n'));
  const man = join(dir, 'lanes.json');
  writeFileSync(man, JSON.stringify({
    builtins: false,
    lanes: [
      { name: 'dep-scan', kind: 'jsonl', path: laneFile, productiveField: 'findings', cadenceHours: 24 },
      { name: 'zzz-absent', kind: 'jsonl', path: join(dir, 'nothing.jsonl') },
      { name: 'aaa-nocadence', kind: 'jsonl', path: laneFile, productiveField: 'findings' },
    ],
  }));
  withEnv(t, { CW_LANES: man, CW_STORE_DIR: dir, CW_NOW: '2026-09-07T00:00:00.000Z' });

  const a = await run();
  assert.equal(a.manifestPath, man, 'the override routed — nothing fell through to the live store');
  assert.equal(a.builtinLanes, 0, '`builtins: false` was honoured, so this asserts on the fixture alone');
  assert.equal(a.rollup.total, 3);
  assert.equal(a.generated, '2026-09-07T00:00:00.000Z', 'CW_NOW pinned the clock');
  assert.deepEqual(a.lanes.map((l) => l.verdict), [STALE, CADENCE_UNDECLARED, LANE_ABSENT]);
  assert.equal(a.rollup.findings, 1);
  assert.equal(a.rollup.unknown, 2, 'the undeclared-cadence and absent lanes are UNKNOWN, not findings');
  for (const l of a.lanes) assert.ok(l.path.startsWith(dir), `${l.name} read ${l.path}, outside the fixture`);

  const b = await run();
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same inputs ⇒ byte-identical output');
});

test('run() with no manifest and no stores reports UNKNOWN for the built-ins, and never "all clear"', async (t) => {
  const dir = scratch(t);
  withEnv(t, {
    CW_LANES: undefined, CW_STORE_DIR: dir, CW_NOW: '2026-09-07T00:00:00.000Z',
    CW_SPINE_LEDGER: undefined, CW_TOUCH_LEDGER: undefined,
  });
  const r = await run();
  assert.equal(r.manifestAbsent, true);
  assert.equal(r.manifestWhy, null);
  assert.equal(r.rollup.total, 2);
  assert.equal(r.rollup.unknown, 2);
  assert.equal(r.rollup.findings, 0);
  assert.equal(r.rollup.producing, 0, 'an empty box is not a producing box');
  assert.match(summariseFleet(r.rollup), /2 UNKNOWN/);
});
