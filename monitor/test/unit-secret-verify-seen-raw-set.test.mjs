// Collects Raw and RawV2 strings from verified JSON lines (monitor/secret-verify.mjs seenRawSet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seenRawSet } from '../secret-verify.mjs';

test('returns empty set for null input', () => {
  assert.deepEqual(seenRawSet(null), new Set([]));
});

test('returns empty set for empty string input', () => {
  assert.deepEqual(seenRawSet(''), new Set([]));
});

test('returns empty set for non-JSON line', () => {
  assert.deepEqual(seenRawSet('not json'), new Set([]));
});

test('returns empty set for JSON object without Verified property', () => {
  assert.deepEqual(seenRawSet(JSON.stringify({ Raw: 'abc' })), new Set([]));
});

test('returns empty set for JSON null object', () => {
  assert.deepEqual(seenRawSet('null'), new Set([]));
});

test('returns empty set for verified object with empty Raw string', () => {
  assert.deepEqual(seenRawSet(JSON.stringify({ Verified: true, Raw: '' })), new Set([]));
});

test('returns set with Raw value for verified object with non-empty Raw', () => {
  assert.deepEqual(seenRawSet(JSON.stringify({ Verified: true, Raw: 'secret1' })), new Set(["secret1"]));
});

test('returns set with RawV2 value for verified object with non-empty RawV2', () => {
  assert.deepEqual(seenRawSet(JSON.stringify({ Verified: false, RawV2: 'secret2' })), new Set(["secret2"]));
});

test('returns set with both Raw and RawV2 for verified object with both fields', () => {
  assert.deepEqual(seenRawSet(JSON.stringify({ Verified: true, Raw: 'a', RawV2: 'b' })), new Set(["a", "b"]));
});

test('returns empty set for verified object with non-string Raw', () => {
  assert.deepEqual(seenRawSet(JSON.stringify({ Verified: true, Raw: 123 })), new Set([]));
});
