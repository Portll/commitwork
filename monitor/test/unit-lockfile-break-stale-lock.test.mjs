// breakStaleLock removes a lock if it is still the observed one (monitor/lockfile.mjs breakStaleLock)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakStaleLock } from '../lockfile.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns "busy" when the guard cannot be taken because a fresh guard directory already exists', () => {
  const base = mkdtempSync(join(tmpdir(), 'breakStaleLock-'));
  try {
    const lockPath = join(base, 'lock');
    const guard = `${lockPath}.breaking`;
    mkdirSync(guard);
    const result = breakStaleLock(lockPath, null);
    assert.equal(result, "busy");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns "moved" when observed is null (no lock observed) and the lock path does not exist', () => {
  const base = mkdtempSync(join(tmpdir(), 'breakStaleLock-'));
  try {
    const lockPath = join(base, 'nonexistent-lock');
    const result = breakStaleLock(lockPath, null);
    assert.equal(result, "moved");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns "moved" when observed lock differs from the current lock (different nonce)', () => {
  const base = mkdtempSync(join(tmpdir(), 'breakStaleLock-'));
  try {
    const lockPath = join(base, 'lock');
    mkdirSync(lockPath);
    const observed = { owner: { nonce: 'old-nonce' } };
    const result = breakStaleLock(lockPath, observed);
    assert.equal(result, "moved");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns "broken" when the observed lock matches the current lock and removal succeeds', () => {
  const base = mkdtempSync(join(tmpdir(), 'breakStaleLock-'));
  try {
    const lockPath = join(base, 'lock');
    mkdirSync(lockPath);
    const observed = { owner: { nonce: 'same-nonce' } };
    const ownerFile = join(lockPath, 'owner.json');
    writeFileSync(ownerFile, JSON.stringify({ nonce: 'same-nonce' }));
    const result = breakStaleLock(lockPath, observed);
    assert.equal(result, "broken");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
