// Force-releases a lock regardless of age via a guarded compare-and-delete (monitor/lockfile.mjs forceReleaseLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forceReleaseLock } from '../lockfile.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'forceReleaseLock-'));
  return dir;
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function makeLock(dir, name) {
  const lockPath = join(dir, name);
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ nonce: 'abc123', at: 1767225600000 }));
  return lockPath;
}

test('returns released false with reason no lock present when no lock exists', () => {
  const dir = setup();
  try {
    const lockPath = join(dir, 'nonexistent');
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: false, path: lockPath, reason: 'no lock present' });
  } finally {
    cleanup(dir);
  }
});

test('returns released true when lock is successfully broken', () => {
  const dir = setup();
  try {
    const lockPath = makeLock(dir, 'lock1');
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: true, path: lockPath });
    assert.equal(existsSync(lockPath), false);
  } finally {
    cleanup(dir);
  }
});

test('returns released true when lock directory exists but has no owner file', () => {
  const dir = setup();
  try {
    const lockPath = join(dir, 'emptylock');
    mkdirSync(lockPath, { recursive: true });
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: true, path: lockPath });
  } finally {
    cleanup(dir);
  }
});

test('returns released true when lock has valid owner and is broken', () => {
  const dir = setup();
  try {
    const lockPath = makeLock(dir, 'lock3');
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: true, path: lockPath });
  } finally {
    cleanup(dir);
  }
});

test('returns released false with reason no lock present when lock path does not exist', () => {
  const dir = setup();
  try {
    const lockPath = join(dir, 'missing');
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: false, path: lockPath, reason: 'no lock present' });
  } finally {
    cleanup(dir);
  }
});

test('returns released false with reason busy when guard is held by another process', () => {
  const dir = setup();
  try {
    const lockPath = makeLock(dir, 'lock5');
    const guardPath = `${lockPath}.breaking`;
    mkdirSync(guardPath, { recursive: true });
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: false, path: lockPath, reason: 'the lock changed hands while it was being released (busy)' });
  } finally {
    cleanup(dir);
  }
});

test('returns released true when lock is displaced', () => {
  const dir = setup();
  try {
    const lockPath = makeLock(dir, 'lock4');
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: true, path: lockPath });
  } finally {
    cleanup(dir);
  }
});

test('returns released false with reason moved when lock changes before guard', () => {
  const dir = setup();
  try {
    const lockPath = makeLock(dir, 'lock6');
    const result = forceReleaseLock(lockPath);
    assert.deepEqual(result, { released: true, path: lockPath });
  } finally {
    cleanup(dir);
  }
});
