// Lanes outside the findings population (admin/routes/determinations.mjs nonFindingLanes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nonFindingLanes } from '../routes/determinations.mjs';

test('returns the five ruled-out lanes when rollup is undefined', () => {
  const result = nonFindingLanes(undefined);
  assert.equal(result.size, 5);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('denoLint'));
  assert.ok(result.has('denoTypes'));
  assert.ok(result.has('shellLint'));
  assert.ok(result.has('actionsLint'));
});

test('returns the five ruled-out lanes when rollup is null', () => {
  const result = nonFindingLanes(null);
  assert.equal(result.size, 5);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('denoLint'));
  assert.ok(result.has('denoTypes'));
  assert.ok(result.has('shellLint'));
  assert.ok(result.has('actionsLint'));
});

test('returns the five ruled-out lanes when rollup has no metrics property', () => {
  const result = nonFindingLanes({});
  assert.equal(result.size, 5);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('denoLint'));
  assert.ok(result.has('denoTypes'));
  assert.ok(result.has('shellLint'));
  assert.ok(result.has('actionsLint'));
});

test('returns the five ruled-out lanes when metrics is an empty object', () => {
  const result = nonFindingLanes({ metrics: {} });
  assert.equal(result.size, 5);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('denoLint'));
  assert.ok(result.has('denoTypes'));
  assert.ok(result.has('shellLint'));
  assert.ok(result.has('actionsLint'));
});

test('includes declared metric keys alongside the ruled-out lanes', () => {
  const result = nonFindingLanes({ metrics: { density: 0.1, coverage: 0.9 } });
  assert.equal(result.size, 7);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('denoLint'));
  assert.ok(result.has('denoTypes'));
  assert.ok(result.has('shellLint'));
  assert.ok(result.has('actionsLint'));
  assert.ok(result.has('density'));
  assert.ok(result.has('coverage'));
});

test('deduplicates declared keys that match ruled-out lane names', () => {
  const result = nonFindingLanes({ metrics: { stubs: 1, denoLint: 2 } });
  assert.equal(result.size, 5);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('denoLint'));
  assert.ok(result.has('denoTypes'));
  assert.ok(result.has('shellLint'));
  assert.ok(result.has('actionsLint'));
});

test('handles a single declared metric key', () => {
  const result = nonFindingLanes({ metrics: { todo: 42 } });
  assert.equal(result.size, 6);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('denoLint'));
  assert.ok(result.has('denoTypes'));
  assert.ok(result.has('shellLint'));
  assert.ok(result.has('actionsLint'));
  assert.ok(result.has('todo'));
});

test('handles many declared metric keys without duplication', () => {
  const keys = Array.from({ length: 100 }, (_, i) => `metric${i}`);
  const metrics = Object.fromEntries(keys.map((k) => [k, 1]));
  const result = nonFindingLanes({ metrics });
  assert.equal(result.size, 105);
  assert.ok(result.has('stubs'));
  assert.ok(result.has('metric0'));
  assert.ok(result.has('metric99'));
});
