// Relabels findings whose identity is in the baseline as baseline (bin/lib/pattern-core.mjs applyBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseline } from '../lib/pattern-core.mjs';

test('returns an empty array when there are no adjudicated items', () => {
  const r = applyBaseline([], ['a']);
  assert.deepEqual(r, []);
});

test('throws a TypeError when adjudicated is null', () => {
  assert.throws(() => applyBaseline(null, ['a']), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'map')"
  });
});

test('relabels a finding whose identity is in the baseline and keeps its other fields', () => {
  const input = { identity: 'a', adjudication: 'finding', line: 3 };
  const r = applyBaseline([input], ['a']);
  assert.deepEqual(r, [{ identity: 'a', adjudication: 'baseline', line: 3 }]);
  assert.deepEqual(input, { identity: 'a', adjudication: 'finding', line: 3 });
  assert.notEqual(r[0], input);
});

test('keeps a finding whose identity is not in the baseline unchanged', () => {
  const input = { identity: 'b', adjudication: 'finding' };
  const r = applyBaseline([input], ['a']);
  assert.deepEqual(r, [{ identity: 'b', adjudication: 'finding' }]);
  assert.equal(r[0], input);
});

test('keeps a non-finding whose identity is in the baseline unchanged', () => {
  const input = { identity: 'a', adjudication: 'clear' };
  const r = applyBaseline([input], ['a']);
  assert.deepEqual(r, [{ identity: 'a', adjudication: 'clear' }]);
  assert.equal(r[0], input);
});

test('does not relabel an adjudication that only differs from finding by case', () => {
  const r = applyBaseline([{ identity: 'a', adjudication: 'Finding' }], ['a']);
  assert.deepEqual(r, [{ identity: 'a', adjudication: 'Finding' }]);
});

test('treats null baselineIdentities as an empty baseline', () => {
  const r = applyBaseline([{ identity: 'a', adjudication: 'finding' }], null);
  assert.deepEqual(r, [{ identity: 'a', adjudication: 'finding' }]);
});

test('treats undefined baselineIdentities as an empty baseline', () => {
  const r = applyBaseline([{ identity: 'a', adjudication: 'finding' }], undefined);
  assert.deepEqual(r, [{ identity: 'a', adjudication: 'finding' }]);
});

test('accepts a Set of baseline identities', () => {
  const r = applyBaseline([{ identity: 'x', adjudication: 'finding' }], new Set(['x']));
  assert.deepEqual(r, [{ identity: 'x', adjudication: 'baseline' }]);
});

test('maps mixed adjudications and baseline membership item by item in order', () => {
  const r = applyBaseline(
    [
      { identity: 'a', adjudication: 'finding' },
      { identity: 'b', adjudication: 'finding' },
      { identity: 'a', adjudication: 'clear' },
      { identity: 'c', adjudication: 'clear' },
      { identity: 'c', adjudication: 'finding' }
    ],
    ['a', 'c']
  );
  assert.deepEqual(r, [
    { identity: 'a', adjudication: 'baseline' },
    { identity: 'b', adjudication: 'finding' },
    { identity: 'a', adjudication: 'clear' },
    { identity: 'c', adjudication: 'clear' },
    { identity: 'c', adjudication: 'baseline' }
  ]);
});
