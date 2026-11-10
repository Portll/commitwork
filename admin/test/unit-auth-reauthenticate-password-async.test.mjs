// Re-authenticates a user by email and password, verifying the scrypt hash and confirming the account is unchanged (admin/auth.mjs reauthenticatePasswordAsync).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reauthenticatePasswordAsync } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

function makeStore(users) {
  return JSON.stringify({ users, settings: { allowExternalSso: false } });
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }).toString('hex');
}

test('returns false when the store file is absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    const result = await reauthenticatePasswordAsync('user@example.com', 'password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the user email is not found in the store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    const salt = 'a'.repeat(32);
    const hash = hashPassword('password', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'other@example.com', salt, hash }]));
    const result = await reauthenticatePasswordAsync('user@example.com', 'password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the password does not match the stored hash', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    const salt = 'b'.repeat(32);
    const hash = hashPassword('correct-password', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'user@example.com', salt, hash }]));
    const result = await reauthenticatePasswordAsync('user@example.com', 'wrong-password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when the password matches and the account is unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    const salt = 'c'.repeat(32);
    const hash = hashPassword('password', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'user@example.com', salt, hash, totpConfirmed: false, emailFactor: false }]));
    const result = await reauthenticatePasswordAsync('user@example.com', 'password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the user has no salt or hash in the store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    writeFileSync(path, makeStore([{ id: 'u1', email: 'user@example.com' }]));
    const result = await reauthenticatePasswordAsync('user@example.com', 'password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the store file contains invalid JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    writeFileSync(path, 'not valid json');
    const result = await reauthenticatePasswordAsync('user@example.com', 'password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the store has no users array', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    writeFileSync(path, JSON.stringify({ settings: { allowExternalSso: false } }));
    const result = await reauthenticatePasswordAsync('user@example.com', 'password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizes email to lowercase before matching', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePasswordAsync-'));
  try {
    const path = join(dir, 'store.json');
    const salt = 'd'.repeat(32);
    const hash = hashPassword('password', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'user@example.com', salt, hash }]));
    const result = await reauthenticatePasswordAsync('USER@EXAMPLE.COM', 'password', path);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
