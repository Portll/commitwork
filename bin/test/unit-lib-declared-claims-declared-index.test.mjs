// Maps claims to a path-indexed list with age and freshness flags (bin/lib/declared-claims.mjs declaredIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredIndex } from '../lib/declared-claims.mjs';

test('returns measured false and empty map when claims is null', () => {
  const r = declaredIndex(null, { now: 1000, stale: 100 });
  assert.deepEqual(r, { measured: false, byPath: new Map([]) });
});

test('returns measured true with empty map when claims is empty array', () => {
  const r = declaredIndex([], { now: 1000, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([]) });
});

test('marks claim fresh when age is zero', () => {
  const claims = [{ path: 'a', claimedAt: '2024-01-01T00:00:00.000Z' }];
  const r = declaredIndex(claims, { now: 1704067200000, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: 0, fresh: true }]]]) });
});

test('marks claim fresh when age equals stale threshold', () => {
  const claims = [{ path: 'a', claimedAt: '2024-01-01T00:00:00.000Z' }];
  const r = declaredIndex(claims, { now: 1704067200100, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: 100, fresh: true }]]]) });
});

test('marks claim not fresh when age exceeds stale threshold', () => {
  const claims = [{ path: 'a', claimedAt: '2024-01-01T00:00:00.000Z' }];
  const r = declaredIndex(claims, { now: 1704067200101, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: 101, fresh: false }]]]) });
});

test('marks claim not fresh when age is negative', () => {
  const claims = [{ path: 'a', claimedAt: '2024-01-01T00:00:00.000Z' }];
  const r = declaredIndex(claims, { now: 1704067199999, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: -1, fresh: false }]]]) });
});

test('marks claim not fresh when claimedAt is invalid date', () => {
  const claims = [{ path: 'a', claimedAt: 'not-a-date' }];
  const r = declaredIndex(claims, { now: 1000, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "not-a-date", ageMs: null, fresh: false }]]]) });
});

test('groups multiple claims under same path in order', () => {
  const claims = [
    { path: 'a', claimedAt: '2024-01-01T00:00:00.000Z' },
    { path: 'b', claimedAt: '2024-01-01T00:00:00.000Z' },
    { path: 'a', claimedAt: '2024-01-01T00:00:00.000Z' }
  ];
  const r = declaredIndex(claims, { now: 1704067200000, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: 0, fresh: true }, { path: "a", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: 0, fresh: true }]], ["b", [{ path: "b", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: 0, fresh: true }]]]) });
});

test('preserves extra claim properties in entries', () => {
  const claims = [{ path: 'a', claimedAt: '2024-01-01T00:00:00.000Z', extra: 'val' }];
  const r = declaredIndex(claims, { now: 1704067200000, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "2024-01-01T00:00:00.000Z", extra: "val", ageMs: 0, fresh: true }]]]) });
});

test('handles single claim with age one less than stale as fresh', () => {
  const claims = [{ path: 'a', claimedAt: '2024-01-01T00:00:00.000Z' }];
  const r = declaredIndex(claims, { now: 1704067200099, stale: 100 });
  assert.deepEqual(r, { measured: true, byPath: new Map([["a", [{ path: "a", claimedAt: "2024-01-01T00:00:00.000Z", ageMs: 99, fresh: true }]]]) });
});
