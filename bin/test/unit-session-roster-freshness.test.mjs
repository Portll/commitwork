// Computes whether a roster row is live, stale, or unverifiable (bin/session-roster.mjs freshness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshness } from '../session-roster.mjs';

test('a live socket with a matching tree and fresh date is live', () => {
  const row = { pid: 1, tree: 'self', at: '2024-01-01T00:00:00Z' };
  const r = freshness(row, { now: 1704067200000, self: 'self', live: new Set(['1']), stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "live", reasons: ["socket-live"] });
});

test('a dead socket is stale even if the tree matches and the date is fresh', () => {
  const row = { pid: 1, tree: 'self', at: '2024-01-01T00:00:00Z' };
  const r = freshness(row, { now: 1704067200000, self: 'self', live: new Set(['2']), stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "stale", reasons: ["socket-gone"] });
});

test('a foreign tree makes the row stale even with a live socket', () => {
  const row = { pid: 1, tree: 'other', at: '2024-01-01T00:00:00Z' };
  const r = freshness(row, { now: 1704067200000, self: 'self', live: new Set(['1']), stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "live", reasons: ["socket-live", "foreign-tree"] });
});

test('an aged date makes the row stale even with a live socket and matching tree', () => {
  const row = { pid: 1, tree: 'self', at: '2023-01-01T00:00:00Z' };
  const r = freshness(row, { now: 1704067200000, self: 'self', live: new Set(['1']), stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "live", reasons: ["socket-live", "aged"] });
});

test('a missing date makes the row unverifiable when liveness is unmeasured', () => {
  const row = { pid: 1, tree: 'self' };
  const r = freshness(row, { now: 1704067200000, self: 'self', live: null, stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "unverifiable", reasons: ["liveness-unmeasured", "undated"] });
});

test('a row with no pid and no date is unverifiable', () => {
  const row = {};
  const r = freshness(row, { now: 1704067200000, self: 'self', live: null, stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "unverifiable", reasons: ["undated"] });
});

test('a date exactly at the stale boundary is not aged', () => {
  const row = { pid: 1, tree: 'self', at: '2023-12-31T12:00:00Z' };
  const r = freshness(row, { now: 1704067200000, self: 'self', live: new Set(['1']), stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "live", reasons: ["socket-live"] });
});

test('a date one millisecond past the stale boundary is aged', () => {
  const row = { pid: 1, tree: 'self', at: '2023-12-31T11:59:59.999Z' };
  const r = freshness(row, { now: 1704067200000, self: 'self', live: new Set(['1']), stale: 12 * 60 * 60 * 1000 });
  assert.deepEqual(r, { verdict: "live", reasons: ["socket-live", "aged"] });
});
