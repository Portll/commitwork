// Email second factor: issue, verify once, throttle, expire, bound attempts
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// fact: the store path is pinned before auth.mjs loads
const DIR = mkdtempSync(join(tmpdir(), 'cw-email-factor-'));
process.env.CW_AUTH_STORE = join(DIR, 'users.json');
let auth;
before(async () => { auth = await import('../auth.mjs'); });

const EMAIL = 'op@example.test';
const PASSWORD = 'correct horse battery staple';
const user = () => auth.loadStore().users.find((u) => u.email === EMAIL);

describe('email factor', () => {
  test('a fresh account has no factor; enabling email makes a token-less login ask for one', () => {
    auth.bootstrapRoot({ email: EMAIL, password: PASSWORD });
    assert.equal(auth.verifySecondFactor(user(), '').factor, 'none');
    assert.equal(auth.setEmailFactor(EMAIL, true).emailFactor, true);
    assert.equal(auth.accountFactors(EMAIL).emailFactor, true);
    const r = auth.verifySecondFactor(user(), '');
    assert.equal(r.ok, false);
    assert.equal(r.factor, 'email');
    assert.equal(r.reason, 'second factor required');
  });

  test('a code verifies exactly once, through authenticate() as well', () => {
    const issued = auth.issueEmailCode(EMAIL);
    assert.equal(issued.ok, true, issued.reason);
    assert.match(issued.code, /^\d{6}$/);
    assert.equal(user().emailCode.hash.length, 64, 'stored hashed, never the code');
    const ok = auth.authenticate({ email: EMAIL, password: PASSWORD, token: issued.code });
    assert.equal(ok.ok, true);
    assert.equal(ok.factor, 'email');
    const again = auth.verifySecondFactor(user(), issued.code);
    assert.equal(again.ok, false, 'single use');
    assert.match(again.reason, /no code is waiting/);
  });

  test('re-issue inside a minute is throttled; a later one is allowed', () => {
    const t0 = Date.now();
    const a = auth.issueEmailCode(EMAIL, { nowMs: t0 });
    assert.equal(a.ok, true);
    const b = auth.issueEmailCode(EMAIL, { nowMs: t0 + 10_000 });
    assert.equal(b.ok, false);
    assert.match(b.reason, /less than a minute/);
    const c = auth.issueEmailCode(EMAIL, { nowMs: t0 + 61_000 });
    assert.equal(c.ok, true);
  });

  test('a wrong code counts an attempt; the fifth wrong one discards the code', () => {
    const t0 = Date.now() + 120_000;
    const issued = auth.issueEmailCode(EMAIL, { nowMs: t0 });
    const wrong = issued.code === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      assert.equal(auth.verifyEmailCode(user(), wrong, { nowMs: t0 }).ok, false);
      assert.equal(user().emailCode.attempts, i);
    }
    assert.equal(auth.verifyEmailCode(user(), wrong, { nowMs: t0 }).ok, false);
    assert.equal(user().emailCode, undefined, 'discarded after the fifth attempt');
    assert.equal(auth.verifyEmailCode(user(), issued.code, { nowMs: t0 }).ok, false, 'the real code is gone with it');
  });

  test('an expired code is refused and discarded', () => {
    const t0 = Date.now() + 300_000;
    const issued = auth.issueEmailCode(EMAIL, { nowMs: t0 });
    const r = auth.verifyEmailCode(user(), issued.code, { nowMs: t0 + 11 * 60 * 1000 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /expired/);
    assert.equal(user().emailCode, undefined);
  });

  test('a non-numeric or short token never matches, and still costs an attempt', () => {
    const t0 = Date.now() + 600_000;
    auth.issueEmailCode(EMAIL, { nowMs: t0 });
    assert.equal(auth.verifyEmailCode(user(), 'abcdef', { nowMs: t0 }).ok, false);
    assert.equal(user().emailCode.attempts, 1);
  });

  test('switching the factor off discards a waiting code and restores factor none', () => {
    assert.equal(auth.setEmailFactor(EMAIL, false).emailFactor, false);
    assert.equal(user().emailCode, undefined);
    assert.equal(auth.verifySecondFactor(user(), '').factor, 'none');
    const r = auth.issueEmailCode(EMAIL);
    assert.equal(r.ok, false);
    assert.match(r.reason, /not enabled/);
  });

  test('an unknown account is refused without disclosing that it is unknown', () => {
    const r = auth.issueEmailCode('nobody@example.test');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid credentials');
  });
});
