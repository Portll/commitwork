// Lookup of retracted adjudication judgements plus their distinct count (bin/lib/verdict-journal-core.mjs retractionsFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retractionsFrom } from '../lib/verdict-journal-core.mjs';

test('an empty list yields count zero and has returns false', () => {
  const r = retractionsFrom([]);
  assert.equal(r.count, 0);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1' }), false);
});

test('null and undefined entries are skipped', () => {
  const r = retractionsFrom([null, undefined]);
  assert.equal(r.count, 0);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1' }), false);
});

test('a record of another kind with gate and recordAt is skipped', () => {
  const r = retractionsFrom([{ kind: 'adjudication', gate: 'g1', recordAt: 't1' }]);
  assert.equal(r.count, 0);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1' }), false);
});

test('a retraction without a gate is skipped', () => {
  const r = retractionsFrom([
    { kind: 'adjudication-retraction', recordAt: 't1' },
    { kind: 'adjudication-retraction', gate: '', recordAt: 't2' },
  ]);
  assert.equal(r.count, 0);
  assert.equal(r.has({ recordAt: 't1' }), false);
  assert.equal(r.has({ gate: '', recordAt: 't2' }), false);
});

test('a retraction without a recordAt is skipped', () => {
  const r = retractionsFrom([
    { kind: 'adjudication-retraction', gate: 'g1' },
    { kind: 'adjudication-retraction', gate: 'g2', recordAt: '' },
  ]);
  assert.equal(r.count, 0);
  assert.equal(r.has({ gate: 'g1' }), false);
  assert.equal(r.has({ gate: 'g2', recordAt: '' }), false);
});

test('a method-scoped retraction matches only that method', () => {
  const r = retractionsFrom([{ kind: 'adjudication-retraction', gate: 'g1', recordAt: 't1', method: 'm1' }]);
  assert.equal(r.count, 1);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm1' }), true);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm2' }), false);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1' }), false);
  assert.equal(r.has({ gate: 'g2', recordAt: 't1', method: 'm1' }), false);
});

test('a retraction without method matches every method of that decision', () => {
  const r = retractionsFrom([{ kind: 'adjudication-retraction', gate: 'g1', recordAt: 't1' }]);
  assert.equal(r.count, 1);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1' }), true);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm9' }), true);
  assert.equal(r.has({ gate: 'g1', recordAt: 't2' }), false);
  assert.equal(r.has({ gate: 'g2', recordAt: 't1', method: 'm9' }), false);
});

test('duplicate retractions collapse while scoped and unscoped ones count separately', () => {
  const r = retractionsFrom([
    { kind: 'adjudication-retraction', gate: 'g1', recordAt: 't1', method: 'm1' },
    { kind: 'adjudication-retraction', gate: 'g1', recordAt: 't1', method: 'm1' },
    { kind: 'adjudication-retraction', gate: 'g1', recordAt: 't1' },
    { kind: 'adjudication-retraction', gate: 'g1', recordAt: 't1' },
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm7' }), true);
});

test('only retraction records among mixed entries are counted', () => {
  const r = retractionsFrom([
    null,
    { kind: 'adjudication', gate: 'g1', recordAt: 't1', method: 'm1' },
    { kind: 'adjudication-retraction', gate: 'g2', recordAt: 't2', method: 'm2' },
    { kind: 'adjudication-retraction', recordAt: 't3' },
  ]);
  assert.equal(r.count, 1);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm1' }), false);
  assert.equal(r.has({ gate: 'g2', recordAt: 't2', method: 'm2' }), true);
});

test('many distinct retractions are each counted once', () => {
  const recs = Array.from({ length: 6 }, (_, i) => ({
    kind: 'adjudication-retraction',
    gate: `g${i}`,
    recordAt: `t${i}`,
    ...(i % 2 ? { method: `m${i}` } : {}),
  }));
  const r = retractionsFrom(recs);
  assert.equal(r.count, 6);
  assert.equal(r.has({ gate: 'g0', recordAt: 't0', method: 'x' }), true);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'm1' }), true);
  assert.equal(r.has({ gate: 'g1', recordAt: 't1', method: 'x' }), false);
});
