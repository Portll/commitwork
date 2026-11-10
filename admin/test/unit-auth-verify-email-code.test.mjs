// Verifies a one-time email verification code against the stored hash (admin/auth.mjs verifyEmailCode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEmailCode } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync, createHmac } from 'node:crypto';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'verifyEmailCode-'));
  const storePath = join(dir, 'users.json');
  const lockPath = join(dir, 'lock');
  const lockDir = join(dir, 'locks');
  mkdirSync(lockDir, { recursive: true });
  return { dir, storePath, lockPath, lockDir };
}

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    totpConfirmed: false,
    emailFactor: true,
    ...overrides,
  };
}

function makeCode(expiresAt, attempts, hash) {
  return { expiresAt, attempts, hash };
}

function writeStore(storePath, store) {
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

test('returns invalid credentials when user is null', () => {
  const { dir, storePath } = setup();
  try {
    writeStore(storePath, { users: [], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(null, '123456', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid second factor when emailFactor is false', () => {
  const { dir, storePath } = setup();
  try {
    const u = makeUser({ emailFactor: false });
    writeStore(storePath, { users: [u], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, '123456', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid second factor" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns second factor required when token is empty', () => {
  const { dir, storePath } = setup();
  try {
    const u = makeUser();
    writeStore(storePath, { users: [u], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, '', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns no code waiting when emailCode is missing', () => {
  const { dir, storePath } = setup();
  try {
    const u = makeUser();
    writeStore(storePath, { users: [u], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, '123456', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns expired when nowMs exceeds expiresAt', () => {
  const { dir, storePath } = setup();
  try {
    const u = makeUser({ emailCode: makeCode(500, 0, 'hash') });
    writeStore(storePath, { users: [u], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, '123456', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns expired when attempts reaches max', () => {
  const { dir, storePath } = setup();
  try {
    const u = makeUser({ emailCode: makeCode(2000, 5, 'hash') });
    writeStore(storePath, { users: [u], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, '123456', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid second factor when code does not match', () => {
  const { dir, storePath } = setup();
  try {
    const u = makeUser({ emailCode: makeCode(2000, 0, 'wronghash') });
    writeStore(storePath, { users: [u], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, '123456', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok when code matches and is valid', () => {
  const { dir, storePath } = setup();
  try {
    const code = '123456';
    const salt = Buffer.from('salt1234');
    const hash = scryptSync(code, salt, 32).toString('hex');
    const u = makeUser({ emailCode: makeCode(2000, 0, hash) });
    writeStore(storePath, { users: [u], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, code, { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns invalid credentials when store user does not match snapshot', () => {
  const { dir, storePath } = setup();
  try {
    const u = makeUser({ id: 'user-1', email: 'test@example.com' });
    const storeUser = makeUser({ id: 'user-1', email: 'different@example.com' });
    writeStore(storePath, { users: [storeUser], settings: { allowExternalSso: false } });
    const result = verifyEmailCode(u, '123456', { nowMs: 1000 });
    assert.deepEqual(result, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
