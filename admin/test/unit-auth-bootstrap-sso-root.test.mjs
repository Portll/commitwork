// Creates the first SSO-bound operator account when the store is empty (admin/auth.mjs bootstrapSsoRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapSsoRoot } from '../auth.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('creates an SSO account with normalized email and provider', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
    const result = bootstrapSsoRoot({ email: 'Alice@Example.COM', provider: 'google' });
    assert.deepEqual(result, { email: 'alice@example.com', provider: 'google' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('rejects invalid email with specific error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
    assert.throws(() => bootstrapSsoRoot({ email: 'not-an-email', provider: 'google' }), {
      name: 'Error',
      message: 'the provider did not return a usable email address'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('rejects bootstrap when user already exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [{ id: 'existing', email: 'root@example.com' }],
      settings: { allowExternalSso: false }
    }));
    assert.throws(() => bootstrapSsoRoot({ email: 'new@example.com', provider: 'google' }), {
      name: 'Error',
      message: 'bootstrap window is closed: a user already exists'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('defaults provider to unknown when not provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
    const result = bootstrapSsoRoot({ email: 'test@example.com' });
    assert.deepEqual(result, { email: "test@example.com", provider: undefined });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('writes account with totpConfirmed false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
    bootstrapSsoRoot({ email: 'check@example.com', provider: 'github' });
    const written = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(written.users[0].totpConfirmed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('generates 16-character hex id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
    bootstrapSsoRoot({ email: 'idcheck@example.com', provider: 'google' });
    const written = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(written.users[0].id.length, 16);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('stores provider name in sso object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
    bootstrapSsoRoot({ email: 'prov@example.com', provider: 'microsoft' });
    const written = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(written.users[0].sso.provider, 'microsoft');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});

test('normalizes email to lowercase and trims whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrapSsoRoot-'));
  const storePath = join(dir, 'users.json');
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }));
    const result = bootstrapSsoRoot({ email: '  MiXeD@ExAmPle.Com  ', provider: 'google' });
    assert.equal(result.email, 'mixed@example.com');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_AUTH_STORE;
  }
});
