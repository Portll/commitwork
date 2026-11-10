// Splits a plan list into work and residue by plan id (admin/lib/overwatch-layer-read.mjs partitionPlans).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionPlans } from '../lib/overwatch-layer-read.mjs';

test('returns empty work and residue for null input', () => {
  const r = partitionPlans(null);
  assert.deepEqual(r, { work: [], residue: [], residueTasks: 0 });
});

test('returns empty work and residue for undefined input', () => {
  const r = partitionPlans(undefined);
  assert.deepEqual(r, { work: [], residue: [], residueTasks: 0 });
});

test('returns empty work and residue for empty array', () => {
  const r = partitionPlans([]);
  assert.deepEqual(r, { work: [], residue: [], residueTasks: 0 });
});

test('sends non-runner plans to work', () => {
  const p = { id: 'alpha', tasks: [{ t: 1 }, { t: 2 }] };
  const r = partitionPlans([p]);
  assert.equal(r.work.length, 1);
  assert.equal(r.work[0], p);
  assert.equal(r.residue.length, 0);
  assert.equal(r.residueTasks, 0);
});

test('sends runner plan to residue and counts its tasks', () => {
  const p = { id: 'runner', tasks: [{ a: 1 }, { b: 2 }, { c: 3 }] };
  const r = partitionPlans([p]);
  assert.equal(r.work.length, 0);
  assert.equal(r.residue.length, 1);
  assert.equal(r.residue[0], p);
  assert.equal(r.residueTasks, 3);
});

test('treats plan with missing tasks as zero residue tasks', () => {
  const p = { id: 'runner' };
  const r = partitionPlans([p]);
  assert.equal(r.residue.length, 1);
  assert.equal(r.residueTasks, 0);
});

test('treats plan with null tasks as zero residue tasks', () => {
  const p = { id: 'runner', tasks: null };
  const r = partitionPlans([p]);
  assert.equal(r.residue.length, 1);
  assert.equal(r.residueTasks, 0);
});

test('sends null plan entries to work', () => {
  const r = partitionPlans([null, { id: 'x' }]);
  assert.equal(r.work.length, 2);
  assert.equal(r.work[0], null);
  assert.equal(r.work[1].id, 'x');
  assert.equal(r.residue.length, 0);
});

test('sends empty object to work since id is undefined', () => {
  const r = partitionPlans([{}]);
  assert.equal(r.work.length, 1);
  assert.equal(r.residue.length, 0);
});

test('uses custom residuePlanId option', () => {
  const a = { id: 'runner', tasks: [{ x: 1 }] };
  const b = { id: 'custom', tasks: [{ y: 1 }, { z: 2 }] };
  const r = partitionPlans([a, b], { residuePlanId: 'custom' });
  assert.equal(r.work.length, 1);
  assert.equal(r.work[0].id, 'runner');
  assert.equal(r.residue.length, 1);
  assert.equal(r.residue[0].id, 'custom');
  assert.equal(r.residueTasks, 2);
});
