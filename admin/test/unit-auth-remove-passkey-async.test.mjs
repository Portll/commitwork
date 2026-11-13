// Removes a passkey credential from a user's auth store after verifying the caller is authorized (admin/auth.mjs removePasskeyAsync).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };
const SALT = 'x'.repeat(32);
const PASSWORD = 'correct-password';
const HASH = scryptSync(PASSWORD, SALT, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }).toString('hex');

function baseUser(over = {}) {
  return { id: 'u1', email: 'a@b.c', salt: SALT, hash: HASH, totpConfirmed: false, emailFactor: false, passkeys: [], ...over };
}

async function loadRemovePasskeyAsync(storePath) {
  process.env.CW_AUTH_STORE = storePath;
  const mod = await import('../auth.mjs');
  return mod.removePasskeyAsync;
}

test('removes a passkey when the password is correct', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ passkeys: [{ credentialId: 'ck1' }, { credentialId: 'ck2' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'ck1', password: PASSWORD }, () => true);
    assert.deepEqual(result, { ok: true, remaining: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects with invalid credentials when the password is wrong and not reauthenticated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ passkeys: [{ credentialId: 'ck1' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'ck1', password: 'wrong' }, () => true);
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects with invalid credentials when the user does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ passkeys: [{ credentialId: 'ck1' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'nobody@x.y', credentialId: 'ck1', password: PASSWORD }, () => true);
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects removal of the only passkey on a password-less account', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ salt: '', hash: '', passkeys: [{ credentialId: 'ck1' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'ck1', password: PASSWORD, reauthenticated: true }, () => true);
    assert.deepEqual(result, { ok: false, reason: "refusing to remove the only way into this account \u2014 set a password first" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no such passkey when the credentialId is not in the list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ passkeys: [{ credentialId: 'ck1' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'missing', password: PASSWORD }, () => true);
    assert.deepEqual(result, { ok: false, reason: "no such passkey" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects when stillAuthorized returns false and the password was wrong', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ passkeys: [{ credentialId: 'ck1' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'ck1', password: 'wrong', reauthenticated: true }, () => false);
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('allows removal via reauthentication when stillAuthorized is true and password was wrong', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ passkeys: [{ credentialId: 'ck1' }, { credentialId: 'ck2' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'ck1', password: 'wrong', reauthenticated: true }, () => true);
    assert.deepEqual(result, { ok: true, remaining: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns provider-specific message for SSO account with no password when not reauthenticated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [{ ...baseUser({ salt: '', hash: '', sso: { provider: 'google' }, passkeys: [{ credentialId: 'ck1' }] }) }], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'ck1', password: 'wrong' }, () => true);
    assert.deepEqual(result, { ok: false, reason: "this account signs in with google and has no password \u2014 re-authenticate with the provider to revoke" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses default stillAuthorized true when omitted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskeyAsync-'));
  const storePath = join(dir, 'store.json');
  try {
    writeFileSync(storePath, JSON.stringify({ users: [baseUser({ passkeys: [{ credentialId: 'ck1' }, { credentialId: 'ck2' }] })], settings: { allowExternalSso: false } }));
    const removePasskeyAsync = await loadRemovePasskeyAsync(storePath);
    const result = await removePasskeyAsync({ email: 'a@b.c', credentialId: 'ck1', password: 'wrong', reauthenticated: true });
    assert.deepEqual(result, { ok: true, remaining: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
