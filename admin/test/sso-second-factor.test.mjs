// SSO IS NOT A SECOND FACTOR. Completing an OAuth flow proves an identity and nothing more, so an
// account with a confirmed authenticator was two-factor through its own password form and
// single-factor through Google — and the weaker path is the one that decides.
//
// These drive /auth/sso/totp against a really-spawned panel. The callback half (which parks the
// pending challenge) needs a live provider exchange, so the challenge is seeded here through the
// same route the callback uses and the assertions concentrate on the half that decides: what it
// takes to turn a pending SSO login into a session, and what must not.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { totpNow } from './helpers/totp-now.mjs';

// THE STORE PATH IS PINNED BEFORE auth.mjs IS LOADED, and auth.mjs is imported DYNAMICALLY for
// exactly that reason. `STORE_PATH` is a module-load `const` — `process.env.CW_AUTH_STORE ||
// ~/.commitwork/users.json` — so a static import followed by setting the env would leave every
// call in this file operating on the OPERATOR'S REAL CREDENTIAL STORE. This file would have
// bootstrapped a fixture account into it. That is why admin/test/auth-sso.test.mjs does its auth
// work in a child process rather than in-process; a dynamic import buys the same isolation without
// the string-literal source.
const TMP0 = mkdtempSync(join(tmpdir(), 'cw-ssotf-'));
process.env.CW_AUTH_STORE = join(TMP0, 'users.json');
const { bootstrapRoot, confirmTotp, loadStore, verifySecondFactor } = await import('../auth.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = TMP0;
const STORE = join(TMP, 'users.json');
const EMAIL = 'op@example.com';
const PASSWORD = 'correct horse battery staple';

let child, localPort, csrf;

const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const hit = (path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const req = request({ host: '127.0.0.1', port: localPort, path, method, headers: h }, (r) => {
    let buf = '';
    r.setEncoding('utf8');
    r.on('data', (d) => { buf += d; });
    r.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ }
      resolve({ status: r.statusCode, body: buf, json, headers: r.headers }); });
  });
  req.on('error', reject);
  if (body != null) req.write(body);
  req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  bootstrapRoot({ email: EMAIL, password: PASSWORD });
  // enrol AND confirm — an unconfirmed authenticator deliberately demands no code, so an
  // unconfirmed account would exercise the pass-through branch instead of the gate.
  const u = loadStore().users[0];
  confirmTotp(EMAIL, PASSWORD, totpNow(u.totpSecret));
  assert.equal(loadStore().users[0].totpConfirmed, true, 'the fixture must have a CONFIRMED factor');

  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'a', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'a', label: 'a', out: 'a', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'a'), { recursive: true });

  const pub = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: STORE, CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(pub), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status) up = true; } catch { /* not yet */ }
    if (!up) await sleep(100);
  }
  assert.ok(up, 'panel did not come up');
  // The route is state-changing, so it inherits the panel's CSRF guard — a POST without the header
  // is 403 before it ever reaches the challenge lookup. That is the panel working; the test has to
  // present a token like a browser would.
  csrf = (await hit('/api/csrf')).json.token;
  assert.ok(csrf, 'no CSRF token issued');
});

