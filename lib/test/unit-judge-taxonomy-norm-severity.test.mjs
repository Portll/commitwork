// Normalizes a severity label or score to a canonical level (lib/judge-taxonomy.mjs normSeverity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normSeverity } from '../judge-taxonomy.mjs';

test('maps a high score to crit', () => {
  const input = 9;
  const result = normSeverity(input);
  assert.equal(result, "crit");
});

test('maps a mid score to high', () => {
  const input = 7;
  const result = normSeverity(input);
  assert.equal(result, "high");
});

test('maps a low score to med', () => {
  const input = 4;
  const result = normSeverity(input);
  assert.equal(result, "med");
});

test('maps a zero score to low', () => {
  const input = 0;
  const result = normSeverity(input);
  assert.equal(result, "low");
});

test('maps a critical alias to crit', () => {
  const input = 'critical';
  const result = normSeverity(input);
  assert.equal(result, "crit");
});

test('maps a high alias to high', () => {
  const input = 'error';
  const result = normSeverity(input);
  assert.equal(result, "high");
});

test('maps a medium alias to med', () => {
  const input = 'warning';
  const result = normSeverity(input);
  assert.equal(result, "med");
});

test('maps a low alias to low', () => {
  const input = 'info';
  const result = normSeverity(input);
  assert.equal(result, "low");
});

test('maps an unknown string to undetermined', () => {
  const input = 'unknown';
  const result = normSeverity(input);
  assert.equal(result, "undetermined");
});

test('maps null to undetermined', () => {
  const input = null;
  const result = normSeverity(input);
  assert.equal(result, "undetermined");
});
