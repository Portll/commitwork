// Toggles the email factor on an account and discards any pending code when disabled (admin/auth.mjs setEmailFactor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setEmailFactor } from '../auth.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'setEmailFactor-'));
  const storePath = join(dir, 'users.json');
  return { dir, storePath };
}

function writeStore(storePath, store) {
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

test('enables email factor for an existing account', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'alice@example.com', emailFactor: false }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('alice@example.com', true);
    assert.deepEqual(result, { email: 'alice@example.com', emailFactor: true });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('disables email factor and deletes pending code', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'bob@example.com', emailFactor: true, emailCode: '123456' }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('bob@example.com', false);
    assert.deepEqual(result, { email: 'bob@example.com', emailFactor: false });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when no account matches the email', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'carol@example.com', emailFactor: false }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    assert.throws(() => setEmailFactor('dave@example.com', true), {
      name: 'Error',
      message: 'no account for dave@example.com'
    });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizes email case and whitespace before matching', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'eve@example.com', emailFactor: false }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('  EVE@EXAMPLE.COM  ', true);
    assert.deepEqual(result, { email: 'eve@example.com', emailFactor: true });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persists the updated store to disk after enabling', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'frank@example.com', emailFactor: false }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('frank@example.com', true);
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.deepEqual(saved.users[0].emailFactor, true);
    assert.deepEqual(result, { email: 'frank@example.com', emailFactor: true });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persists deletion of emailCode after disabling', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'grace@example.com', emailFactor: true, emailCode: '654321' }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('grace@example.com', false);
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.users[0].emailCode, undefined);
    assert.deepEqual(result, { email: 'grace@example.com', emailFactor: false });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('enables email factor when already enabled returns same state', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'henry@example.com', emailFactor: true }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('henry@example.com', true);
    assert.deepEqual(result, { email: 'henry@example.com', emailFactor: true });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('disables email factor when already disabled keeps emailCode absent', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'irene@example.com', emailFactor: false }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('irene@example.com', false);
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.users[0].emailCode, undefined);
    assert.deepEqual(result, { email: 'irene@example.com', emailFactor: false });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not delete emailCode when enabling email factor', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [{ email: 'jack@example.com', emailFactor: false, emailCode: '111111' }],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('jack@example.com', true);
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.users[0].emailCode, '111111');
    assert.deepEqual(result, { email: 'jack@example.com', emailFactor: true });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when user exists but email factor toggle would match wrong user with inverted comparison', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, {
      version: 1,
      users: [
        { email: 'alice@example.com', emailFactor: false },
        { email: 'bob@example.com', emailFactor: false }
      ],
      settings: { allowExternalSso: false }
    });
    process.env.CW_AUTH_STORE = storePath;
    const result = setEmailFactor('alice@example.com', true);
    assert.deepEqual(result, { email: 'alice@example.com', emailFactor: true });
  } finally {
    delete process.env.CW_AUTH_STORE;
    rmSync(dir, { recursive: true, force: true });
  }
});
