// gate-tests-core — the branch matrix the gate could never prove while it lived inline with
// `npm test` and worktree I/O. Every verdict family, every tie-break, on injected inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuiteOutput, initialVerdict, regressionVerdict, coverageVerdict, attributeFiles , treeEvidenceNote } from '../gate-tests-core.mjs';

test('parseSuiteOutput: tallies, deduped names, and the no-tally null', () => {
  const out = 'x\n✖ first test (12ms)\n✖ first test (13ms)\n✖ second (1ms)\nℹ tests 1402\nℹ pass 1400\nℹ fail 2\n';
  assert.deepEqual(parseSuiteOutput(out), { tests: 1402, fail: 2, pass: 1400, names: ['first test', 'second'] });
  // a run that reports no total is UNKNOWN there too, never zero
  const noTotal = parseSuiteOutput('ℹ pass 1400\nℹ fail 2\n');
  assert.deepEqual(noTotal, { tests: null, fail: 2, pass: 1400, names: [] });
  const broken = parseSuiteOutput('npm ERR! something died');
  assert.equal(broken.fail, null, 'no tally is UNKNOWN, never zero');
  assert.equal(broken.pass, null);
});

test('initialVerdict: no-tally / armed / floor-lowered / pending / steady matrix', () => {
  assert.deepEqual(initialVerdict({ fail: null, pass: null }, null), { verdict: 'no-tally', exit: 0 });
  assert.deepEqual(initialVerdict({ fail: 3, pass: 100 }, null), { verdict: 'armed', writeBaseline: true, exit: 0 });
  assert.deepEqual(initialVerdict({ fail: 3, pass: 100 }, { fail: 'x' }), { verdict: 'armed', writeBaseline: true, exit: 0 });
  assert.deepEqual(initialVerdict({ fail: 1, pass: 100 }, { fail: 6, pass: 100 }),
    { verdict: 'floor-lowered', from: 6, to: 1, writeBaseline: true, exit: 0 });
  assert.deepEqual(initialVerdict({ fail: 7, pass: 100 }, { fail: 6, pass: 100 }), { verdict: 'regression-pending' });
  // Coverage is judged on the TOTAL. A pass-drop with no total in sight was the old alarm and it
  // fired on flakiness; with totals present and falling it still alarms, which is the real case.
  assert.deepEqual(initialVerdict({ fail: 6, pass: 90, tests: 96 }, { fail: 6, pass: 100, tests: 106 }),
    { verdict: 'coverage-pending', fromTests: 106, toTests: 96 });
});

test('initialVerdict: the old line-298 branch is structurally unreachable', () => {
  // fail < base.fail can only ever produce floor-lowered — there is no second improved path.
  const v = initialVerdict({ fail: 2, pass: 100 }, { fail: 5, pass: 100 });
  assert.equal(v.verdict, 'floor-lowered');
});

test('initialVerdict: steady, and the coverage floor raise is a named fact (C9)', () => {
  assert.deepEqual(initialVerdict({ fail: 6, pass: 100, tests: 106 }, { fail: 6, pass: 100, tests: 106 }),
    { verdict: 'steady', exit: 0, floorRaised: false, writeBaseline: false, coverageCheckable: true });
  assert.deepEqual(initialVerdict({ fail: 6, pass: 110, tests: 116 }, { fail: 6, pass: 100, tests: 106 }),
    { verdict: 'steady', exit: 0, floorRaised: true, writeBaseline: true, coverageCheckable: true });
  // A baseline with no total cannot judge coverage; it still arms the floor on a rise, and says
  // plainly that the coverage question went unanswered rather than implying a clean read.
  assert.deepEqual(initialVerdict({ fail: 6, pass: 110, tests: 116 }, { fail: 6 }),
    { verdict: 'steady', exit: 0, floorRaised: true, writeBaseline: true, coverageCheckable: false });
});

