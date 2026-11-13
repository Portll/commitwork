// Returns the passkey metadata for a user, or null if the store is unreadable or the user is absent (admin/auth.mjs listPasskeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listPasskeys } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when email is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    process.env.CW_AUTH_STORE = join(dir, 'users.json');
    const result = listPasskeys('');
    assert.deepEqual(result, null);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when email is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    process.env.CW_AUTH_STORE = join(dir, 'users.json');
    const result = listPasskeys(undefined);
    assert.deepEqual(result, null);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when store file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    process.env.CW_AUTH_STORE = join(dir, 'nonexistent.json');
    const result = listPasskeys('alice@example.com');
    assert.deepEqual(result, null);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when store file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    writeFileSync(storePath, 'not valid json');
    const result = listPasskeys('alice@example.com');
    assert.deepEqual(result, null);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when user is not found in store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const store = { version: 1, users: [{ email: 'bob@example.com', passkeys: [] }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    const result = listPasskeys('alice@example.com');
    assert.deepEqual(result, null);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns passkey metadata for a user with passkeys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const pk = { credentialId: 'cred1', label: 'laptop', addedAt: '2024-01-01', lastUsedAt: '2024-02-01', uvAtRegistration: true };
    const store = { version: 1, users: [{ email: 'alice@example.com', passkeys: [pk] }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    const result = listPasskeys('alice@example.com');
    assert.deepEqual(result, [{ credentialId: "cred1", label: "laptop", addedAt: "2024-01-01", lastUsedAt: "2024-02-01", uvAtRegistration: true }]);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when user has no passkeys property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const store = { version: 1, users: [{ email: 'alice@example.com' }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    const result = listPasskeys('alice@example.com');
    assert.deepEqual(result, []);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches user email case-insensitively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const pk = { credentialId: 'cred2', label: 'phone', addedAt: '2024-03-01', lastUsedAt: '2024-03-15', uvAtRegistration: false };
    const store = { version: 1, users: [{ email: 'alice@example.com', passkeys: [pk] }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    const result = listPasskeys('ALICE@EXAMPLE.COM');
    assert.deepEqual(result, [{ credentialId: "cred2", label: "phone", addedAt: "2024-03-01", lastUsedAt: "2024-03-15", uvAtRegistration: false }]);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns correct passkeys when multiple users exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const pk1 = { credentialId: 'cred1', label: 'laptop', addedAt: '2024-01-01', lastUsedAt: '2024-02-01', uvAtRegistration: true };
    const pk2 = { credentialId: 'cred2', label: 'phone', addedAt: '2024-03-01', lastUsedAt: '2024-03-15', uvAtRegistration: false };
    const store = { version: 1, users: [{ email: 'alice@example.com', passkeys: [pk1] }, { email: 'bob@example.com', passkeys: [pk2] }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    const result = listPasskeys('alice@example.com');
    assert.deepEqual(result, [{ credentialId: "cred1", label: "laptop", addedAt: "2024-01-01", lastUsedAt: "2024-02-01", uvAtRegistration: true }]);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('never returns the public key or the signature counter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listPasskeys-'));
  const originalStore = process.env.CW_AUTH_STORE;
  try {
    const storePath = join(dir, 'users.json');
    process.env.CW_AUTH_STORE = storePath;
    const pk = { credentialId: 'cred3', label: 'key', addedAt: '2024-04-01', lastUsedAt: null, uvAtRegistration: true, publicKey: 'pQECAyYgASFYIA', counter: 7 };
    const store = { version: 1, users: [{ email: 'alice@example.com', passkeys: [pk] }], settings: { allowExternalSso: false } };
    writeFileSync(storePath, JSON.stringify(store));
    const [listed] = listPasskeys('alice@example.com');
    assert.deepEqual(Object.keys(listed).sort(), ['addedAt', 'credentialId', 'label', 'lastUsedAt', 'uvAtRegistration']);
  } finally {
    if (originalStore === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = originalStore;
    rmSync(dir, { recursive: true, force: true });
  }
});