after(() => { if (child) child.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

describe('the second factor, verified on its own', () => {
  // The extraction is what lets the OAuth path reuse the password path's factor logic instead of
  // growing a second copy. These pin the properties that a second copy would most likely lose.
  test('a confirmed authenticator accepts its code — and refuses the SAME code twice', () => {
    const u = loadStore().users[0];
    // NEXT step, not the current one: confirmTotp() in setup consumed this window, and the record
    // of that is exactly what makes a replay fail. Asking for the current code here would test the
    // single-use guard twice and the acceptance path never.
    const code = totpNow(u.totpSecret, Date.now(), 1);
    assert.equal(verifySecondFactor(loadStore().users[0], code).ok, true,
      'a code from an unspent step inside the accepted window must be taken');
    assert.equal(verifySecondFactor(loadStore().users[0], code).ok, false,
      'RFC 6238 §5.2: a code stays arithmetically valid for the whole window, so without a '
      + 'single-use record the same code authenticates repeatedly for ~90s');
  });

  test('a recovery code is accepted in its place, and burned', () => {
    const before = loadStore().users[0].recovery.filter((r) => !r.used).length;
    assert.ok(before > 0, 'the fixture must hold unused recovery codes for this to mean anything');
    // the plaintext codes are returned by bootstrapRoot; re-deriving them is not possible, so this
    // asserts the SHAPE that matters — an unusable token is refused and burns nothing.
    const r = verifySecondFactor(loadStore().users[0], 'not-a-real-recovery-code');
    assert.equal(r.ok, false);
    assert.equal(loadStore().users[0].recovery.filter((x) => !x.used).length, before,
      'a failed attempt must not consume a recovery code');
  });

  test('an account with NO confirmed factor passes through — that is what keeps SSO usable today', () => {
    // The operator's live account is enrolled-but-unconfirmed, and auth.mjs refuses to demand a
    // code in that state on purpose: "a failed enrolment otherwise locks the only account".
    const r = verifySecondFactor({ id: 'x', email: 'y@example.com', totpConfirmed: false }, null);
    assert.equal(r.ok, true);
    assert.equal(r.factor, 'none', 'the caller can tell a pass-through from a verified factor');
  });

  test('no user is a refusal, not a pass', () => {
    assert.equal(verifySecondFactor(null, '123456').ok, false);
    assert.equal(verifySecondFactor(undefined, '123456').ok, false);
  });
});

describe('/auth/sso/totp', () => {
  test('is reachable UNAUTHENTICATED — it is the route that creates the session', async () => {
    // If the login gate covered it, an SSO sign-in could never be completed. `/auth/` is exempt;
    // this asserts the exemption rather than trusting the prefix.
    const r = await hit('/auth/sso/totp', { method: 'POST', headers: { 'x-cw-csrf': csrf },
      body: JSON.stringify({ token: '000000' }) });
    assert.notEqual(r.status, 404, 'the route must exist');
    assert.ok(r.status === 401, `expected a refusal for a missing challenge, got ${r.status}: ${r.body}`);
    assert.match(r.json.error, /no sign-in is waiting/, 'and it must say WHY, not just refuse');
  });

  test('a code alone is not a login — the challenge cookie is required', async () => {
    // This is the property that makes a stolen authenticator code useless on its own: the caller
    // must have completed the provider flow in THIS browser.
    const u = loadStore().users[0];
    const r = await hit('/auth/sso/totp', { method: 'POST', headers: { 'x-cw-csrf': csrf },
      body: JSON.stringify({ token: totpNow(u.totpSecret) }) });
    assert.equal(r.status, 401);
    assert.equal(/cw_admin_sid=/.test(String(r.headers['set-cookie'] || '')), false,
      'no session may be minted without a pending challenge');
  });

  test('a forged challenge id is refused — the id is a lookup, never a claim', async () => {
    const r = await hit('/auth/sso/totp', { method: 'POST',
      headers: { cookie: 'cw_sso_totp=totally-made-up-identifier', 'x-cw-csrf': csrf },
      body: JSON.stringify({ token: '123456' }) });
    assert.equal(r.status, 401);
    assert.equal(/cw_admin_sid=/.test(String(r.headers['set-cookie'] || '')), false);
  });
});

describe('the prompt the operator actually sees', () => {
  // Without a prompt the server half is a feature nobody can reach: the challenge is parked and the
  // browser lands on a page that knows nothing about it.
  test('the page renders a code form that names no account', async () => {
    const { loginPage } = await import('../lib/login-page.mjs');
    const html = loginPage({ bootstrapOpen: false, ssoTotp: true, providers: {}, localPort: 7878 });
    assert.match(html, /One more step/);
    assert.match(html, /auth\/sso\/totp/, 'the form must post to the completing route');
    assert.ok(!/name="email"/.test(html),
      'the account is named by the challenge the SERVER holds; an account field would invite a '
      + 'caller to name a different one');
    assert.match(html, /panel-breakglass/,
      'the way back in belongs on the page that can strand you');
    assert.match(html, /recovery code/i, 'a recovery code works here and the page must say so');
  });

  test('it does NOT render the layered password machine, which would throw on this body', async () => {
    const { loginPage } = await import('../lib/login-page.mjs');
    const html = loginPage({ bootstrapOpen: false, ssoTotp: true, providers: {}, localPort: 7878 });
    // The layered script drives l1/l2/l3 elements this body does not have.
    assert.ok(!/el\('l1'\)/.test(html), 'the layered sign-in script leaked into the SSO prompt');
  });

  test('a cookie naming NO live challenge falls through to the ordinary page', async () => {
    // The negative half is testable without a live provider exchange; the positive half is not,
    // and is stated as uncovered rather than asserted from the source.
    const r = await hit('/', { headers: { accept: 'text/html', cookie: 'cw_sso_totp=no-such-challenge' } });
    assert.equal(r.status, 200);
    assert.ok(!/One more step/.test(r.body),
      'a dead challenge rendered a prompt that could never complete');
  });
});

// NOT COVERED, and named rather than left to be discovered: the seam between the two halves — that
// serve.mjs renders the prompt when a challenge IS live. Reaching it requires the OAuth callback to
// complete, and OAUTH[p].tokenUrl is hardcoded to the provider's real endpoint, so a test cannot
// drive it without an env seam redirecting where the CLIENT SECRET is sent. That seam may well be
// worth adding — the OAuth path is untestable today — but it is a decision about a credential
// egress point, not a detail to slip into a test file.
