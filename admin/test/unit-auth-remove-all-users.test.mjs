// Removes all users from the auth store and returns the count removed (admin/auth.mjs removeAllUsers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeAllUsers } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('removes all users from a store with multiple users', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removeAllUsers-'));
  const storeFile = join(dir, 'auth.json');
  process.env.CW_AUTH_STORE = storeFile;
  try {
    writeFileSync(storeFile, JSON.stringify({ version: 1, users: [{}, {}, {}], settings: { allowExternalSso: false } }), { mode: 0o600 });
    const result = removeAllUsers();
    assert.deepEqual(result, { removed: 3 });
    const saved = JSON.parse(readFileSync(storeFile, 'utf8'));
    assert.deepEqual(saved.users, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero when store already has no users', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removeAllUsers-'));
  const storeFile = join(dir, 'auth.json');
  process.env.CW_AUTH_STORE = storeFile;
  try {
    writeFileSync(storeFile, JSON.stringify({ version: 1, users: [], settings: { allowExternalSso: false } }), { mode: 0o600 });
    const result = removeAllUsers();
    assert.deepEqual(result, { removed: 0 });
    const saved = JSON.parse(readFileSync(storeFile, 'utf8'));
    assert.deepEqual(saved.users, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes the single user from a store with one user', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removeAllUsers-'));
  const storeFile = join(dir, 'auth.json');
  process.env.CW_AUTH_STORE = storeFile;
  try {
    writeFileSync(storeFile, JSON.stringify({ version: 1, users: [{}], settings: { allowExternalSso: false } }), { mode: 0o600 });
    const result = removeAllUsers();
    assert.deepEqual(result, { removed: 1 });
    const saved = JSON.parse(readFileSync(storeFile, 'utf8'));
    assert.deepEqual(saved.users, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero when store file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removeAllUsers-'));
  const storeFile = join(dir, 'auth.json');
  process.env.CW_AUTH_STORE = storeFile;
  try {
    const result = removeAllUsers();
    assert.deepEqual(result, { removed: 0 });
    const saved = JSON.parse(readFileSync(storeFile, 'utf8'));
    assert.deepEqual(saved.users, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when store file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removeAllUsers-'));
  const storeFile = join(dir, 'auth.json');
  process.env.CW_AUTH_STORE = storeFile;
  try {
    writeFileSync(storeFile, '{', { mode: 0o600 });
    assert.throws(() => removeAllUsers(), { name: 'Error', message: /is not valid JSON/ });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when store file has no users array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removeAllUsers-'));
  const storeFile = join(dir, 'auth.json');
  process.env.CW_AUTH_STORE = storeFile;
  try {
    writeFileSync(storeFile, JSON.stringify({ version: 1, users: 'not-array', settings: { allowExternalSso: false } }), { mode: 0o600 });
    assert.throws(() => removeAllUsers(), { name: 'Error', message: 'auth store at ' + storeFile + ' has no users array; refusing to guess' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when store file is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'removeAllUsers-'));
  const storeFile = join(dir, 'auth.json');
  process.env.CW_AUTH_STORE = storeFile;
  try {
    writeFileSync(storeFile, JSON.stringify([]), { mode: 0o600 });
    assert.throws(() => removeAllUsers(), { name: 'Error', message: 'auth store at ' + storeFile + ' is not an object' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