test('regressionVerdict: names not counts; environment noise at HEAD never consulted', () => {
  assert.deepEqual(regressionVerdict(['a', 'b'], null), { verdict: 'regression-unattributed', exit: 2 });
  assert.deepEqual(regressionVerdict(['a', 'b'], { fail: null, names: [] }), { verdict: 'regression-unattributed', exit: 2 });
  // 'a' fails at HEAD too → committed; 'b' only in the tree → uncommitted. HEAD's extra 'env-only'
  // failure appears in NEITHER list — no working-tree failure has its name.
  const v = regressionVerdict(['a', 'b'], { fail: 7, names: ['a', 'env-only'] });
  // deepEqual kept deliberately: it is what caught the R17 shape change, and a field added without
  // a decision is how a record starts carrying something nobody chose.
  assert.deepEqual(v, {
    verdict: 'regression-committed', committed: ['a'], uncommitted: ['b'],
    undetermined: [], population: null, exit: 2,
  });
  const u = regressionVerdict(['b'], { fail: 6, names: ['env-only'] });
  assert.equal(u.verdict, 'regression-uncommitted');
  assert.deepEqual(u.uncommitted, ['b']);
});

// R17 · CORRESPONDENCE. Absence from head.names is two facts in one shape: the test ran and passed,
// or it never ran. Blaming the second on uncommitted work is the mechanism behind this gate's false
// "committed and attributable" lines — a run that executes fewer cases (a glob that stopped
// matching, a crash, a bound port, a timeout) makes every unexecuted test look like a local break.
test('regressionVerdict: a SHORTFALL at HEAD makes absence undetermined, not somebody fault', () => {
  // The tree ran 100 cases; HEAD managed only 47. 'b' is absent from HEAD's failures, but HEAD
  // never got far enough for that to mean anything.
  const v = regressionVerdict(['a', 'b'], { fail: 3, names: ['a'], tests: 47 }, { tests: 100 });
  assert.deepEqual(v.committed, ['a'], 'a failure AT HEAD is committed however little else ran');
  assert.deepEqual(v.uncommitted, [], 'nothing may be blamed on uncommitted work here');
  assert.deepEqual(v.undetermined, ['b'], 'and the unplaceable name is named as unplaceable');
  assert.deepEqual(v.population, { tests: 100, headTests: 47, shortfall: 53 },
    'the record must state the shortfall, or a reader cannot weigh the verdict');
});

test('regressionVerdict: equal or larger population at HEAD keeps the old, sound classification', () => {
  const v = regressionVerdict(['a', 'b'], { fail: 3, names: ['a'], tests: 100 }, { tests: 100 });
  assert.deepEqual(v.uncommitted, ['b'], 'like-for-like: absence really does mean it passed');
  assert.deepEqual(v.undetermined, []);
  assert.equal(v.population.shortfall, 0);
});

test('regressionVerdict: nothing placeable is INCOMPARABLE, never "uncommitted"', () => {
  const v = regressionVerdict(['b'], { fail: 1, names: [], tests: 10 }, { tests: 100 });
  assert.equal(v.verdict, 'regression-incomparable',
    'naming a culprit for a comparison that never happened is the defect, not the fallback');
  assert.deepEqual(v.undetermined, ['b']);
});

test('regressionVerdict: a HEAD reading missing its inputs yields UNDETERMINED, never committed', () => {
  // The measured case, 2026-08-29: `the live registry: client-a is paused` failed at HEAD only
  // because the checkout had no monitor/private, and was reported as committed breakage.
  const d = regressionVerdict(['the live registry: client-a is paused', 'b'],
    { fail: 6, names: ['the live registry: client-a is paused'], degraded: ['monitor/private'] });
  assert.equal(d.verdict, 'regression-undetermined');
  assert.deepEqual(d.committed, [], 'an unprovable failure must not be published as committed');
  assert.deepEqual(d.undetermined, ['the live registry: client-a is paused']);
  assert.deepEqual(d.uncommitted, ['b']);
  assert.deepEqual(d.degraded, ['monitor/private']);

  // unsupported findings: degraded still exits 2 and still reports the uncommitted half.
  assert.equal(d.exit, 2);
  const none = regressionVerdict(['b'], { fail: 6, names: ['env-only'], degraded: ['fixtures'] });
  assert.equal(none.verdict, 'regression-uncommitted', 'nothing shared with HEAD is still uncommitted');
  assert.deepEqual(none.undetermined, []);

  // An EMPTY degraded list is a complete reading — the old verdict must survive.
  const ok = regressionVerdict(['a'], { fail: 4, names: ['a'], degraded: [] });
  assert.equal(ok.verdict, 'regression-committed');
  assert.deepEqual(ok.committed, ['a']);
});

