// Resolve a commit SHA prefix to its rewritten full SHA (bin/lib/commit-map.mjs resolveRewritten).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRewritten } from '../lib/commit-map.mjs';

test('returns null when map is null', () => {
  const r = resolveRewritten('abc123', null);
  assert.equal(r, null);
});

test('returns null when sha is empty string', () => {
  const map = new Map([['abc123', 'def456']]);
  const r = resolveRewritten('', map);
  assert.equal(r, null);
});

test('returns exact match when sha is in map', () => {
  const map = new Map([['abc123', 'def456']]);
  const r = resolveRewritten('abc123', map);
  assert.equal(r, "def456");
});

test('returns match for unique prefix', () => {
  const map = new Map([['abc123', 'def456']]);
  const r = resolveRewritten('abc', map);
  assert.equal(r, "def456");
});

test('returns null for ambiguous prefix with different targets', () => {
  const map = new Map([['abc111', 'def111'], ['abc222', 'def222']]);
  const r = resolveRewritten('abc', map);
  assert.equal(r, null);
});

test('returns match when prefix matches multiple entries with same target', () => {
  const map = new Map([['abc111', 'same'], ['abc222', 'same']]);
  const r = resolveRewritten('abc', map);
  assert.equal(r, "same");
});

test('returns null when no prefix matches', () => {
  const map = new Map([['abc123', 'def456']]);
  const r = resolveRewritten('xyz', map);
  assert.equal(r, null);
});

test('normalizes sha by removing non-hex chars and lowercasing', () => {
  const map = new Map([['abc123', 'def456']]);
  const r = resolveRewritten('ABC-123', map);
  assert.equal(r, "def456");
});

test('returns null when sha is undefined', () => {
  const map = new Map([['abc123', 'def456']]);
  const r = resolveRewritten(undefined, map);
  assert.equal(r, null);
});

test('returns null when sha is null', () => {
  const map = new Map([['abc123', 'def456']]);
  const r = resolveRewritten(null, map);
  assert.equal(r, null);
});
