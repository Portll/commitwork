// Collects Raw and RawV2 values from verified JSON lines in stdout (monitor/secret-verify.mjs verifiedRawSet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedRawSet } from '../secret-verify.mjs';

test('returns empty set for null input', () => {
  assert.deepEqual(verifiedRawSet(null), new Set([]));
});

test('returns empty set for empty string input', () => {
  assert.deepEqual(verifiedRawSet(''), new Set([]));
});

test('returns empty set for non-JSON banner lines', () => {
  assert.deepEqual(verifiedRawSet('scanning...\nstill scanning'), new Set([]));
});

test('returns empty set when Verified is false', () => {
  assert.deepEqual(verifiedRawSet(JSON.stringify({ Verified: false, Raw: 'abc' })), new Set([]));
});

test('returns empty set when Verified is missing', () => {
  assert.deepEqual(verifiedRawSet(JSON.stringify({ Raw: 'abc' })), new Set([]));
});

test('returns empty set when Raw is empty string', () => {
  assert.deepEqual(verifiedRawSet(JSON.stringify({ Verified: true, Raw: '' })), new Set([]));
});

test('returns empty set when Raw is not a string', () => {
  assert.deepEqual(verifiedRawSet(JSON.stringify({ Verified: true, Raw: 123 })), new Set([]));
});

test('collects Raw value when Verified is true', () => {
  assert.deepEqual(verifiedRawSet(JSON.stringify({ Verified: true, Raw: 'secret1' })), new Set(["secret1"]));
});

test('collects RawV2 value when Verified is true', () => {
  assert.deepEqual(verifiedRawSet(JSON.stringify({ Verified: true, RawV2: 'secret2' })), new Set(["secret2"]));
});

test('collects both Raw and RawV2 values from multiple lines', () => {
  const lines = [
    JSON.stringify({ Verified: true, Raw: 'a' }),
    'banner line',
    JSON.stringify({ Verified: true, RawV2: 'b' }),
    JSON.stringify({ Verified: false, Raw: 'c' })
  ].join('\n');
  assert.deepEqual(verifiedRawSet(lines), new Set(["a", "b"]));
});
