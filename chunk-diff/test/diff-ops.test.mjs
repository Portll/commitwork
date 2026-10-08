import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, diffOps, groupOps, similarity, boundedWordDiff } from '../lib/diff-ops.mjs';

describe('tokenize', () => {
  test('splits on whitespace/non-whitespace runs, keeping the whitespace', () => {
    assert.deepEqual(tokenize('a b  c'), ['a', ' ', 'b', '  ', 'c']);
  });
});

describe('diffOps', () => {
  test('identical arrays are all equal ops', () => {
    const ops = diffOps(['a', 'b'], ['a', 'b']);
    assert.deepEqual(ops, [{ t: '=', s: 'a' }, { t: '=', s: 'b' }]);
  });
  test('a pure insertion is one + op', () => {
    const ops = groupOps(diffOps(['a', 'b'], ['a', 'x', 'b']));
    assert.deepEqual(ops.map((o) => o.t), ['=', '+', '=']);
  });
});

describe('similarity', () => {
  test('identical text is 1', () => { assert.equal(similarity('hello world', 'hello world'), 1); });
  test('disjoint text is 0', () => { assert.equal(similarity('abc', 'xyz'), 0); });
  test('empty vs non-empty is 0, not NaN — an empty chunk must never look confidently similar', () => {
    assert.equal(similarity('', 'something'), 0);
  });
});

describe('boundedWordDiff — the no-silent-truncation cap', () => {
  test('under the cap: real ops, capped:false', () => {
    const { ops, capped } = boundedWordDiff('a b c', 'a b d', 10);
    assert.equal(capped, false);
    assert.ok(ops.length > 0);
  });
  test('over the cap: refuses the DP table entirely rather than diffing a truncated slice', () => {
    const big = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');
    const { ops, capped } = boundedWordDiff(big, big, 5);
    assert.equal(capped, true);
    assert.equal(ops, null, 'a capped result must never hand back a partial diff — that reads as complete when it is not');
  });
});
