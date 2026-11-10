// Computes whether a recount of export rows matches the stored tally (monitor/memory-export-health.mjs tallyDivergence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyDivergence } from '../memory-export-health.mjs';

test('returns no-stored-tally when stored is null', () => {
  assert.deepEqual(tallyDivergence({ a: 1 }, null), { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" });
});

test('returns no-stored-tally when stored is a string', () => {
  assert.deepEqual(tallyDivergence({ a: 1 }, 'x'), { state: "no-stored-tally", fields: [], note: "the receipts file carries no tally to check this recount against" });
});

test('returns agrees when all shared keys match numerically', () => {
  assert.deepEqual(tallyDivergence({ a: 1, b: 2 }, { a: 1, b: 2 }), { state: "agrees", fields: [], note: null });
});

test('returns diverged when a shared key differs', () => {
  assert.deepEqual(tallyDivergence({ a: 1, b: 2 }, { a: 1, b: 3 }), { state: "diverged", fields: [{ field: "b", stored: 3, recounted: 2 }], note: "the stored tally does not match a recount of the rows beside it \u2014 one of the two is wrong and neither may be quoted" });
});

test('skips keys absent from stored tally', () => {
  assert.deepEqual(tallyDivergence({ a: 1, b: 2 }, { a: 1 }), { state: "agrees", fields: [], note: null });
});

test('treats string numbers as equal when values match', () => {
  assert.deepEqual(tallyDivergence({ a: '5' }, { a: 5 }), { state: "agrees", fields: [], note: null });
});

test('treats string numbers as divergent when values differ', () => {
  assert.deepEqual(tallyDivergence({ a: '5' }, { a: 6 }), { state: "diverged", fields: [{ field: "a", stored: 6, recounted: 5 }], note: "the stored tally does not match a recount of the rows beside it \u2014 one of the two is wrong and neither may be quoted" });
});

test('returns agrees when stored has extra keys not in recounted', () => {
  assert.deepEqual(tallyDivergence({ a: 1 }, { a: 1, b: 9 }), { state: "agrees", fields: [], note: null });
});
