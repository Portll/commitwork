// Human-readable summary of a durable-write receipt (lib/durable-write.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../durable-write.mjs';

test('returns a fixed message when the receipt is null', () => {
  assert.equal(summarise(null), "no receipt \u2014 the write was never attempted, which is not a success");
});

test('returns a fixed message when the receipt is undefined', () => {
  assert.equal(summarise(undefined), "no receipt \u2014 the write was never attempted, which is not a success");
});

test('summarises a written receipt with all guarantees held and readback verified', () => {
  const r = {
    state: 'written',
    bytes: 128,
    path: '/tmp/a.txt',
    guarantees: { atomicRename: true, fileDurable: true, dirDurable: true },
    durability: { readback: 'held' },
    preflight: { state: 'ok' },
    tmp: { cleaned: true },
    notes: []
  };
  assert.equal(summarise(r), "wrote 128 bytes to /tmp/a.txt; atomic:yes; file-fsync:yes; dir-fsync:yes; readback:verified");
});

test('summarises a written receipt with guarantees false and readback not verified', () => {
  const r = {
    state: 'written',
    bytes: 64,
    path: '/tmp/b.txt',
    guarantees: { atomicRename: false, fileDurable: false, dirDurable: false },
    durability: { readback: 'failed' },
    preflight: { state: 'insufficient' },
    tmp: { cleaned: false, cleanupReason: 'disk full' },
    notes: ['note1']
  };
  assert.equal(summarise(r), "wrote 64 bytes to /tmp/b.txt; atomic:NO; file-fsync:NO; dir-fsync:NO; readback:NOT VERIFIED; TEMP FILE NOT REMOVED: disk full; note1");
});

test('summarises a written receipt with missing guarantee fields and unknown preflight', () => {
  const r = {
    state: 'written',
    bytes: 10,
    path: '/tmp/c.txt',
    guarantees: {},
    durability: null,
    preflight: { state: 'unknown' },
    tmp: null,
    notes: []
  };
  assert.equal(summarise(r), "wrote 10 bytes to /tmp/c.txt; atomic:unknown; file-fsync:unknown; dir-fsync:unknown; readback:NOT VERIFIED; free space was undetermined at preflight");
});

test('summarises a refused receipt', () => {
  const r = {
    state: 'refused',
    class: 'space',
    reason: 'not enough space',
    tmp: null,
    notes: []
  };
  assert.equal(summarise(r), "REFUSED (space) \u2014 nothing was written and nothing was damaged: not enough space");
});

test('summarises a failed receipt with partial write started', () => {
  const r = {
    state: 'failed',
    class: 'io',
    errno: 28,
    reason: 'no space left',
    partial: { started: true, bytesWritten: 512 },
    tmp: { cleaned: false, cleanupReason: 'crash' },
    notes: ['degraded']
  };
  assert.equal(summarise(r), "FAILED (io/28): no space left; 512 bytes had already been written \u2014 a write error never means nothing was written; TEMP FILE NOT REMOVED: crash; degraded");
});

test('summarises a failed receipt with no partial write', () => {
  const r = {
    state: 'failed',
    class: 'perm',
    reason: 'permission denied',
    partial: null,
    tmp: null,
    notes: []
  };
  assert.equal(summarise(r), "FAILED (perm): permission denied");
});
