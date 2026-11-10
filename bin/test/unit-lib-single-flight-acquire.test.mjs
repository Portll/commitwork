// Acquires a single-flight lock, stealing it only if the holder is provably dead (bin/lib/single-flight.mjs acquire).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquire } from '../lib/single-flight.mjs';

test('returns ok true and stolen false when writeNew succeeds', () => {
  const io = {
    writeNew: (p, b) => true,
    read: () => '',
    exists: () => false,
    startedAt: () => null,
    remove: () => {}
  };
  const self = { pid: 1, pidStart: 1000 };
  const r = acquire('/lock', self, io);
  assert.deepEqual(r, { ok: true, stolen: false });
});

test('returns ok false with corrupt holder when lock file is unreadable', () => {
  const io = {
    writeNew: (p, b) => false,
    read: () => 'not-json',
    exists: () => false,
    startedAt: () => null,
    remove: () => {}
  };
  const self = { pid: 1, pidStart: 1000 };
  const r = acquire('/lock', self, io);
  assert.deepEqual(r, { ok: false, holder: { corrupt: true }, reason: "lock file is unreadable \u2014 deferring rather than assuming it is free" });
});

test('returns ok false when holder process is alive', () => {
  const io = {
    writeNew: (p, b) => false,
    read: () => JSON.stringify({ pid: 100, pidStart: 1000 }),
    exists: () => true,
    startedAt: () => 1,
    remove: () => {}
  };
  const self = { pid: 1, pidStart: 1000 };
  const r = acquire('/lock', self, io);
  assert.deepEqual(r, { ok: false, holder: { pid: 100, pidStart: 1000 }, reason: "another run holds the lock and its process is alive" });
});

test('returns ok true and stolen true when holder is abandoned and second write succeeds', () => {
  const io = {
    writeNew: (p, b) => (p === '/lock' ? (io._calls = (io._calls || 0) + 1, io._calls === 1 ? false : true) : false),
    read: () => JSON.stringify({ pid: 100, pidStart: 1000 }),
    exists: () => false,
    startedAt: () => null,
    remove: () => {}
  };
  const self = { pid: 1, pidStart: 1000 };
  const r = acquire('/lock', self, io);
  assert.deepEqual(r, { ok: true, stolen: true, holder: { pid: 100, pidStart: 1000 } });
});

test('returns ok false when losing the race after clearing abandoned holder', () => {
  const io = {
    writeNew: (p, b) => false,
    read: () => JSON.stringify({ pid: 100, pidStart: 1000 }),
    exists: () => false,
    startedAt: () => null,
    remove: () => {}
  };
  const self = { pid: 1, pidStart: 1000 };
  const r = acquire('/lock', self, io);
  assert.deepEqual(r, { ok: false, holder: { pid: 100, pidStart: 1000 }, reason: "lost the lock race after clearing an abandoned holder" });
});

test('returns ok false when holder pid is missing or invalid', () => {
  const io = {
    writeNew: (p, b) => false,
    read: () => JSON.stringify({ pid: 0, pidStart: 1000 }),
    exists: () => false,
    startedAt: () => null,
    remove: () => {}
  };
  const self = { pid: 1, pidStart: 1000 };
  const r = acquire('/lock', self, io);
  assert.deepEqual(r, { ok: false, holder: { pid: 0, pidStart: 1000 }, reason: "lost the lock race after clearing an abandoned holder" });
});

test('returns ok true and stolen true when holder pid is recycled with different start time', () => {
  const io = {
    writeNew: (p, b) => (p === '/lock' ? (io._calls = (io._calls || 0) + 1, io._calls === 1 ? false : true) : false),
    read: () => JSON.stringify({ pid: 100, pidStart: 1000 }),
    exists: () => true,
    startedAt: () => 5,
    remove: () => {}
  };
  const self = { pid: 1, pidStart: 1000 };
  const r = acquire('/lock', self, io);
  assert.deepEqual(r, { ok: true, stolen: true, holder: { pid: 100, pidStart: 1000 } });
});
