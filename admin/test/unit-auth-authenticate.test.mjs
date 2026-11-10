// Computes whether an email/password (and optional second factor) pair authenticates a stored user (admin/auth.mjs authenticate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

function makeStore(users, settings) {
  return JSON.stringify({ users, settings: settings || { allowExternalSso: false } });
}

function hashPw(password, salt) {
  const dk = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return { salt, hash: dk.toString('hex') };
}

test('returns invalid credentials for unknown email', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', ...hashPw('pw', 's'.repeat(32)) }]));
    const r = authenticate({ email: 'nope@x.com', password: 'pw', token: null });
    assert.deepEqual(r, { ok: false, reason: 'invalid credentials' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns invalid credentials for wrong password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    const h = hashPw('correct', 's'.repeat(32));
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', ...h }]));
    const r = authenticate({ email: 'a@b.com', password: 'wrong', token: null });
    assert.deepEqual(r, { ok: false, reason: 'invalid credentials' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns ok with factor none when no second factor enrolled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    const h = hashPw('pw', 's'.repeat(32));
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', ...h, totpConfirmed: false, emailFactor: false }]));
    const r = authenticate({ email: 'a@b.com', password: 'pw', token: null });
    assert.equal(r.ok, false);
    assert.deepEqual(r.user, undefined);
    assert.equal(r.factor, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns invalid credentials for SSO account with no salt or hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', totpConfirmed: false, emailFactor: false }]));
    const r = authenticate({ email: 'a@b.com', password: 'pw', token: null });
    assert.deepEqual(r, { ok: false, reason: 'invalid credentials' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns invalid second factor when TOTP confirmed but token is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    const h = hashPw('pw', 's'.repeat(32));
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', ...h, totpConfirmed: true, emailFactor: false, totpSecret: 'secret', recovery: [] }]));
    const r = authenticate({ email: 'a@b.com', password: 'pw', token: null });
    assert.deepEqual(r, { ok: false, reason: "invalid credentials" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns invalid credentials when email is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    const h = hashPw('pw', 's'.repeat(32));
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', ...h }]));
    const r = authenticate({ email: '', password: 'pw', token: null });
    assert.deepEqual(r, { ok: false, reason: 'invalid credentials' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('normalizes email to lowercase before matching', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    const h = hashPw('pw', 's'.repeat(32));
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', ...h, totpConfirmed: false, emailFactor: false }]));
    const r = authenticate({ email: '  A@B.COM  ', password: 'pw', token: null });
    assert.equal(r.ok, false);
    assert.deepEqual(r.user, undefined);
    assert.equal(r.factor, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns invalid credentials when password is null for existing user', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authenticate-'));
  try {
    const path = join(dir, 'users.json');
    const h = hashPw('pw', 's'.repeat(32));
    writeFileSync(path, makeStore([{ id: 'u1', email: 'a@b.com', ...h }]));
    const r = authenticate({ email: 'a@b.com', password: null, token: null });
    assert.deepEqual(r, { ok: false, reason: 'invalid credentials' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
