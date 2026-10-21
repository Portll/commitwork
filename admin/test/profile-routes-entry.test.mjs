// The profile page's state-changing routes, invoked through their handlers against a temp auth store
// (CW_AUTH_STORE, read at call time by admin/auth.mjs). No keychain, no server, no network.
//
//   POST /api/me/totp/reissue   POST /api/me/totp/confirm   POST /api/me/totp/disable
//   POST /api/me/email-factor   POST /api/me/github/unlink
//
// Each gets: the no-session refusal (operator port included — these routes never let loopback stand
// in for a session), the wrong-user refusal (a session naming no account, or acting only on its own
// account), one bad-input refusal, and one authenticated happy path asserted on the STORE, not only
// on the reply. TOTP codes are computed here with an independent RFC 6238 implementation, so the
// test does not borrow the verifier it is checking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { routes } from '../routes/profile.mjs';
import { bootstrapRoot, linkGithub } from '../auth.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-profile-entry-'));
const STORE = join(TMP, 'users.json');
const saved = process.env.CW_AUTH_STORE;

const OP = 'op@example.test';
const OTHER = 'sso-user@example.test';
const GHOST = 'nobody@example.test';
// built at run time — no literal credential in the tree
const PASSWORD = `fixture-${randomBytes(9).toString('hex')}`;

before(() => {
  process.env.CW_AUTH_STORE = STORE;
  bootstrapRoot({ email: OP, password: PASSWORD });
  // a second, provider-only account (no password), added as fixture data
  const doc = JSON.parse(readFileSync(STORE, 'utf8'));
  doc.users.push({ id: 'fixture0000other', email: OTHER, createdAt: '2026-08-01T00:00:00.000Z', totpConfirmed: false });
  writeFileSync(STORE, JSON.stringify(doc, null, 2));
});
after(() => {
  if (saved === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = saved;
  rmSync(TMP, { recursive: true, force: true });
});

const user = (email) => JSON.parse(readFileSync(STORE, 'utf8')).users.find((u) => u.email === email);
const sessionFor = (email) => ({ user: email, provider: 'password', createdAt: Date.now() });
const route = (path) => routes.find((r) => r.method === 'POST' && r.path === path);
const call = (path, { session = null, loopback = false, body = {}, bodyErr = null } = {}) => new Promise((resolve) => {
  route(path).handle({
    req: {}, isLoopbackReq: loopback, adminSession: () => session,
    readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
    send: (code, payload) => resolve({ code, payload }),
  });
});

// ── an independent RFC 6238 (SHA-1, 6 digits, 30s) ──────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  msg.writeUInt32BE(step >>> 0, 4);
  const mac = createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const n = ((mac[o] & 0x7f) << 24 | mac[o + 1] << 16 | mac[o + 2] << 8 | mac[o + 3]) % 1_000_000;
  return String(n).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 1000 / 30);

const PATHS = ['/api/me/totp/reissue', '/api/me/totp/confirm', '/api/me/totp/disable', '/api/me/email-factor', '/api/me/github/unlink'];

test('every profile write refuses without a session — the operator port does not stand in', async () => {
  const before = readFileSync(STORE, 'utf8');
  for (const p of PATHS) {
    for (const loopback of [false, true]) {
      const r = await call(p, { session: null, loopback, body: { password: PASSWORD, token: '000000', enabled: true } });
      assert.equal(r.code, 401, `${p} loopback=${loopback}`);
      assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
    }
    const r = await call(p, { session: { provider: 'password' } });
    assert.equal(r.code, 401, `${p}: a session object with no user is not a session`);
  }
  assert.equal(readFileSync(STORE, 'utf8'), before, 'no refused call touched the store');
});

