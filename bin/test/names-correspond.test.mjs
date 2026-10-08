// R17 · a re-measurement must correspond BY NAME, and that guard must be asserted.
//
// It fires 403 times in the live ledger and, until 2026-08-30, forcing it to `true` left every test
// green — a guard nothing could notice the loss of. That is the R17 shape exactly: the mechanism was
// real, and its correctness was a streak rather than a fact somebody checked.
//
// WHY IT MATTERS. Some tests read the LIVE FLEET, so re-running an old sha does not reproduce the
// gate's run. A truth emitted from two runs that measured different worlds is not a weaker fact —
// it is a fabricated one, and it lands in the ground-truth store everything else is scored against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesCorrespond } from '../adjudicate-gates.mjs';

test('THE GUARD: no shared name means the two runs measured different worlds', () => {
  assert.equal(namesCorrespond(['a', 'b'], ['c', 'd']), false,
    'emitting a truth here would score one world against another');
});

test('one shared name is enough — deliberately not a ratio', () => {
  assert.equal(namesCorrespond(['a', 'b', 'c'], ['c', 'z']), true,
    'requiring more would reject a real correspondence whenever the record happens to be short');
});

test('both clean is agreement — nothing failed then, nothing fails now', () => {
  assert.equal(namesCorrespond([], []), true);
  assert.equal(namesCorrespond(new Set(), new Set()), true);
});

test('ONE side clean is NOT agreement — this is the asymmetry the guard exists for', () => {
  assert.equal(namesCorrespond(['a'], []), false,
    'the record named a failure and the re-run found none: that is a different world, not a pass');
  assert.equal(namesCorrespond([], ['a']), false,
    'and the reverse — a failure appearing from nowhere is equally unmatched');
});

test('Sets and arrays are both accepted, with identical results', () => {
  assert.equal(namesCorrespond(new Set(['a']), new Set(['a'])), true);
  assert.equal(namesCorrespond(['a'], new Set(['a'])), true);
  assert.equal(namesCorrespond(new Set(['a']), ['b']), false);
});

test('nullish input does not throw and does not silently agree', () => {
  assert.equal(namesCorrespond(null, null), true, 'both absent is the both-clean case');
  assert.equal(namesCorrespond(['a'], null), false, 'one side present cannot correspond to nothing');
  assert.equal(namesCorrespond(undefined, ['a']), false);
});

// THE MUTATION THIS FILE EXISTS TO CATCH. The audit's finding was that forcing the guard to `true`
// left 123/123 green. Asserted here rather than described: if namesCorrespond ever returns true for
// two disjoint sets, that is the defect, and this is the test that goes red.
test('MUTATION SENTINEL: a guard that always agrees is not a guard', () => {
  const disjoint = [['a'], ['b']];
  assert.equal(namesCorrespond(...disjoint), false,
    'forcing this to true is the exact mutation that survived until this test existed');
});
