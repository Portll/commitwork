// Computes a three-element sort key from severity, urgency, and size (lib/judge-taxonomy.mjs priorityKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priorityKey } from '../judge-taxonomy.mjs';

test('maps a critical severity and small size to the top priority bucket', () => {
  const input = { severity: 'critical', urgency: 'high', size: 'S' };
  const result = priorityKey(input);
  assert.deepEqual(result, [0, 1, 1]);
});

test('maps a high severity and medium size to the second priority bucket', () => {
  const input = { severity: 'high', urgency: 'med', size: 'M' };
  const result = priorityKey(input);
  assert.deepEqual(result, [1, 2, 2]);
});

test('maps a medium severity and large size to the third priority bucket', () => {
  const input = { severity: 'med', urgency: 'low', size: 'L' };
  const result = priorityKey(input);
  assert.deepEqual(result, [2, 3, 3]);
});

test('maps a low severity and extra-large size to the lowest priority bucket', () => {
  const input = { severity: 'low', urgency: 'none', size: 'XL' };
  const result = priorityKey(input);
  assert.deepEqual(result, [3, 3, 4]);
});

test('sorts undetermined severity after all known severity levels', () => {
  const input = { severity: 'unknown', urgency: 'crit', size: 'XS' };
  const result = priorityKey(input);
  assert.deepEqual(result, [4, 0, 0]);
});

test('sorts undetermined urgency after all known urgency levels', () => {
  const input = { severity: 'crit', urgency: 'weird', size: 'XS' };
  const result = priorityKey(input);
  assert.deepEqual(result, [0, 4, 0]);
});

test('sorts undetermined size after all known size levels', () => {
  const input = { severity: 'crit', urgency: 'crit', size: 'huge' };
  const result = priorityKey(input);
  assert.deepEqual(result, [0, 0, 5]);
});

test('normalizes numeric severity scores to their corresponding rank', () => {
  const input = { severity: 9, urgency: 7, size: 4 };
  const result = priorityKey(input);
  assert.deepEqual(result, [0, 4, 5]);
});

test('handles null inputs by treating them as undetermined', () => {
  const input = { severity: null, urgency: null, size: null };
  const result = priorityKey(input);
  assert.deepEqual(result, [4, 4, 5]);
});

test('handles empty string inputs by treating them as undetermined', () => {
  const input = { severity: '', urgency: '', size: '' };
  const result = priorityKey(input);
  assert.deepEqual(result, [4, 4, 5]);
});
