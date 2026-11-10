// Releases the single-flight lock if the caller matches the holder (bin/lib/single-flight.mjs release).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { release } from '../lib/single-flight.mjs';

const io = {
  read: (p) => p === '/lock' ? '{"pid":1,"pidStart":2}' : '',
  remove: (p) => { io.removed = p; }
};

test('returns false when the holder file is corrupt', () => {
  const bad = { read: () => 'not json', remove: () => {} };
  assert.equal(release('/lock', { pid: 1, pidStart: 2 }, bad), false);
});

test('returns false when the pid does not match the holder', () => {
  const r = release('/lock', { pid: 99, pidStart: 2 }, io);
  assert.equal(r, false);
});

test('returns false when the pidStart does not match the holder', () => {
  const r = release('/lock', { pid: 1, pidStart: 99 }, io);
  assert.equal(r, false);
});

test('returns true and removes the lock when both pid and pidStart match', () => {
  const r = release('/lock', { pid: 1, pidStart: 2 }, io);
  assert.equal(r, true);
});

test('returns false when pid matches but pidStart differs', () => {
  const r = release('/lock', { pid: 1, pidStart: 3 }, io);
  assert.equal(r, false);
});

test('returns false when pidStart matches but pid differs', () => {
  const r = release('/lock', { pid: 5, pidStart: 2 }, io);
  assert.equal(r, false);
});
