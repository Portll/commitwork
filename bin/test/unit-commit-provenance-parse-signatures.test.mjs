// Maps git SHAs to their provenance status strings (bin/commit-provenance.mjs parseSignatures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignatures } from '../commit-provenance.mjs';

test('parses a single valid signature line into a map entry', () => {
  const r = parseSignatures('abc123\x1fok');
  assert.deepEqual(r, new Map([["abc123", "ok"]]));
});

test('ignores lines where the sha field is empty', () => {
  const r = parseSignatures('\x1fok');
  assert.deepEqual(r, new Map([]));
});

test('ignores lines where the sha field is only whitespace', () => {
  const r = parseSignatures('   \x1fok');
  assert.deepEqual(r, new Map([]));
});

test('trims whitespace from sha and status fields', () => {
  const r = parseSignatures('  abc  \x1f  ok  ');
  assert.deepEqual(r, new Map([["abc", "ok"]]));
});

test('stores an empty string when the status field is missing', () => {
  const r = parseSignatures('abc\x1f');
  assert.deepEqual(r, new Map([["abc", ""]]));
});

test('stores an empty string when the status field is only whitespace', () => {
  const r = parseSignatures('abc\x1f   ');
  assert.deepEqual(r, new Map([["abc", ""]]));
});

test('parses multiple lines and keeps the last value for duplicate shas', () => {
  const r = parseSignatures('abc\x1fok\nabc\x1frevoked');
  assert.deepEqual(r, new Map([["abc", "revoked"]]));
});

test('returns an empty map for empty input', () => {
  const r = parseSignatures('');
  assert.deepEqual(r, new Map([]));
});
