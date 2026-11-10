// Masks character ranges in source text, preserving newlines (flow/verify.mjs maskFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskFrom } from '../verify.mjs';

test('masks a single span and preserves newlines', () => {
  const r = maskFrom('ab\ncd', [{ innerStart: 1, innerEnd: 3 }]);
  assert.deepEqual(r, { ok: true, error: null, masked: "ax\ncd" });
});

test('rejects overlapping spans', () => {
  const r = maskFrom('abcdef', [{ innerStart: 1, innerEnd: 4 }, { innerStart: 3, innerEnd: 5 }]);
  assert.deepEqual(r, { ok: false, error: "overlapping spans at 3", masked: null });
});

test('rejects inverted span where end equals start', () => {
  const r = maskFrom('abc', [{ innerStart: 1, innerEnd: 1 }]);
  assert.deepEqual(r, { ok: true, error: null, masked: "abc" });
});

test('rejects inverted span where end is less than start', () => {
  const r = maskFrom('abc', [{ innerStart: 2, innerEnd: 1 }]);
  assert.deepEqual(r, { ok: false, error: "inverted span at 2", masked: null });
});

test('masks multiple non-overlapping spans in order', () => {
  const r = maskFrom('abcdef', [{ innerStart: 4, innerEnd: 6 }, { innerStart: 1, innerEnd: 3 }]);
  assert.deepEqual(r, { ok: true, error: null, masked: "axxdxx" });
});

test('returns ok true for valid mask with no length change', () => {
  const r = maskFrom('hello', [{ innerStart: 0, innerEnd: 5 }]);
  assert.deepEqual(r, { ok: true, error: null, masked: "xxxxx" });
});

test('handles empty span list returning original string', () => {
  const r = maskFrom('abc', []);
  assert.deepEqual(r, { ok: true, error: null, masked: "abc" });
});

test('masks span at start of string', () => {
  const r = maskFrom('xyz', [{ innerStart: 0, innerEnd: 2 }]);
  assert.deepEqual(r, { ok: true, error: null, masked: "xxz" });
});
