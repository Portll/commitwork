// Normalize urgency aliases to canonical severity (lib/judge-taxonomy.mjs normUrgency).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normUrgency } from '../judge-taxonomy.mjs';

test('maps critical alias to crit', () => {
  const input = 'critical';
  const result = normUrgency(input);
  assert.equal(result, "crit");
});

test('maps high alias to high', () => {
  const input = 'high';
  const result = normUrgency(input);
  assert.equal(result, "high");
});

test('maps medium alias to med', () => {
  const input = 'medium';
  const result = normUrgency(input);
  assert.equal(result, "med");
});

test('maps low alias to low', () => {
  const input = 'low';
  const result = normUrgency(input);
  assert.equal(result, "low");
});

test('maps unknown string to undetermined', () => {
  const input = 'unknown';
  const result = normUrgency(input);
  assert.equal(result, "undetermined");
});

test('maps null to undetermined', () => {
  const input = null;
  const result = normUrgency(input);
  assert.equal(result, "undetermined");
});

test('maps undefined to undetermined', () => {
  const input = undefined;
  const result = normUrgency(input);
  assert.equal(result, "undetermined");
});

test('maps empty string to undetermined', () => {
  const input = '';
  const result = normUrgency(input);
  assert.equal(result, "undetermined");
});

test('maps single letter c to crit', () => {
  const input = 'c';
  const result = normUrgency(input);
  assert.equal(result, "crit");
});

test('maps single letter h to high', () => {
  const input = 'h';
  const result = normUrgency(input);
  assert.equal(result, "high");
});
