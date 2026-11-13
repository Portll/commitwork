// Removes the GitHub binding from a user record and persists the store (admin/auth.mjs unlinkGithub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkGithub } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('removes the github field from a matching user and returns the normalized email', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unlinkGithub-'));
  const storePath = join(dir, 'users.json');
  const prevEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [{ email: 'alice@example.com', github: 'alice-gh' }],
      settings: { allowExternalSso: false }
    }));
    const result = unlinkGithub('alice@example.com');
    assert.deepEqual(result, { email: 'alice@example.com' });
    const saved = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(saved.users[0].github, undefined);
  } finally {
    process.env.CW_AUTH_STORE = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when no account matches the given email', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unlinkGithub-'));
  const storePath = join(dir, 'users.json');
  const prevEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [{ email: 'bob@example.com', github: 'bob-gh' }],
      settings: { allowExternalSso: false }
    }));
    assert.throws(() => unlinkGithub('charlie@example.com'), {
      name: 'Error',
      message: 'no account for charlie@example.com'
    });
  } finally {
    process.env.CW_AUTH_STORE = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizes email case and whitespace before matching', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unlinkGithub-'));
  const storePath = join(dir, 'users.json');
  const prevEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [{ email: 'dave@example.com', github: 'dave-gh' }],
      settings: { allowExternalSso: false }
    }));
    const result = unlinkGithub('  DAVE@EXAMPLE.COM  ');
    assert.deepEqual(result, { email: 'dave@example.com' });
  } finally {
    process.env.CW_AUTH_STORE = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a user with no github field as a no-op unlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unlinkGithub-'));
  const storePath = join(dir, 'users.json');
  const prevEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [{ email: 'eve@example.com' }],
      settings: { allowExternalSso: false }
    }));
    const result = unlinkGithub('eve@example.com');
    assert.deepEqual(result, { email: 'eve@example.com' });
  } finally {
    process.env.CW_AUTH_STORE = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when stored email is not normalized', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unlinkGithub-'));
  const storePath = join(dir, 'users.json');
  const prevEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [{ email: 'Frank@Example.COM', github: 'frank-gh' }],
      settings: { allowExternalSso: false }
    }));
    assert.throws(() => unlinkGithub('frank@example.com'), {
      name: 'Error',
      message: 'no account for frank@example.com'
    });
  } finally {
    process.env.CW_AUTH_STORE = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when users array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unlinkGithub-'));
  const storePath = join(dir, 'users.json');
  const prevEnv = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      users: [],
      settings: { allowExternalSso: false }
    }));
    assert.throws(() => unlinkGithub('anyone@example.com'), {
      name: 'Error',
      message: 'no account for anyone@example.com'
    });
  } finally {
    process.env.CW_AUTH_STORE = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});
