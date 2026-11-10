// Applies a shared nice priority to the current process (monitor/host-role.mjs applySharedPriority).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySharedPriority } from '../host-role.mjs';

test('returns applied false when current priority is already at the shared nice value', () => {
  const r = applySharedPriority({ get: () => 10, set: () => {} });
  assert.deepEqual(r, { applied: false, from: 10, to: 10, why: "already at or below shared priority" });
});

test('returns applied false when current priority is above the shared nice value', () => {
  const r = applySharedPriority({ get: () => 11, set: () => {} });
  assert.deepEqual(r, { applied: false, from: 11, to: 11, why: "already at or below shared priority" });
});

test('returns applied true and sets priority when current priority is below the shared nice value', () => {
  const r = applySharedPriority({ get: () => 9, set: () => {} });
  assert.deepEqual(r, { applied: true, from: 9, to: 10 });
});

test('returns applied true and sets priority when current priority is zero', () => {
  const r = applySharedPriority({ get: () => 0, set: () => {} });
  assert.deepEqual(r, { applied: true, from: 0, to: 10 });
});

test('returns applied false with null values when the get function throws', () => {
  const r = applySharedPriority({ get: () => { throw new Error('boom'); }, set: () => {} });
  assert.deepEqual(r, { applied: false, from: null, to: null, why: "setPriority failed (boom)" });
});

test('returns applied false with null values when the set function throws', () => {
  const r = applySharedPriority({ get: () => 5, set: () => { throw new Error('denied'); } });
  assert.deepEqual(r, { applied: false, from: null, to: null, why: "setPriority failed (denied)" });
});