test('a session naming no account is refused by every route, and no account is created for it', async () => {
  const expect = {
    '/api/me/totp/reissue': [400, /no account for nobody@example\.test/],
    '/api/me/totp/confirm': [400, /could not confirm/],
    '/api/me/totp/disable': [401, /session no longer matches an account/],
    '/api/me/email-factor': [401, /no account/],
    '/api/me/github/unlink': [400, /no account for nobody@example\.test/],
  };
  for (const p of PATHS) {
    const r = await call(p, { session: sessionFor(GHOST), body: { password: PASSWORD, token: '000000', enabled: true } });
    assert.equal(r.code, expect[p][0], `${p}: ${JSON.stringify(r.payload)}`);
    assert.equal(r.payload.ok, false);
    assert.match(r.payload.error, expect[p][1], p);
  }
  assert.equal(user(GHOST), undefined);
});

test('the body parser\'s refusal is a 400 on every route that reads a body', async () => {
  for (const p of PATHS.filter((x) => x !== '/api/me/totp/reissue')) {
    const r = await call(p, { session: sessionFor(OP), bodyErr: 'body is not valid JSON' });
    assert.equal(r.code, 400, p);
    assert.deepEqual(r.payload, { ok: false, error: 'body is not valid JSON' });
  }
});

test('reissue rotates the CALLER\'s secret only, returns it once, and resets confirmation', async () => {
  const opBefore = user(OP);
  const otherBefore = user(OTHER);
  const r = await call('/api/me/totp/reissue', { session: sessionFor(OP) });
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.payload).sort(), ['ok', 'otpauth', 'totpSecret']);
  assert.match(r.payload.totpSecret, /^[A-Z2-7]{32}$/, '160 bits, base32');
  assert.notEqual(r.payload.totpSecret, opBefore.totpSecret);
  assert.ok(r.payload.otpauth.startsWith(`otpauth://totp/Commitwork:${encodeURIComponent(OP)}?`), r.payload.otpauth);
  assert.equal(new URL(r.payload.otpauth).searchParams.get('secret'), r.payload.totpSecret);

  const after = user(OP);
  assert.equal(after.totpSecret, r.payload.totpSecret, 'the store holds what was handed out');
  assert.equal(after.totpConfirmed, false);
  assert.equal(after.salt, opBefore.salt, 'the password is untouched');
  assert.equal(after.hash, opBefore.hash);
  assert.deepEqual(user(OTHER), otherBefore, 'another account is never reached through a session');
});

test('confirm refuses a wrong password and a wrong code, then confirms with both, and burns the code', async () => {
  const secret = user(OP).totpSecret;
  const code = totp(secret, stepNow());

  const wrongPw = await call('/api/me/totp/confirm', { session: sessionFor(OP), body: { password: `${PASSWORD}-wrong`, token: code } });
  assert.equal(wrongPw.code, 400);
  assert.match(wrongPw.payload.error, /check the password and the code/);
  // a code from far outside the ±1 step window
  const wrongCode = await call('/api/me/totp/confirm', { session: sessionFor(OP), body: { password: PASSWORD, token: totp(secret, stepNow() - 20) } });
  assert.equal(wrongCode.code, 400);
  assert.equal(user(OP).totpConfirmed, false, 'neither refusal turned enforcement on');
  assert.equal(user(OP).lastTotpStep, undefined);

  const ok = await call('/api/me/totp/confirm', { session: sessionFor(OP), body: { password: PASSWORD, token: code } });
  assert.equal(ok.code, 200, JSON.stringify(ok.payload));
  assert.deepEqual(ok.payload, { ok: true, totpConfirmed: true });
  const u = user(OP);
  assert.equal(u.totpConfirmed, true);
  assert.ok(Number.isInteger(u.lastTotpStep) && Math.abs(u.lastTotpStep - stepNow()) <= 1, 'the matched step is recorded');

  const replay = await call('/api/me/totp/confirm', { session: sessionFor(OP), body: { password: PASSWORD, token: code } });
  assert.equal(replay.code, 400, 'a validated code is single-use');
});

