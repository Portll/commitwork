// Computes the authentication factors enrolled for an account (admin/auth.mjs accountFactors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFactors } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when email is falsy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accountFactors-'));
  const storePath = join(dir, 'users.json');
  try {
    const emptyStore = { version: 1, users: [], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(emptyStore));
    process.env.CW_AUTH_STORE = storePath;
    const result = accountFactors('');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('returns null when email is not found in store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accountFactors-'));
  const storePath = join(dir, 'users.json');
  try {
    const store = { version: 1, users: [{ email: 'a@example.com', salt: 's', hash: 'h' }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    process.env.CW_AUTH_STORE = storePath;
    const result = accountFactors('missing@example.com');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('returns null when store file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accountFactors-'));
  const missingPath = join(dir, 'missing.json');
  try {
    process.env.CW_AUTH_STORE = missingPath;
    const result = accountFactors('a@example.com');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('computes factors for a fully enrolled account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accountFactors-'));
  const storePath = join(dir, 'users.json');
  try {
    const store = {
      version: 1,
      users: [{
        email: 'a@example.com',
        salt: 's',
        hash: 'h',
        sso: { provider: 'google' },
        totpSecret: 'secret',
        totpConfirmed: true,
        emailFactor: true,
        passkeys: [{ id: 1 }, { id: 2 }],
        recovery: [{ used: false }, { used: true }, { used: false }]
      }],
      settings: { allowExternalSso: false }
    };
    writeFileSync(storePath, JSON.stringify(store));
    process.env.CW_AUTH_STORE = storePath;
    const result = accountFactors('a@example.com');
    assert.deepEqual(result, {
      hasPassword: true,
      sso: 'google',
      totpEnrolled: true,
      totpConfirmed: true,
      emailFactor: true,
      passkeys: 2,
      recoveryRemaining: 2
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('computes factors for an account with only salt but no hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accountFactors-'));
  const storePath = join(dir, 'users.json');
  try {
    const store = { version: 1, users: [{ email: 'c@example.com', salt: 's' }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    process.env.CW_AUTH_STORE = storePath;
    const result = accountFactors('c@example.com');
    assert.deepEqual(result, {
      hasPassword: false,
      sso: null,
      totpEnrolled: false,
      totpConfirmed: false,
      emailFactor: false,
      passkeys: 0,
      recoveryRemaining: 0
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('computes factors for an account with null passkeys and recovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accountFactors-'));
  const storePath = join(dir, 'users.json');
  try {
    const store = { version: 1, users: [{ email: 'f@example.com', passkeys: null, recovery: null }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    process.env.CW_AUTH_STORE = storePath;
    const result = accountFactors('f@example.com');
    assert.deepEqual(result, {
      hasPassword: false,
      sso: null,
      totpEnrolled: false,
      totpConfirmed: false,
      emailFactor: false,
      passkeys: 0,
      recoveryRemaining: 0
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('computes factors for an account with sso provider as string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accountFactors-'));
  const storePath = join(dir, 'users.json');
  try {
    const store = { version: 1, users: [{ email: 'h@example.com', sso: 'github' }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    process.env.CW_AUTH_STORE = storePath;
    const result = accountFactors('h@example.com');
    assert.deepEqual(result, {
      hasPassword: false,
      sso: 'undefined',
      totpEnrolled: false,
      totpConfirmed: false,
      emailFactor: false,
      passkeys: 0,
      recoveryRemaining: 0
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});
