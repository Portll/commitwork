// Classifies a ledger record's tree as mine, other, or unknown (bin/lib/store-paths.mjs treeClaim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeClaim } from '../lib/store-paths.mjs';

test('returns unknown when record is null', () => {
  const r = treeClaim(null);
  assert.equal(r, "unknown");
});

test('returns unknown when record is undefined', () => {
  const r = treeClaim(undefined);
  assert.equal(r, "unknown");
});

test('returns unknown when record has no r property', () => {
  const r = treeClaim({});
  assert.equal(r, "unknown");
});

test('returns unknown when r is empty string', () => {
  const r = treeClaim({ r: '' });
  assert.equal(r, "unknown");
});

test('returns mine when r matches self', () => {
  const r = treeClaim({ r: 'abc123def456' }, 'abc123def456');
  assert.equal(r, "mine");
});

test('returns other when r differs from self', () => {
  const r = treeClaim({ r: 'abc123def456' }, 'xyz789ghi012');
  assert.equal(r, "other");
});

test('returns other when r is a different non-empty string', () => {
  const r = treeClaim({ r: 'a'.repeat(12) }, 'b'.repeat(12));
  assert.equal(r, "other");
});

test('returns mine when r and self are identical long strings', () => {
  const s = 'x'.repeat(12);
  const r = treeClaim({ r: s }, s);
  assert.equal(r, "mine");
});