test('coverageVerdict: the second reading wins', () => {
  assert.deepEqual(coverageVerdict(90, { pass: 100 }, { pass: 100 }),
    { verdict: 'coverage-transient', dip: 90, recovered: 100, exit: 0 });
  assert.deepEqual(coverageVerdict(90, { pass: 88 }, { pass: 100 }),
    { verdict: 'coverage-loss', fromPass: 100, toPass: 88, exit: 2 });
  // second run unparseable → first reading stands, still a loss
  assert.deepEqual(coverageVerdict(90, { pass: null }, { pass: 100 }),
    { verdict: 'coverage-loss', fromPass: 100, toPass: 90, exit: 2 });
});

test('attributeFiles: mine only if my touch postdates my last commit; landed work is nobody\'s dirt', () => {
  const lines = [
    JSON.stringify({ s: 'me000000', f: 'a.mjs', at: '2026-08-10T02:00:00Z' }),
    JSON.stringify({ s: 'me000000', f: 'b.mjs', at: '2026-08-09T00:00:00Z' }), // predates my commit of b
    JSON.stringify({ s: 'other111', f: 'c.mjs', at: '2026-08-10T03:00:00Z' }),
    JSON.stringify({ s: 'other111', f: 'b.mjs', at: '2026-08-08T00:00:00Z' }), // their landed work
    'not json at all',
  ];
  // git %cI: a LOCAL offset and second precision, never a Z — the format is the point
  const committedAt = (f) => (f === 'b.mjs' ? '2026-08-09T21:30:00+09:30' : '');
  const r = attributeFiles(['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'], 'me000000-full-session-id', { ledgerLines: lines, committedAt });
  assert.deepEqual(r.mine, ['a.mjs']);
  assert.deepEqual(r.theirs, ['c.mjs']);
  // b.mjs is DIRTY yet all touches predate its landing — UNDETERMINED, a different fact from
  // d.mjs's "no ledger entry at all"
  assert.deepEqual(r.undetermined, ['b.mjs']);
  // undetermined ⊆ unknown on purpose — no legacy reader loses sight of a file
  assert.deepEqual(r.unknown, ['b.mjs', 'd.mjs']);
  assert.deepEqual([...r.others], ['other111']);
  assert.equal(r.torn, 1, 'the unparseable line is counted, not silently dropped');
});

test('attributeFiles: a touch AFTER the commit is LIVE even though git says +09:30 and the ledger says Z', () => {
  // git says +09:30, the ledger says Z; compared as strings live work reads as landed
  const lines = [JSON.stringify({ s: 'me000000', f: 'a.mjs', at: '2026-08-11T09:44:00.000Z' })];
  const committedAt = () => '2026-08-11T17:24:18+09:30';
  const r = attributeFiles(['a.mjs'], 'me000000-full-session-id', { ledgerLines: lines, committedAt });
  assert.deepEqual(r.mine, ['a.mjs'], 'the touch postdates the commit in real time; only a string comparison says otherwise');
});

test('attributeFiles: co-owned files are SHARED, never silently one session\'s', () => {
  // an early return on the first own-touch never examined a co-session's live work in the same file
  const lines = [
    JSON.stringify({ s: 'me000000', f: 'a.mjs', at: '2026-08-11T04:13:00.000Z' }),
    JSON.stringify({ s: 'other111', f: 'a.mjs', at: '2026-08-11T08:49:00.000Z' }),
  ];
  const r = attributeFiles(['a.mjs'], 'me000000-full-session-id', { ledgerLines: lines, committedAt: () => '' });
  assert.deepEqual(r.shared, ['a.mjs']);
  assert.deepEqual(r.mine, [], 'a file two sessions are holding is not exclusively mine');
  assert.deepEqual(r.theirs, ['a.mjs'], 'shared is a SUBSET of theirs so legacy readers still warn');
  assert.deepEqual(r.liveSessions['a.mjs'].sort(), ['me000000', 'other111']);
});

