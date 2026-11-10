// Formats a quoted block with truncation (admin/lib/agent-launch.mjs fence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fence } from '../lib/agent-launch.mjs';

test('returns empty fenced block for null input', () => {
  const result = fence('label', null);
  assert.equal(result, "--- BEGIN label (untrusted) ---\n--- END label ---");
});

test('returns empty fenced block for undefined input', () => {
  const result = fence('label', undefined);
  assert.equal(result, "--- BEGIN label (untrusted) ---\n--- END label ---");
});

test('returns fenced block for empty string', () => {
  const result = fence('label', '');
  assert.equal(result, "--- BEGIN label (untrusted) ---\n--- END label ---");
});

test('returns fenced block for short string without truncation', () => {
  const result = fence('label', 'hello');
  assert.equal(result, '--- BEGIN label (untrusted) ---\nhello\n--- END label ---');
});

test('returns fenced block for string exactly at quote cap', () => {
  const text = 'x'.repeat(4000);
  const result = fence('label', text);
  assert.equal(result, '--- BEGIN label (untrusted) ---\n' + text + '\n--- END label ---');
});

test('returns fenced block with truncation for string exceeding quote cap', () => {
  const text = 'x'.repeat(4001);
  const result = fence('label', text);
  const expected = '--- BEGIN label (untrusted) ---\n' + 'x'.repeat(4000) + '\n--- TRUNCATED at 4000 characters ---\n--- END label ---';
  assert.equal(result, expected);
});

test('returns fenced block with truncation for very long string', () => {
  const text = 'y'.repeat(10000);
  const result = fence('label', text);
  const expected = '--- BEGIN label (untrusted) ---\n' + 'y'.repeat(4000) + '\n--- TRUNCATED at 4000 characters ---\n--- END label ---';
  assert.equal(result, expected);
});

test('converts non-string input to string before processing', () => {
  const result = fence('label', 12345);
  assert.equal(result, '--- BEGIN label (untrusted) ---\n12345\n--- END label ---');
});

test('converts object input to string before processing', () => {
  const result = fence('label', { foo: 'bar' });
  assert.equal(result, '--- BEGIN label (untrusted) ---\n[object Object]\n--- END label ---');
});

test('handles boolean input by converting to string', () => {
  const result = fence('label', true);
  assert.equal(result, '--- BEGIN label (untrusted) ---\ntrue\n--- END label ---');
});
