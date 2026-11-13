// removePasskey removes a passkey credential from a user account (admin/auth.mjs removePasskey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removePasskey } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function writeStore(path, store) {
  writeFileSync(path, JSON.stringify(store, null, 2));
}

function readStore(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('returns invalid credentials for unknown user', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskey-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  writeStore(storePath, { users: [], settings: { allowExternalSso: false } });
  try {
    const result = removePasskey({ email: 'unknown@example.com', credentialId: 'cred1', password: 'pass' });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid credentials for known user with wrong password and no reauth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskey-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  const store = {
    users: [{
      id: 'user1',
      email: 'user@example.com',
      salt: 'salt',
      hash: 'hash',
      passkeys: [{ credentialId: 'cred1' }],
      totpConfirmed: false,
      emailFactor: false
    }],
    settings: { allowExternalSso: false }
  };
  writeStore(storePath, store);
  try {
    const result = removePasskey({ email: 'user@example.com', credentialId: 'cred1', password: 'wrong' });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns SSO reauth message for SSO user with no password and wrong password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskey-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  const store = {
    users: [{
      id: 'user2',
      email: 'sso@example.com',
      sso: { provider: 'github' },
      passkeys: [{ credentialId: 'cred1' }],
      totpConfirmed: false,
      emailFactor: false
    }],
    settings: { allowExternalSso: false }
  };
  writeStore(storePath, store);
  try {
    const result = removePasskey({ email: 'sso@example.com', credentialId: 'cred1', password: 'wrong' });
    assert.deepEqual(result, { ok: false, reason: "this account signs in with github and has no password \u2014 re-authenticate with the provider to revoke" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses to remove only passkey when user has no password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskey-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  const store = {
    users: [{
      id: 'user3',
      email: 'nopass@example.com',
      sso: { provider: 'google' },
      passkeys: [{ credentialId: 'onlycred' }],
      totpConfirmed: false,
      emailFactor: false
    }],
    settings: { allowExternalSso: false }
  };
  writeStore(storePath, store);
  try {
    const result = removePasskey({ email: 'nopass@example.com', credentialId: 'onlycred', password: '', reauthenticated: true });
    assert.deepEqual(result, { ok: false, reason: "refusing to remove the only way into this account \u2014 set a password first" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes one passkey when user has two and no password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskey-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  const store = {
    users: [{
      id: 'user4',
      email: 'twopass@example.com',
      sso: { provider: 'microsoft' },
      passkeys: [{ credentialId: 'cred1' }, { credentialId: 'cred2' }],
      totpConfirmed: false,
      emailFactor: false
    }],
    settings: { allowExternalSso: false }
  };
  writeStore(storePath, store);
  try {
    const result = removePasskey({ email: 'twopass@example.com', credentialId: 'cred1', password: '', reauthenticated: true });
    assert.deepEqual(result, { ok: true, remaining: 1 });
    const after = readStore(storePath);
    assert.equal(after.users[0].passkeys.length, 1);
    assert.equal(after.users[0].passkeys[0].credentialId, 'cred2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no such passkey when credentialId not found', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskey-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  const store = {
    users: [{
      id: 'user5',
      email: 'haspass@example.com',
      salt: 'salt',
      hash: 'hash',
      passkeys: [{ credentialId: 'cred1' }],
      totpConfirmed: false,
      emailFactor: false
    }],
    settings: { allowExternalSso: false }
  };
  writeStore(storePath, store);
  try {
    const result = removePasskey({ email: 'haspass@example.com', credentialId: 'missing', password: '', reauthenticated: true });
    assert.deepEqual(result, { ok: false, reason: "no such passkey" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes passkey for user with password when reauthenticated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removePasskey-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  const store = {
    users: [{
      id: 'user6',
      email: 'withpass@example.com',
      salt: 'salt',
      hash: 'hash',
      passkeys: [{ credentialId: 'cred1' }, { credentialId: 'cred2' }],
      totpConfirmed: false,
      emailFactor: false
    }],
    settings: { allowExternalSso: false }
  };
  writeStore(storePath, store);
  try {
    const result = removePasskey({ email: 'withpass@example.com', credentialId: 'cred2', password: 'anything', reauthenticated: true });
    assert.deepEqual(result, { ok: true, remaining: 1 });
    const after = readStore(storePath);
    assert.equal(after.users[0].passkeys.length, 1);
    assert.equal(after.users[0].passkeys[0].credentialId, 'cred1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
