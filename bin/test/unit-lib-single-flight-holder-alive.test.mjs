// Determines if a process holder is still alive by checking pid existence and start time (bin/lib/single-flight.mjs holderAlive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holderAlive } from '../lib/single-flight.mjs';

test('returns false when holder is null', () => {
  const io = { exists: () => true, startedAt: () => 100 };
  assert.equal(holderAlive(null, io), false);
});

test('returns false when holder pid is zero', () => {
  const io = { exists: () => true, startedAt: () => 100 };
  assert.equal(holderAlive({ pid: 0, pidStart: 100000 }, io), false);
});

test('returns false when holder pid is negative', () => {
  const io = { exists: () => true, startedAt: () => 100 };
  assert.equal(holderAlive({ pid: -1, pidStart: 100000 }, io), false);
});

test('returns false when process does not exist', () => {
  const io = { exists: () => false, startedAt: () => 100 };
  assert.equal(holderAlive({ pid: 123, pidStart: 100000 }, io), false);
});

test('returns true when process exists but pidStart is not finite', () => {
  const io = { exists: () => true, startedAt: () => 100 };
  assert.equal(holderAlive({ pid: 123, pidStart: NaN }, io), true);
});

test('returns true when process exists and startedAt is null', () => {
  const io = { exists: () => true, startedAt: () => null };
  assert.equal(holderAlive({ pid: 123, pidStart: 100000 }, io), true);
});

test('returns true when start times differ by exactly one second', () => {
  const io = { exists: () => true, startedAt: () => 101 };
  assert.equal(holderAlive({ pid: 123, pidStart: 100000 }, io), true);
});

test('returns false when start times differ by two seconds', () => {
  const io = { exists: () => true, startedAt: () => 102 };
  assert.equal(holderAlive({ pid: 123, pidStart: 100000 }, io), false);
});

test('returns true when start times are identical', () => {
  const io = { exists: () => true, startedAt: () => 100 };
  assert.equal(holderAlive({ pid: 123, pidStart: 100000 }, io), true);
});

test('returns false when holder pid is not an integer', () => {
  const io = { exists: () => true, startedAt: () => 100 };
  assert.equal(holderAlive({ pid: 1.5, pidStart: 100000 }, io), false);
});