test('attributeFiles: a touch inside the commit\'s own second resolves LIVE, not landed', () => {
  // second-precision %cI vs millisecond ledger — the tie must fall toward live
  const lines = [JSON.stringify({ s: 'me000000', f: 'a.mjs', at: '2026-08-11T07:54:18.500Z' })];
  const r = attributeFiles(['a.mjs'], 'me000000-full', { ledgerLines: lines, committedAt: () => '2026-08-11T17:24:18+09:30' });
  assert.deepEqual(r.mine, ['a.mjs']);
});

test('attributeFiles: an unparseable timestamp is UNDETERMINED — never silently live, never silently landed', () => {
  const lines = [JSON.stringify({ s: 'other111', f: 'a.mjs', at: 'not-a-date' })];
  const r = attributeFiles(['a.mjs'], 'me000000-full', { ledgerLines: lines, committedAt: () => '2026-08-11T17:24:18+09:30' });
  assert.deepEqual(r.undetermined, ['a.mjs']);
  assert.deepEqual(r.mine, []);
  assert.deepEqual(r.theirs, []);
});

test('attributeFiles: no session degrades to unattributed, never guesses', () => {
  const r = attributeFiles(['a.mjs'], null, { ledgerLines: [JSON.stringify({ s: 'x', f: 'a.mjs', at: 't' })] });
  assert.deepEqual(r.mine, []);
  assert.deepEqual(r.unknown, ['a.mjs']);
});

// ── TREE IDENTITY ────────────────────────────────────────────────────────────────────────────────
// One store, several checkouts. Paths are relative to the writer's own repo, so `bin/x.mjs` from
// another tree is byte-identical to this one's and attributing it locally is a confident false blame.
test('a row stamped with ANOTHER tree is excluded, never attributed', () => {
  const lines = [
    JSON.stringify({ f: 'a.mjs', s: 'ffffffff', at: '2026-01-02T00:00:00Z', r: 'other-tree-1' }),
    JSON.stringify({ f: 'a.mjs', s: 'aaaaaaaa', at: '2026-01-02T00:00:00Z', r: 'mine-tree-01' }),
  ];
  const r = attributeFiles(['a.mjs'], 'aaaaaaaa', { ledgerLines: lines, myTree: 'mine-tree-01' });
  assert.deepEqual(r.mine, ['a.mjs']);
  assert.deepEqual(r.theirs, [], 'the foreign row must not make this someone else\'s file');
  assert.equal(r.foreignTreeRows, 1);
  assert.equal(r.treeUnknownRows, 0);
});

test('rows with NO tree stamp are counted, not dropped — 95% of the ledger predates the field', () => {
  const lines = [JSON.stringify({ f: 'a.mjs', s: 'bbbbbbbb', at: '2026-01-02T00:00:00Z' })];
  const r = attributeFiles(['a.mjs'], 'aaaaaaaa', { ledgerLines: lines, myTree: 'mine-tree-01' });
  assert.deepEqual(r.theirs, ['a.mjs'], 'an unstamped row still attributes — dropping it deletes the evidence');
  assert.equal(r.treeUnknownRows, 1, 'and the caller is told how much of its evidence was unplaceable');
});

test('without myTree nothing is excluded — the field is additive, not a new filter', () => {
  const lines = [JSON.stringify({ f: 'a.mjs', s: 'bbbbbbbb', at: '2026-01-02T00:00:00Z', r: 'other-tree-1' })];
  const r = attributeFiles(['a.mjs'], 'aaaaaaaa', { ledgerLines: lines });
  assert.deepEqual(r.theirs, ['a.mjs']);
  assert.equal(r.foreignTreeRows, 0);
});

