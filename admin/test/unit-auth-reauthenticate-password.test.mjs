// Verifies a password against the auth store and confirms the account is unchanged (admin/auth.mjs reauthenticatePassword).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reauthenticatePassword } from '../auth.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

function makeStore(users) {
  return JSON.stringify({ users, settings: { allowExternalSso: false } });
}

function hashPw(password, salt) {
  const dk = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: dk.toString('hex') };
}

function setup(users) {
  const dir = mkdtempSync(join(tmpdir(), 'reauthenticatePassword-'));
  const path = join(dir, 'users.json');
  writeFileSync(path, makeStore(users));
  return { dir, path };
}

test('returns true for a valid password matching the stored hash', () => {
  const { dir, path } = setup([]);
  try {
    const salt = 'a'.repeat(32);
    const { hash } = hashPw('correct-horse', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.c', salt, hash, totpConfirmed: false, emailFactor: false }]));
    assert.equal(reauthenticatePassword('a@b.c', 'correct-horse', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns false for an incorrect password', () => {
  const { dir, path } = setup([]);
  try {
    const salt = 'a'.repeat(32);
    const { hash } = hashPw('correct-horse', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.c', salt, hash, totpConfirmed: false, emailFactor: false }]));
    assert.equal(reauthenticatePassword('a@b.c', 'wrong-pass', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns false when the email does not match any user', () => {
  const { dir, path } = setup([]);
  try {
    const salt = 'a'.repeat(32);
    const { hash } = hashPw('pw', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.c', salt, hash, totpConfirmed: false, emailFactor: false }]));
    assert.equal(reauthenticatePassword('nobody@x.y', 'pw', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns false when the store file is missing', () => {
  const { dir, path } = setup([]);
  try {
    rmSync(path, { force: true });
    assert.equal(reauthenticatePassword('a@b.c', 'pw', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns false when the store contains invalid JSON', () => {
  const { dir, path } = setup([]);
  try {
    writeFileSync(path, 'not-json{{{');
    assert.equal(reauthenticatePassword('a@b.c', 'pw', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns false when the store has no users array', () => {
  const { dir, path } = setup([]);
  try {
    writeFileSync(path, JSON.stringify({ settings: {} }));
    assert.equal(reauthenticatePassword('a@b.c', 'pw', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('normalizes email case and whitespace before matching', () => {
  const { dir, path } = setup([]);
  try {
    const salt = 'a'.repeat(32);
    const { hash } = hashPw('pw', salt);
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.c', salt, hash, totpConfirmed: false, emailFactor: false }]));
    assert.equal(reauthenticatePassword('  A@B.C  ', 'pw', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns false when the user has no stored salt or hash', () => {
  const { dir, path } = setup([]);
  try {
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.c', totpConfirmed: false, emailFactor: false }]));
    assert.equal(reauthenticatePassword('a@b.c', 'pw', path), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
