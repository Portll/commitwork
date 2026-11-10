// Confirms a TOTP token for an account and marks it confirmed (admin/auth.mjs confirmTotpAsync).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmTotpAsync } from '../auth.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const TOTP_STEP_S = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

function b32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function totpAt(secretB32, step) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(step, 4);
  const secret = b32Decode(secretB32);
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 10 ** TOTP_DIGITS;
  return String(code).padStart(TOTP_DIGITS, '0');
}

function makeStore(users) {
  return { users, settings: { allowExternalSso: false } };
}

function setupStore(users) {
  const dir = mkdtempSync(join(tmpdir(), 'confirmTotpAsync-'));
  const storePath = join(dir, 'users.json');
  writeFileSync(storePath, JSON.stringify(makeStore(users)));
  return { dir, storePath };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('returns false for unknown email', async () => {
  const { dir, storePath } = setupStore([{ id: 'u1', email: 'a@b.c', salt: 'x'.repeat(32), hash: 'y'.repeat(64), totpSecret: 'JBSWY3DPEHPK3PXP' }]);
  try {
    const result = await confirmTotpAsync('unknown@b.c', 'pw', '123456', storePath);
    assert.equal(result, false);
  } finally {
    cleanup(dir);
  }
});

test('returns false when password does not match', async () => {
  const { dir, storePath } = setupStore([{ id: 'u1', email: 'a@b.c', salt: 'x'.repeat(32), hash: 'y'.repeat(64), totpSecret: 'JBSWY3DPEHPK3PXP' }]);
  try {
    const result = await confirmTotpAsync('a@b.c', 'wrongpw', '123456', storePath);
    assert.equal(result, false);
  } finally {
    cleanup(dir);
  }
});

test('returns false when user has no totpSecret', async () => {
  const { dir, storePath } = setupStore([{ id: 'u1', email: 'a@b.c', salt: 'x'.repeat(32), hash: 'y'.repeat(64) }]);
  try {
    const result = await confirmTotpAsync('a@b.c', 'pw', '123456', storePath);
    assert.equal(result, false);
  } finally {
    cleanup(dir);
  }
});

test('returns false when token has wrong digit count', async () => {
  const { dir, storePath } = setupStore([{ id: 'u1', email: 'a@b.c', salt: 'x'.repeat(32), hash: 'y'.repeat(64), totpSecret: 'JBSWY3DPEHPK3PXP' }]);
  try {
    const result = await confirmTotpAsync('a@b.c', 'pw', '12345', storePath);
    assert.equal(result, false);
  } finally {
    cleanup(dir);
  }
});

test('returns false when token does not match any step in window', async () => {
  const { dir, storePath } = setupStore([{ id: 'u1', email: 'a@b.c', salt: 'x'.repeat(32), hash: 'y'.repeat(64), totpSecret: 'JBSWY3DPEHPK3PXP' }]);
  try {
    const result = await confirmTotpAsync('a@b.c', 'pw', '000000', storePath);
    assert.equal(result, false);
  } finally {
    cleanup(dir);
  }
});

test('returns false when step is not newer than lastTotpStep', async () => {
  const { dir, storePath } = setupStore([{ id: 'u1', email: 'a@b.c', salt: 'x'.repeat(32), hash: 'y'.repeat(64), totpSecret: 'JBSWY3DPEHPK3PXP', lastTotpStep: 999999999 }]);
  try {
    const result = await confirmTotpAsync('a@b.c', 'pw', '123456', storePath);
    assert.equal(result, false);
  } finally {
    cleanup(dir);
  }
});
