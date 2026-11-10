// Normalizes override objects into sorted-key plain objects or null (admin/routes/perf.mjs normalizeOverridesForStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOverridesForStore } from '../routes/perf.mjs';

test('returns null for undefined input', () => {
  assert.strictEqual(normalizeOverridesForStore(undefined), null);
});

test('returns null for null input', () => {
  assert.strictEqual(normalizeOverridesForStore(null), null);
});

test('returns null for non-object primitives', () => {
  assert.strictEqual(normalizeOverridesForStore(0), null);
  assert.strictEqual(normalizeOverridesForStore(1), null);
  assert.strictEqual(normalizeOverridesForStore(''), null);
  assert.strictEqual(normalizeOverridesForStore('a'), null);
  assert.strictEqual(normalizeOverridesForStore(true), null);
  assert.strictEqual(normalizeOverridesForStore(false), null);
  assert.strictEqual(normalizeOverridesForStore(Symbol('x')), null);
  assert.strictEqual(normalizeOverridesForStore(() => {}), null);
});

test('returns null for arrays', () => {
  assert.strictEqual(normalizeOverridesForStore([]), null);
  assert.strictEqual(normalizeOverridesForStore([1, 2, 3]), null);
  assert.strictEqual(normalizeOverridesForStore(['a', 'b']), null);
});

test('returns null for empty object', () => {
  assert.strictEqual(normalizeOverridesForStore({}), null);
});

test('returns object with single key unchanged', () => {
  const input = { alpha: 1 };
  const result = normalizeOverridesForStore(input);
  assert.deepStrictEqual(result, { alpha: 1 });
  assert.notStrictEqual(result, input);
});

test('sorts keys alphabetically in output', () => {
  const input = { zeta: 1, alpha: 2, mid: 3 };
  const result = normalizeOverridesForStore(input);
  assert.deepStrictEqual(result, { alpha: 2, mid: 3, zeta: 1 });
  assert.deepStrictEqual(Object.keys(result), ['alpha', 'mid', 'zeta']);
});

test('preserves all values including falsy ones', () => {
  const input = { b: 0, a: false, c: null, d: '', e: undefined };
  const result = normalizeOverridesForStore(input);
  assert.deepStrictEqual(result, { a: false, b: 0, c: null, d: '', e: undefined });
  assert.deepStrictEqual(Object.keys(result), ['a', 'b', 'c', 'd', 'e']);
});

test('handles object with many keys by sorting them', () => {
  const n = 100;
  const input = {};
  for (let i = 0; i < n; i++) {
    input['key' + String(i).padStart(3, '0')] = i;
  }
  const result = normalizeOverridesForStore(input);
  const keys = Object.keys(result);
  assert.strictEqual(keys.length, n);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(keys[i], 'key' + String(i).padStart(3, '0'));
    assert.strictEqual(result[keys[i]], i);
  }
});

test('returns new object not same reference as input', () => {
  const input = { x: 1, y: 2 };
  const result = normalizeOverridesForStore(input);
  assert.notStrictEqual(result, input);
  assert.deepStrictEqual(result, { x: 1, y: 2 });
});
