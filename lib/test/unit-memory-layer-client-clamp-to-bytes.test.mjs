// clampToBytes computes text clamped to max bytes, walking back off continuation bytes (lib/memory-layer-client.mjs clampToBytes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampToBytes } from '../memory-layer-client.mjs';

test('returns unclamped result when text fits within maxBytes', () => {
  const input = 'hello';
  const result = clampToBytes(input, 10);
  assert.deepEqual(result, { text: 'hello', bytes: 5, clamped: false, droppedBytes: 0 });
});

test('returns unclamped result when text length equals maxBytes', () => {
  const input = 'hello';
  const result = clampToBytes(input, 5);
  assert.deepEqual(result, { text: 'hello', bytes: 5, clamped: false, droppedBytes: 0 });
});

test('clamps text exceeding maxBytes and counts dropped bytes', () => {
  const input = 'hello world';
  const result = clampToBytes(input, 5);
  assert.deepEqual(result, { text: 'hello', bytes: 5, clamped: true, droppedBytes: 6 });
});

test('clamps multi-byte UTF-8 text at boundary', () => {
  const input = 'caf\u00e9';
  const result = clampToBytes(input, 5);
  assert.deepEqual(result, { text: "caf\u00e9", bytes: 5, clamped: false, droppedBytes: 0 });
});

test('returns unclamped multi-byte UTF-8 text when within boundary', () => {
  const input = 'caf\u00e9';
  const result = clampToBytes(input, 6);
  assert.deepEqual(result, { text: "caf\u00e9", bytes: 5, clamped: false, droppedBytes: 0 });
});

test('walks back off continuation byte at end of buffer', () => {
  const input = 'hello\xc2\xa0';
  const result = clampToBytes(input, 2);
  assert.deepEqual(result, { text: "he", bytes: 2, clamped: true, droppedBytes: 7 });
});

test('walks back past all continuation bytes when buffer starts with them', () => {
  const input = '\xc2\xa1';
  const result = clampToBytes(input, 0);
  assert.deepEqual(result, { text: "", bytes: 0, clamped: true, droppedBytes: 4 });
});

test('handles combining character sequence at byte boundary', () => {
  const input = 'e\u0301';
  const result = clampToBytes(input, 1);
  assert.deepEqual(result, { text: "e", bytes: 1, clamped: true, droppedBytes: 2 });
});
