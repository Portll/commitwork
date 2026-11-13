// findByEmail returns the user with the given email or null (admin/auth.mjs findByEmail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findByEmail } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setupTempStore(storeContent) {
  const dir = mkdtempSync(join(tmpdir(), 'findByEmail-'));
  const storePath = join(dir, 'users.json');
  writeFileSync(storePath, JSON.stringify(storeContent), 'utf8');
  const originalEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  return { dir, originalEnv };
}

function teardownTempStore({ dir, originalEnv }) {
  if (originalEnv === undefined) {
    delete process.env.CW_AUTH_STORE;
  } else {
    process.env.CW_AUTH_STORE = originalEnv;
  }
  rmSync(dir, { recursive: true, force: true });
}

test('returns null when store has no users', () => {
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail('alice@example.com');
    assert.equal(result, null);
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});

test('returns user when email matches exactly', () => {
  const user = { email: 'alice@example.com', name: 'Alice', passkeys: [] };
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [user], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail('alice@example.com');
    assert.deepEqual(result, { email: 'alice@example.com', name: 'Alice', passkeys: [] });
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});

test('returns user when email differs in case', () => {
  const user = { email: 'alice@example.com', name: 'Alice', passkeys: [] };
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [user], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail('ALICE@EXAMPLE.COM');
    assert.deepEqual(result, { email: 'alice@example.com', name: 'Alice', passkeys: [] });
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});

test('returns user when input has surrounding whitespace', () => {
  const user = { email: 'alice@example.com', name: 'Alice', passkeys: [] };
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [user], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail('  alice@example.com  ');
    assert.deepEqual(result, { email: 'alice@example.com', name: 'Alice', passkeys: [] });
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});

test('returns null when no user matches email', () => {
  const user = { email: 'alice@example.com', name: 'Alice', passkeys: [] };
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [user], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail('bob@example.com');
    assert.equal(result, null);
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});

test('returns first matching user when multiple users exist', () => {
  const user1 = { email: 'alice@example.com', name: 'Alice', passkeys: [] };
  const user2 = { email: 'bob@example.com', name: 'Bob', passkeys: [] };
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [user1, user2], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail('bob@example.com');
    assert.deepEqual(result, { email: 'bob@example.com', name: 'Bob', passkeys: [] });
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});

test('throws when store file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findByEmail-'));
  const storePath = join(dir, 'users.json');
  writeFileSync(storePath, 'not json', 'utf8');
  const originalEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    assert.throws(() => findByEmail('alice@example.com'), {
      name: 'Error',
      message: `auth store at ${storePath} is not valid JSON (Unexpected token 'o', "not json" is not valid JSON); refusing to treat it as empty`
    });
  } finally {
    if (originalEnv === undefined) delete process.env.CW_AUTH_STORE;
    else process.env.CW_AUTH_STORE = originalEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when store users is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findByEmail-'));
  const storePath = join(dir, 'users.json');
  writeFileSync(storePath, JSON.stringify({ version: 1, users: 'not-array', settings: { allowExternalSso: false } }), 'utf8');
  const originalEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    assert.throws(() => findByEmail('alice@example.com'), {
      name: 'Error',
      message: `auth store at ${storePath} has no users array; refusing to guess`
    });
  } finally {
    if (originalEnv === undefined) delete process.env.CW_AUTH_STORE;
    else process.env.CW_AUTH_STORE = originalEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when store is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findByEmail-'));
  const storePath = join(dir, 'users.json');
  writeFileSync(storePath, JSON.stringify(['not', 'an', 'object']), 'utf8');
  const originalEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    assert.throws(() => findByEmail('alice@example.com'), {
      name: 'Error',
      message: `auth store at ${storePath} is not an object`
    });
  } finally {
    if (originalEnv === undefined) delete process.env.CW_AUTH_STORE;
    else process.env.CW_AUTH_STORE = originalEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when email is empty string', () => {
  const user = { email: 'alice@example.com', name: 'Alice', passkeys: [] };
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [user], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail('');
    assert.equal(result, null);
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});

test('returns null when email is null', () => {
  const user = { email: 'alice@example.com', name: 'Alice', passkeys: [] };
  const { dir, originalEnv } = setupTempStore({ version: 1, users: [user], settings: { allowExternalSso: false } });
  try {
    const result = findByEmail(null);
    assert.equal(result, null);
  } finally {
    teardownTempStore({ dir, originalEnv });
  }
});
