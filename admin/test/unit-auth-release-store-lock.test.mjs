// Releases the auth store lock via forceReleaseLock, mapping its result to a released flag or reason. (admin/auth.mjs releaseStoreLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseStoreLock } from '../auth.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns released true with path when forceReleaseLock succeeds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'users.json');
    const lockPath = `${storePath}.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner'), 'test-owner');
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.deepEqual(r, { released: true, path: lockPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('returns released false with reason when forceReleaseLock fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'users.json');
    const lockPath = `${storePath}.lock`;
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.equal(r.released, false);
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('maps forceReleaseLock reason string exactly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'users.json');
    const lockPath = `${storePath}.lock`;
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.equal(r.released, false);
    assert.ok('reason' in r);
    assert.ok(!('path' in r));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('uses CW_AUTH_STORE env var for lock path resolution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'custom-store.json');
    const lockPath = `${storePath}.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner'), 'test-owner');
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.deepEqual(r, { released: true, path: lockPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('returns released false when lock directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.equal(r.released, false);
    assert.equal(typeof r.reason, 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('lock path is store path plus .lock suffix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'my-store.json');
    const lockPath = `${storePath}.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner'), 'test-owner');
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.equal(r.path, lockPath);
    assert.equal(r.path, `${storePath}.lock`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('released true result contains only released and path keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'users.json');
    const lockPath = `${storePath}.lock`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner'), 'test-owner');
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.deepEqual(Object.keys(r).sort(), ['path', 'released']);
    assert.equal(r.released, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('released false result contains only released and reason keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'releaseStoreLock-'));
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const r = releaseStoreLock();
    assert.deepEqual(Object.keys(r).sort(), ['reason', 'released']);
    assert.equal(r.released, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});
