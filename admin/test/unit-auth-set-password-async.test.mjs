// Computes a new password hash and recovery codes for an account (admin/auth.mjs setPasswordAsync).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPasswordAsync } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

function hashPw(password, salt) {
  return scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }).toString('hex');
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'setPasswordAsync-'));
  const storePath = join(dir, 'users.json');
  const lockPath = join(dir, 'users.json.lock');
  process.env.CW_AUTH_STORE = storePath;
  process.env.CW_LOCK_PATH = lockPath;
  return { dir, storePath, lockPath };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('returns invalid credentials when user does not exist', async () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com', salt: 'x'.repeat(32), hash: 'y'.repeat(128) }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'nope@b.com', current: 'correct-password', newPassword: 'new-password-123' });
    assert.deepEqual(result, { ok: false, reason: 'invalid credentials' });
  } finally {
    cleanup(dir);
  }
});

test('returns invalid credentials when current password is wrong', async () => {
  const { dir, storePath } = setup();
  try {
    const salt = 'a'.repeat(32);
    const hash = hashPw('correct-password', salt);
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com', salt, hash }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'a@b.com', current: 'wrong-password', newPassword: 'new-password-123' });
    assert.deepEqual(result, { ok: false, reason: 'invalid credentials' });
  } finally {
    cleanup(dir);
  }
});

test('returns no password set reason when account has no password and not reauthenticated', async () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com' }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'a@b.com', current: 'anything', newPassword: 'new-password-123' });
    assert.deepEqual(result, { ok: false, reason: 'no password is set on this account; re-authenticate with the provider to set one' });
  } finally {
    cleanup(dir);
  }
});

test('returns password too short reason when newPassword is under 12 characters', async () => {
  const { dir, storePath } = setup();
  try {
    const salt = 'a'.repeat(32);
    const hash = hashPw('correct-password', salt);
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com', salt, hash }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'a@b.com', current: 'correct-password', newPassword: 'short' });
    assert.deepEqual(result, { ok: false, reason: 'password must be at least 12 characters' });
  } finally {
    cleanup(dir);
  }
});

test('returns ok with recovery codes when password is successfully changed', async () => {
  const { dir, storePath } = setup();
  try {
    const salt = 'a'.repeat(32);
    const hash = hashPw('correct-password', salt);
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com', salt, hash }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'a@b.com', current: 'correct-password', newPassword: 'new-password-123' });
    assert.equal(result.ok, true);
    assert.equal(result.email, 'a@b.com');
    assert.equal(result.replaced, true);
    assert.equal(result.recovery.length, 8);
    const stored = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(stored.users[0].salt.length, 32);
    assert.equal(stored.users[0].hash.length, 128);
    assert.equal(stored.users[0].recovery.length, 8);
  } finally {
    cleanup(dir);
  }
});

test('returns ok when reauthenticated is true and account has no password', async () => {
  const { dir, storePath } = setup();
  try {
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com' }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'a@b.com', current: '', newPassword: 'new-password-123', reauthenticated: true });
    assert.equal(result.ok, true);
    assert.equal(result.email, 'a@b.com');
    assert.equal(result.replaced, false);
  } finally {
    cleanup(dir);
  }
});

test('returns invalid credentials when stillAuthorized returns false', async () => {
  const { dir, storePath } = setup();
  try {
    const salt = 'a'.repeat(32);
    const hash = hashPw('correct-password', salt);
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com', salt, hash }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'a@b.com', current: 'correct-password', newPassword: 'new-password-123' }, () => false);
    assert.deepEqual(result, { ok: false, reason: 'invalid credentials' });
  } finally {
    cleanup(dir);
  }
});

test('returns ok when store is unchanged between load and lock', async () => {
  const { dir, storePath } = setup();
  try {
    const salt = 'a'.repeat(32);
    const hash = hashPw('correct-password', salt);
    writeFileSync(storePath, JSON.stringify({ users: [{ id: 'u1', email: 'a@b.com', salt, hash }], settings: { allowExternalSso: false } }));
    const result = await setPasswordAsync({ email: 'a@b.com', current: 'correct-password', newPassword: 'new-password-123' }, () => true);
    assert.equal(result.ok, true);
  } finally {
    cleanup(dir);
  }
});
