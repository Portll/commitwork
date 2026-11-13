// Verifies a second factor (TOTP, recovery code, or email code) for a user (admin/auth.mjs verifySecondFactor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapRoot, issueEmailCode, loadStore, verifySecondFactor } from '../auth.mjs';

// RFC 6238 appendix B: SHA-1 seed "12345678901234567890"; a 6-digit code is the last six of the 8-digit vector.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_SEED = Buffer.from('12345678901234567890');
const NOW_MS = 1111111109 * 1000;
const COUNTER = 37037036;
const LIMIT = { timeout: 30_000 };

function hotp(counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', RFC_SEED).update(msg).digest();
  return String((mac.readUInt32BE(mac[19] & 15) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const TOTP_USER = { id: 'u1', email: 'op@example.invalid', salt: 'fixture-salt', hash: 'fixture-hash', totpSecret: RFC_SECRET, totpConfirmed: true, recovery: [] };
const EMAIL_USER = { id: 'u2', email: 'mail@example.invalid', salt: 'fixture-salt', hash: 'fixture-hash', totpConfirmed: false, emailFactor: true };

// The lock spins on Date.now(), so a frozen clock is safe only because every store, and so every lock, is private to one test.
function authStore(t, users = null) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-second-factor-'));
  const path = join(dir, 'users.json');
  const saved = process.env.CW_AUTH_STORE;
  t.after(() => {
    if (saved === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.CW_AUTH_STORE = path;
  t.mock.timers.enable({ apis: ['Date'], now: NOW_MS });
  if (users) writeFileSync(path, JSON.stringify({ version: 1, users, settings: { allowExternalSso: false } }));
  const user = (id) => loadStore(path).users.find((u) => u.id === id);
  return { path, user };
}

function bootstrapped(t) {
  const s = authStore(t);
  const { recovery } = bootstrapRoot({ email: 'root@example.invalid', password: 'fixture-password-0123' });
  const store = JSON.parse(readFileSync(s.path, 'utf8'));
  store.users[0].totpConfirmed = true;
  writeFileSync(s.path, JSON.stringify(store));
  return { ...s, recovery, id: store.users[0].id };
}

test('the reference TOTP in this file reproduces the RFC 6238 vectors', () => {
  assert.equal(hotp(1), '287082');
  assert.equal(hotp(COUNTER), '081804');
  assert.equal(hotp(COUNTER + 1), '050471');
});

test('no user is invalid credentials', LIMIT, (t) => {
  const { path } = authStore(t);
  assert.deepEqual(verifySecondFactor(null, hotp(COUNTER)), { ok: false, reason: 'invalid credentials' });
  assert.equal(existsSync(path), false);
});

test('with nothing enrolled the factor is none and the store is not touched', LIMIT, (t) => {
  const { path } = authStore(t);
  const u = { id: 'u0', email: 'none@example.invalid', totpConfirmed: false, emailFactor: false };
  assert.deepEqual(verifySecondFactor(u, 'anything'), { ok: true, user: { id: 'u0', email: 'none@example.invalid' }, factor: 'none' });
  assert.equal(existsSync(path), false);
});

test('a current TOTP code is accepted and its step is recorded', LIMIT, (t) => {
  const { user } = authStore(t, [TOTP_USER]);
  assert.deepEqual(verifySecondFactor(user('u1'), '081804'), { ok: true, user: { id: 'u1', email: 'op@example.invalid' } });
  assert.equal(user('u1').lastTotpStep, COUNTER);
});

test('codes one step either side are accepted and two steps out are refused', LIMIT, async (t) => {
  for (const [offset, ok] of [[-2, false], [-1, true], [1, true], [2, false]]) {
    await t.test(`step ${offset}`, (st) => {
      const { user } = authStore(st, [TOTP_USER]);
      const result = verifySecondFactor(user('u1'), hotp(COUNTER + offset));
      assert.equal(result.ok, ok);
      assert.equal(user('u1').lastTotpStep, ok ? COUNTER + offset : undefined);
      if (!ok) assert.deepEqual(result, { ok: false, reason: 'invalid second factor' });
    });
  }
});

test('a TOTP code works once, and a step older than the last one used is refused', LIMIT, (t) => {
  const { user } = authStore(t, [TOTP_USER]);
  assert.equal(verifySecondFactor(user('u1'), hotp(COUNTER)).ok, true);
  assert.deepEqual(verifySecondFactor(user('u1'), hotp(COUNTER)), { ok: false, reason: 'invalid second factor' });
  assert.deepEqual(verifySecondFactor(user('u1'), hotp(COUNTER - 1)), { ok: false, reason: 'invalid second factor' });
  assert.equal(verifySecondFactor(user('u1'), hotp(COUNTER + 1)).ok, true);
  assert.equal(user('u1').lastTotpStep, COUNTER + 1);
});

test('a wrong code with no recovery or email factor is refused and nothing is written', LIMIT, (t) => {
  const { path, user } = authStore(t, [TOTP_USER]);
  const before = readFileSync(path, 'utf8');
  assert.deepEqual(verifySecondFactor(user('u1'), '000000'), { ok: false, reason: 'invalid second factor' });
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('a snapshot whose TOTP secret no longer matches the store is invalid credentials and burns nothing', LIMIT, (t) => {
  const { user } = authStore(t, [{ ...TOTP_USER, totpSecret: 'JBSWY3DPEHPK3PXP' }]);
  assert.deepEqual(verifySecondFactor({ ...user('u1'), totpSecret: RFC_SECRET }, hotp(COUNTER)), { ok: false, reason: 'invalid credentials' });
  assert.equal(user('u1').lastTotpStep, undefined);
});

test('a recovery code is accepted once, burns only itself, and is refused the second time', LIMIT, (t) => {
  const { recovery, id, user } = bootstrapped(t);
  const first = verifySecondFactor(user(id), recovery[3]);
  assert.deepEqual(first, { ok: true, user: { id, email: 'root@example.invalid' }, usedRecovery: true });
  assert.deepEqual(user(id).recovery.map((r) => r.used), [false, false, false, true, false, false, false, false]);
  assert.deepEqual(verifySecondFactor(user(id), recovery[3]), { ok: false, reason: 'invalid second factor' });
  assert.equal(verifySecondFactor(user(id), recovery[4]).usedRecovery, true);
});

test('a recovery code burned on disk after the snapshot was read is refused under the lock', LIMIT, (t) => {
  const { recovery, id, user } = bootstrapped(t);
  const stale = user(id);
  assert.equal(verifySecondFactor(user(id), recovery[0]).usedRecovery, true);
  assert.deepEqual(verifySecondFactor(stale, recovery[0]), { ok: false, reason: 'invalid second factor' });
});

test('an emailed code is accepted once and then no code is waiting', LIMIT, (t) => {
  const { user } = authStore(t, [EMAIL_USER]);
  const { code } = issueEmailCode('mail@example.invalid');
  assert.deepEqual(verifySecondFactor(user('u2'), code), { ok: true, user: { id: 'u2', email: 'mail@example.invalid' }, factor: 'email' });
  assert.equal(user('u2').emailCode, undefined);
  assert.deepEqual(verifySecondFactor(user('u2'), code), { ok: false, reason: 'no code is waiting — request a new one', factor: 'email' });
});

test('an empty token asks for the emailed code without spending an attempt', LIMIT, (t) => {
  const { user } = authStore(t, [EMAIL_USER]);
  issueEmailCode('mail@example.invalid');
  assert.deepEqual(verifySecondFactor(user('u2'), '  '), { ok: false, reason: 'second factor required', factor: 'email' });
  assert.equal(user('u2').emailCode.attempts, 0);
});

test('a wrong emailed code counts an attempt, and the fifth discards the code', LIMIT, (t) => {
  const { user } = authStore(t, [EMAIL_USER]);
  const { code } = issueEmailCode('mail@example.invalid');
  const wrong = code === '000000' ? '000001' : '000000';
  for (let attempt = 1; attempt <= 4; attempt++) {
    assert.deepEqual(verifySecondFactor(user('u2'), wrong), { ok: false, reason: 'invalid second factor', factor: 'email' });
    assert.equal(user('u2').emailCode.attempts, attempt);
  }
  verifySecondFactor(user('u2'), wrong);
  assert.equal(user('u2').emailCode, undefined);
  assert.equal(verifySecondFactor(user('u2'), code).reason, 'no code is waiting — request a new one');
});

test('an emailed code past its ten minutes has expired and is discarded', LIMIT, (t) => {
  const { user } = authStore(t, [EMAIL_USER]);
  const { code } = issueEmailCode('mail@example.invalid');
  t.mock.timers.setTime(NOW_MS + 10 * 60 * 1000 + 1);
  assert.deepEqual(verifySecondFactor(user('u2'), code), { ok: false, reason: 'the code has expired — request a new one', factor: 'email' });
  assert.equal(user('u2').emailCode, undefined);
});

test('an emailed code is accepted beside TOTP when the TOTP code does not match', LIMIT, (t) => {
  const { user } = authStore(t, [{ ...TOTP_USER, emailFactor: true }]);
  const { code } = issueEmailCode('op@example.invalid');
  assert.deepEqual(verifySecondFactor(user('u1'), code), { ok: true, user: { id: 'u1', email: 'op@example.invalid' }, factor: 'email' });
  assert.equal(user('u1').lastTotpStep, undefined);
});
