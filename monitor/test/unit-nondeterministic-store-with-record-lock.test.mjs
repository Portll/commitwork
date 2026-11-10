// Acquires a per-record lock, runs fn, and releases it (monitor/nondeterministic-store.mjs withRecordLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRecordLock } from '../nondeterministic-store.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the value produced by the callback when the lock is acquired', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    const r = withRecordLock(p, () => 42);
    assert.equal(r, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns undefined when the callback returns undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    const r = withRecordLock(p, () => undefined);
    assert.equal(r, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the callback returns null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    const r = withRecordLock(p, () => null);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an object from the callback unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    const obj = { a: 1, b: 'two' };
    const r = withRecordLock(p, () => obj);
    assert.deepEqual(r, { a: 1, b: 'two' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the callback throws an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    assert.throws(() => withRecordLock(p, () => { throw new Error('boom'); }), { name: 'Error', message: 'boom' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a descriptive error without running the callback when the lock is held by another process', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    const lockPath = p + '.lock';
    writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }));
    let calls = 0;
    const fn = () => { calls += 1; return 1; };
    assert.throws(() => withRecordLock(p, fn, { attempts: 1 }), {
      name: 'Error',
      message: `record ${p} is locked by another process (${p}.lock); try again`,
    });
    assert.equal(calls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('releases the lock after the callback completes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    const r1 = withRecordLock(p, () => 'first');
    const r2 = withRecordLock(p, () => 'second');
    assert.deepEqual([r1, r2], ['first', 'second']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('releases the lock after the callback throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'withRecordLock-'));
  try {
    const p = join(dir, 'rec.jsonl');
    writeFileSync(p, '');
    assert.throws(() => withRecordLock(p, () => { throw new Error('x'); }), { name: 'Error', message: 'x' });
    const r = withRecordLock(p, () => 'recovered');
    assert.equal(r, 'recovered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
