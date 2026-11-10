// Flattens divergence subject rows with subject fallback (monitor/divergence-kappa.mjs divergenceRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divergenceRows } from '../divergence-kappa.mjs';

const realFlatMap = Array.prototype.flatMap;

function rowsFor(subjects) {
  Array.prototype.flatMap = function (cb, thisArg) {
    const text = String(cb);
    const target = text.includes('s.rows.map') && text.includes('r.subject') ? subjects : this;
    return realFlatMap.call(target, cb, thisArg);
  };
  try {
    return divergenceRows();
  } finally {
    Array.prototype.flatMap = realFlatMap;
  }
}

test('returns an empty array when there are no subjects', () => {
  assert.deepEqual(rowsFor([]), []);
});

test('returns an empty array when every subject has no rows', () => {
  const r = rowsFor([
    { subject: 'a', rows: [] },
    { subject: 'b', rows: [] },
  ]);
  assert.deepEqual(r, []);
});

test('keeps the subject already set on a row', () => {
  const r = rowsFor([{ subject: 'parent', rows: [{ subject: 'own', score: 0.5 }] }]);
  assert.deepEqual(r, [{ subject: 'own', score: 0.5 }]);
});

test('uses the parent subject when the row subject is null', () => {
  const r = rowsFor([{ subject: 'parent', rows: [{ subject: null, score: 1 }] }]);
  assert.deepEqual(r, [{ subject: 'parent', score: 1 }]);
});

test('uses the parent subject when the row subject is missing or undefined', () => {
  const r = rowsFor([{ subject: 'parent', rows: [{ score: 0 }, { subject: undefined, score: 1 }] }]);
  assert.deepEqual(r, [
    { score: 0, subject: 'parent' },
    { subject: 'parent', score: 1 },
  ]);
});

test('keeps falsy row subjects such as an empty string, zero and false', () => {
  const r = rowsFor([{ subject: 'parent', rows: [{ subject: '' }, { subject: 0 }, { subject: false }] }]);
  assert.deepEqual(r, [{ subject: '' }, { subject: 0 }, { subject: false }]);
});

test('takes the parent value as it is when neither side has a subject', () => {
  const r = rowsFor([
    { rows: [{ score: 1 }, { subject: null, score: 2 }] },
    { subject: null, rows: [{ score: 3 }] },
  ]);
  assert.deepEqual(r, [
    { score: 1, subject: undefined },
    { subject: undefined, score: 2 },
    { score: 3, subject: null },
  ]);
});

test('flattens subjects in order and applies each parent to its own rows', () => {
  const r = rowsFor([
    { subject: 'a', rows: [{ score: 1 }, { subject: 'x', score: 2 }] },
    { subject: 'b', rows: [] },
    { subject: 'c', rows: [{ score: 3 }] },
  ]);
  assert.deepEqual(r, [
    { score: 1, subject: 'a' },
    { subject: 'x', score: 2 },
    { score: 3, subject: 'c' },
  ]);
});

test('copies each row shallowly and leaves the input row unchanged', () => {
  const detail = { coverage: { both: 2 } };
  const ts = '2026-10-29T13:26:36.245Z';
  const row = { dimension: 'divergence', score: 0.775, ts, detail };
  const r = rowsFor([{ subject: 's', rows: [row] }]);
  assert.deepEqual(r, [
    { dimension: 'divergence', score: 0.775, ts, detail: { coverage: { both: 2 } }, subject: 's' },
  ]);
  assert.notEqual(r[0], row);
  assert.equal(r[0].detail, detail);
  assert.deepEqual(row, { dimension: 'divergence', score: 0.775, ts, detail: { coverage: { both: 2 } } });
});

test('throws a TypeError when a subject has no rows array or a row is null', () => {
  assert.throws(() => rowsFor([{ subject: 'a' }]), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'map')",
  });
  assert.throws(() => rowsFor([{ subject: 'a', rows: [null] }]), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'subject')",
  });
});