test('email-factor needs the current password on a password account, and writes the switch', async () => {
  const refused = await call('/api/me/email-factor', { session: sessionFor(OP), body: { enabled: true, password: 'not-the-password' } });
  assert.equal(refused.code, 401);
  assert.match(refused.payload.error, /current password is required/);
  assert.equal(user(OP).emailFactor, undefined, 'a refused switch writes nothing');

  const on = await call('/api/me/email-factor', { session: sessionFor(OP), body: { enabled: true, password: PASSWORD } });
  assert.equal(on.code, 200, JSON.stringify(on.payload));
  assert.deepEqual(on.payload, { ok: true, emailFactor: true });
  assert.equal(user(OP).emailFactor, true);

  const off = await call('/api/me/email-factor', { session: sessionFor(OP), body: { enabled: false, password: PASSWORD } });
  assert.deepEqual(off.payload, { ok: true, emailFactor: false });
  assert.equal(user(OP).emailFactor, false);
  assert.equal(user(OTHER).emailFactor, undefined, 'only the caller\'s account moved');
});

test('github/unlink removes the caller\'s link only, and is idempotent', async () => {
  linkGithub(OP, { login: 'fixture-op', id: 4242 });
  linkGithub(OTHER, { login: 'fixture-other', id: 4343 });
  assert.equal(user(OP).github.login, 'fixture-op');

  const r = await call('/api/me/github/unlink', { session: sessionFor(OP) });
  assert.equal(r.code, 200);
  assert.deepEqual(r.payload, { ok: true, email: OP });
  assert.equal(user(OP).github, undefined);
  assert.equal(user(OTHER).github.id, 4343, 'the other account keeps its link');

  const again = await call('/api/me/github/unlink', { session: sessionFor(OP) });
  assert.equal(again.code, 200, 'unlinking nothing is a no-op, not an error');
});

test('disable needs a valid current code: no secret, a wrong code and a stale code are all refused', async () => {
  const noSecret = await call('/api/me/totp/disable', { session: sessionFor(OTHER), body: { token: '123456' } });
  assert.equal(noSecret.code, 400);
  assert.match(noSecret.payload.error, /no second factor is enrolled/);

  const secret = user(OP).totpSecret;
  for (const token of ['', 'abcdef', totp(secret, stepNow() - 20)]) {
    const r = await call('/api/me/totp/disable', { session: sessionFor(OP), body: { token } });
    assert.equal(r.code, 401, JSON.stringify(token));
    assert.match(r.payload.error, /2FA was not disabled/);
  }
  assert.equal(user(OP).totpSecret, secret, 'the factor is still enrolled after every refusal');
  assert.equal(user(OP).totpConfirmed, true);
});

test('reissue is refused while sign-in enforces the factor: a session alone cannot lower it', async () => {
  const before = user(OP);
  assert.equal(before.totpConfirmed, true);
  const r = await call('/api/me/totp/reissue', { session: sessionFor(OP) });
  assert.equal(r.code, 409);
  assert.match(r.payload.error, /disable it with a current code first/);
  assert.equal(r.payload.totpSecret, undefined);
  assert.deepEqual(user(OP), before, 'the account is unchanged');
});

test('disable refuses the code confirm already consumed', async () => {
  const u = user(OP);
  const r = await call('/api/me/totp/disable', { session: sessionFor(OP), body: { token: totp(u.totpSecret, u.lastTotpStep) } });
  assert.equal(r.code, 401, JSON.stringify(r.payload));
  assert.match(r.payload.error, /already been used/);
  assert.equal(user(OP).totpConfirmed, true);
  assert.equal(user(OP).totpSecret, u.totpSecret);
});

test('disable with a valid code clears the factor on the caller\'s account', async () => {
  // the NEXT step's code: valid inside the ±1 window, and not the step confirm already burned
  const r = await call('/api/me/totp/disable', { session: sessionFor(OP), body: { token: totp(user(OP).totpSecret, stepNow() + 1) } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.deepEqual(r.payload, { ok: true, email: OP, totpConfirmed: false });
  const u = user(OP);
  assert.equal(u.totpSecret, undefined);
  assert.equal(u.lastTotpStep, undefined);
  assert.equal(u.totpConfirmed, false);
  assert.ok(u.salt && u.hash, 'the password survives');
});

test('the five routes are POST-only in the dispatch table', () => {
  for (const p of PATHS) assert.deepEqual(routes.filter((r) => r.path === p).map((r) => r.method), ['POST'], p);
});