test('the evidence note states the population, and says nothing when there is nothing to say', () => {
  assert.equal(treeEvidenceNote({}), '', 'no counts ⇒ no sentence; never a reassuring "0 unknown"');
  assert.equal(treeEvidenceNote({ treeUnknownRows: 0, foreignTreeRows: 0 }), '');
  const n = treeEvidenceNote({ treeUnknownRows: 99, foreignTreeRows: 1 });
  assert.match(n, /99 of 100 ledger rows carry NO tree identity \(99%\)/);
  assert.match(n, /1 were dropped as another checkout's/);
  assert.match(n, /may name a session from a different checkout/, 'the note must say what the gap COSTS, not just its size');
  // the foreign clause is omitted when there is none, rather than rendering "0 were dropped"
  assert.doesNotMatch(treeEvidenceNote({ treeUnknownRows: 5 }), /dropped/);
});
  test('a stamped row is IN the population — the denominator is not unknown+foreign alone', () => {
    // The defect this pins: `total = treeUnknownRows + foreignTreeRows` omitted every 'mine' row, so
    // with no foreign stamp — today's condition, zero rows carry one — the ratio was n/n and read
    // 100% however many rows carried a valid stamp. Measured 2026-08-30: 18282 unplaceable against
    // 3803 stamped published as "18282 of 18282 (100%)", telling every session attribution was
    // worthless on a store where a fifth was already placeable and rising with each write.
    // The fixture above cannot catch this: 99 unknown + 1 foreign carries ZERO mine rows, which is
    // exactly the population where the broken denominator returns the right answer.
    const n = treeEvidenceNote({ treeUnknownRows: 18282, foreignTreeRows: 0, treeMineRows: 3803 });
    assert.match(n, /18282 of 22085 ledger rows carry NO tree identity \(83%\)/);
    assert.doesNotMatch(n, /\(100%\)/, 'a population containing stamped rows is never 100% unplaceable');
  });


// ── COVERAGE IS A QUESTION ABOUT `tests`, NOT `pass` ─────────────────────────────────────────────
// Measured 2026-08-29 on one unchanged tree: two consecutive runs gave tests 5681 both times and
// pass 5668 then 5666. The old check compared `pass`, so it fired "the suite got SMALLER" on that
// and sent every session in the fleet hunting a glob that had stopped matching.
test('a FLAKY failure does not read as coverage loss — same total, fewer passes', () => {
  const base = { fail: 1, pass: 5668, tests: 5681 };
  const v = initialVerdict({ fail: 1, pass: 5666, tests: 5681 }, base);
  assert.notEqual(v.verdict, 'coverage-pending',
    'pass moved and tests did not; nothing vanished, so this must not alarm');
  assert.equal(v.verdict, 'steady');
});

test('a REAL disappearance still alarms — the total actually drops', () => {
  const base = { fail: 1, pass: 5668, tests: 5681 };
  const v = initialVerdict({ fail: 1, pass: 5600, tests: 5610 }, base);
  assert.equal(v.verdict, 'coverage-pending');
  assert.equal(v.fromTests, 5681);
  assert.equal(v.toTests, 5610);
});

test('a baseline with no `tests` cannot answer the question, and says so instead of guessing', () => {
  // Old baselines predate the field. Silence would read as a clean coverage check; the flag is what
  // stops a caller inferring one. It does not alarm either — an unknown is not a finding.
  const v = initialVerdict({ fail: 1, pass: 5000, tests: 5681 }, { fail: 1, pass: 5668 });
  assert.equal(v.coverageCheckable, false);
  assert.notEqual(v.verdict, 'coverage-pending');
});

test('the check goes live once a baseline carries the total — self-healing, one run', () => {
  const v = initialVerdict({ fail: 1, pass: 5668, tests: 5681 }, { fail: 1, pass: 5668, tests: 5681 });
  assert.equal(v.coverageCheckable, true);
});

test('parseSuiteOutput captures the total, and a missing tally stays null', () => {
  const out = 'ℹ tests 5681\nℹ pass 5668\nℹ fail 1\n';
  assert.equal(parseSuiteOutput(out).tests, 5681);
  assert.equal(parseSuiteOutput('ℹ pass 3\nℹ fail 0\n').tests, null, 'absent is UNKNOWN, never zero');
});

test('coverageVerdict confirms on the total when it has one', () => {
  const base = { fail: 1, pass: 5668, tests: 5681 };
  // pass recovered by luck but the total is still short: still a loss.
  assert.equal(coverageVerdict(5600, { pass: 5670, tests: 5610 }, base).verdict, 'coverage-loss');
  // total recovered: transient, whatever pass did.
  assert.equal(coverageVerdict(5600, { pass: 5000, tests: 5681 }, base).verdict, 'coverage-transient');
});
