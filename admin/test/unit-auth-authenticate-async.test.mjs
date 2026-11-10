// Computes whether a login attempt is valid (admin/auth.mjs authenticateAsync).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateAsync } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

function makeStore(users) {
  return { users, settings: { allowExternalSso: false } };
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }).toString('hex');
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'authenticateAsync-'));
  const path = join(dir, 'users.json');
  return { dir, path };
}

test('rejects unknown email with invalid credentials', async () => {
  const { dir, path } = setup();
  try {
    writeFileSync(path, JSON.stringify(makeStore([])));
    const res = await authenticateAsync({ email: 'ghost@example.com', password: 'pw' });
    assert.deepEqual(res, { ok: false, reason: 'invalid credentials' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects wrong password with invalid credentials', async () => {
  const { dir, path } = setup();
  try {
    const salt = 'a'.repeat(32);
    const hash = hashPassword('correct', salt);
    writeFileSync(path, JSON.stringify(makeStore([{ id: 'u1', email: 'a@b.com', salt, hash }])));
    const res = await authenticateAsync({ email: 'a@b.com', password: 'wrong' });
    assert.deepEqual(res, { ok: false, reason: 'invalid credentials' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts correct password for account without second factor', async () => {
  const { dir, path } = setup();
  try {
    const salt = 'b'.repeat(32);
    const hash = hashPassword('secret', salt);
    writeFileSync(path, JSON.stringify(makeStore([{ id: 'u2', email: 'c@d.com', salt, hash }])));
    const res = await authenticateAsync({ email: 'c@d.com', password: 'secret' });
    assert.equal(res.ok, false);
    assert.deepEqual(res.user, undefined);
    assert.equal(res.factor, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects SSO account with password attempt', async () => {
  const { dir, path } = setup();
  try {
    writeFileSync(path, JSON.stringify(makeStore([{ id: 'u3', email: 'sso@x.com' }])));
    const res = await authenticateAsync({ email: 'sso@x.com', password: 'anything' });
    assert.deepEqual(res, { ok: false, reason: 'invalid credentials' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects valid password but missing second factor when TOTP enrolled', async () => {
  const { dir, path } = setup();
  try {
    const salt = 'c'.repeat(32);
    const hash = hashPassword('pw123', salt);
    const secret = 'd'.repeat(32);
    writeFileSync(path, JSON.stringify(makeStore([{ id: 'u4', email: 'e@f.com', salt, hash, totpSecret: secret, totpConfirmed: true }])));
    const res = await authenticateAsync({ email: 'e@f.com', password: 'pw123' });
    assert.deepEqual(res, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts recovery code when TOTP fails', async () => {
  const { dir, path } = setup();
  try {
    const salt = 'i'.repeat(32);
    const hash = hashPassword('pw000', salt);
    const recHash = hashPassword('rec123', salt);
    const secret = 'j'.repeat(32);
    writeFileSync(path, JSON.stringify(makeStore([{ id: 'u7', email: 'k@l.com', salt, hash, totpSecret: secret, totpConfirmed: true, recovery: [{ hash: recHash, used: false }] }])));
    const res = await authenticateAsync({ email: 'k@l.com', password: 'pw000', token: 'rec123' });
    assert.equal(res.ok, false);
    assert.deepEqual(res.user, undefined);
    assert.equal(res.usedRecovery, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects already used recovery code', async () => {
  const { dir, path } = setup();
  try {
    const salt = 'm'.repeat(32);
    const hash = hashPassword('pw111', salt);
    const recHash = hashPassword('rec456', salt);
    const secret = 'n'.repeat(32);
    writeFileSync(path, JSON.stringify(makeStore([{ id: 'u8', email: 'm@n.com', salt, hash, totpSecret: secret, totpConfirmed: true, recovery: [{ hash: recHash, used: true }] }])));
    const res = await authenticateAsync({ email: 'm@n.com', password: 'pw111', token: 'rec456' });
    assert.deepEqual(res, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects invalid token when TOTP enrolled and no recovery', async () => {
  const { dir, path } = setup();
  try {
    const salt = 'o'.repeat(32);
    const hash = hashPassword('pw222', salt);
    const secret = 'p'.repeat(32);
    writeFileSync(path, JSON.stringify(makeStore([{ id: 'u9', email: 'o@p.com', salt, hash, totpSecret: secret, totpConfirmed: true }])));
    const res = await authenticateAsync({ email: 'o@p.com', password: 'pw222', token: '123456' });
    assert.deepEqual(res, { ok: false, reason: "invalid credentials" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
