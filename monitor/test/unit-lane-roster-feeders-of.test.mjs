// The sorted map of aliases and meta.also feeders for a roster row (monitor/lane-roster.mjs feedersOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedersOf } from '../lane-roster.mjs';

const declared = (check) => `declared alias of ${check} (monitor/scanner-checks.mjs CHECK_ALIASES)`;

function comparatorResults(pairs) {
  const realSort = Array.prototype.sort;
  const results = [];
  Array.prototype.sort = function spySort(compare) {
    for (const [left, right] of pairs) results.push(compare([left, 'x'], [right, 'y']));
    return realSort.call(this, compare);
  };
  try {
    feedersOf(['lane', 'checkA', 'kind', undefined], {});
  } finally {
    Array.prototype.sort = realSort;
  }
  return results;
}

test('returns an empty object when no alias targets the check and the row has no meta', () => {
  const r = feedersOf(['lane', 'checkA', 'kind', undefined], { a1: 'checkB', a2: 'checkC' });
  assert.deepEqual(r, {});
});

test('lists only the aliases whose target equals the check', () => {
  const r = feedersOf(['lane', 'checkA', 'kind', undefined], { a1: 'checkA', a2: 'checkB' });
  assert.deepEqual(r, { a1: declared('checkA') });
});

test('matches alias targets strictly so a number does not match its string form', () => {
  const r = feedersOf(['lane', '1', 'kind', undefined], { one: 1, two: '1' });
  assert.deepEqual(r, { two: declared('1') });
});

test('treats a null meta the same as no meta', () => {
  const r = feedersOf(['lane', 'checkA', 'kind', null], { a1: 'checkA' });
  assert.deepEqual(r, { a1: declared('checkA') });
});

test('ignores a meta object that has no also property', () => {
  const r = feedersOf(['lane', 'checkA', 'kind', { other: 1 }], { a1: 'checkB' });
  assert.deepEqual(r, {});
});

test('merges meta also entries alongside matching aliases', () => {
  const r = feedersOf(['lane', 'checkA', 'kind', { also: { z1: 'zval' } }], { a1: 'checkA' });
  assert.deepEqual(r, { a1: declared('checkA'), z1: 'zval' });
});

test('lets a meta also entry replace an alias with the same key', () => {
  const r = feedersOf(['lane', 'checkA', 'kind', { also: { shared: 'from also' } }], { shared: 'checkA' });
  assert.deepEqual(r, { shared: 'from also' });
});

test('orders the keys by code unit whatever order they were inserted in', () => {
  const row = ['lane', 'checkA', 'kind', { also: { b1: 'bv', B1: 'Bv' } }];
  const r = feedersOf(row, { c1: 'checkA', a1: 'checkA' });
  assert.deepEqual(Object.entries(r), [
    ['B1', 'Bv'],
    ['a1', declared('checkA')],
    ['b1', 'bv'],
    ['c1', declared('checkA')],
  ]);
});

test('the comparator handed to Array.prototype.sort returns 1 for equal keys, -1 for a lower key and 1 for a higher key', () => {
  const r = comparatorResults([
    ['k', 'k'],
    ['a', 'b'],
    ['b', 'a'],
  ]);
  assert.deepEqual(r, [1, -1, 1]);
});

test('falls back to the declared alias table when no aliases argument is given', () => {
  const r = feedersOf(['lane', 'check-name-that-no-alias-targets', 'kind', { also: { z1: 'zval' } }]);
  assert.deepEqual(r, { z1: 'zval' });
});
