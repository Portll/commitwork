// Maps severity, urgency, and size inputs to normalized taxonomy values (lib/judge-taxonomy.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../judge-taxonomy.mjs';

test('score 9 maps to crit severity and urgency', () => {
  const input = { score: 9 };
  const result = classify(input);
  assert.deepEqual(result, { severity: "crit", urgency: "undetermined", size: "undetermined" });
});

test('score 8 maps to high severity and urgency', () => {
  const input = { score: 8 };
  const result = classify(input);
  assert.deepEqual(result, { severity: "high", urgency: "undetermined", size: "undetermined" });
});

test('score 7 maps to high severity and urgency', () => {
  const input = { score: 7 };
  const result = classify(input);
  assert.deepEqual(result, { severity: "high", urgency: "undetermined", size: "undetermined" });
});

test('score 6 maps to med severity and urgency', () => {
  const input = { score: 6 };
  const result = classify(input);
  assert.deepEqual(result, { severity: "med", urgency: "undetermined", size: "undetermined" });
});

test('score 4 maps to med severity and urgency', () => {
  const input = { score: 4 };
  const result = classify(input);
  assert.deepEqual(result, { severity: "med", urgency: "undetermined", size: "undetermined" });
});

test('score 3 maps to low severity and urgency', () => {
  const input = { score: 3 };
  const result = classify(input);
  assert.deepEqual(result, { severity: "low", urgency: "undetermined", size: "undetermined" });
});

test('score 11 maps to undetermined severity and urgency', () => {
  const input = { score: 11 };
  const result = classify(input);
  assert.deepEqual(result, { severity: 'undetermined', urgency: 'undetermined', size: 'undetermined' });
});

test('score -1 maps to undetermined severity and urgency', () => {
  const input = { score: -1 };
  const result = classify(input);
  assert.deepEqual(result, { severity: 'undetermined', urgency: 'undetermined', size: 'undetermined' });
});

test('explicit severity critical overrides score 3', () => {
  const input = { severity: 'critical', score: 3 };
  const result = classify(input);
  assert.deepEqual(result, { severity: 'crit', urgency: 'crit', size: 'undetermined' });
});

test('explicit urgency high overrides severity low and score 9, size xl maps to XL', () => {
  const input = { urgency: 'high', severity: 'low', score: 9, size: 'xl' };
  const result = classify(input);
  assert.deepEqual(result, { severity: 'low', urgency: 'high', size: 'XL' });
});
