// Computes normalized token usage counts from a message object (bin/lib/turn-recorder-core.mjs stepTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepTokens } from '../lib/turn-recorder-core.mjs';

test('returns null when the message property is missing', () => {
  const r = stepTokens({});
  assert.deepEqual(r, null);
});

test('returns null when usage is null', () => {
  const r = stepTokens({ message: { usage: null } });
  assert.deepEqual(r, null);
});

test('returns null when usage is a string', () => {
  const r = stepTokens({ message: { usage: 'not-an-object' } });
  assert.deepEqual(r, null);
});

test('returns null when usage is a number', () => {
  const r = stepTokens({ message: { usage: 42 } });
  assert.deepEqual(r, null);
});

test('returns null when usage is a boolean', () => {
  const r = stepTokens({ message: { usage: true } });
  assert.deepEqual(r, null);
});

test('returns null when usage is an array', () => {
  const r = stepTokens({ message: { usage: [1, 2, 3] } });
  assert.deepEqual(r, { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null });
});

test('returns null when usage is a function', () => {
  const r = stepTokens({ message: { usage: () => {} } });
  assert.deepEqual(r, null);
});

test('returns null when usage is a symbol', () => {
  const r = stepTokens({ message: { usage: Symbol('x') } });
  assert.deepEqual(r, null);
});

test('returns null when usage is a bigint', () => {
  const r = stepTokens({ message: { usage: 10n } });
  assert.deepEqual(r, null);
});

test('returns normalized token counts for a valid usage object', () => {
  const r = stepTokens({
    message: {
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
        output_tokens_details: { thinking_tokens: 20 },
      },
    },
  });
  assert.deepEqual(r, { input: 100, output: 50, cacheRead: 10, cacheCreation: 5, thinking: 20 });
});
