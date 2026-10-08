// THE OAUTH CALLBACK, DRIVEN END TO END against a stub provider.
//
// This path was untestable until the CW_OAUTH_ENDPOINT_BASE seam: `tokenUrl` pointed at the real
// provider, so nothing could reach the code that authorises an identity, mints a session, or
// parks a second-factor challenge when the account has a confirmed authenticator.
// That last one is the seam it was added for: the gap was named in a commit message rather than
// left to be discovered, and this closes it.
//
// The stub answers on loopback and routes by PATH, which is why the seam rewrites only the origin.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, createServer as createHttp } from 'node:http';
import { createServer } from 'node:net';
import { totpNow } from './helpers/totp-now.mjs';

// Pin the store BEFORE auth.mjs loads — see admin/test/store-path-call-time.test.mjs for why.
const TMP = mkdtempSync(join(tmpdir(), 'cw-oauthcb-'));
process.env.CW_AUTH_STORE = join(TMP, 'users.json');
const { bootstrapSsoRoot, confirmTotp, loadStore, bootstrapRoot } = await import('../auth.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const AUTH_SESSION = join(HERE, '..', 'lib', 'auth-session.mjs');
const EMAIL = 'op@example.com';
const PASSWORD = 'correct horse battery staple';

let child, localPort, stub, stubPort, csrf, recovery;

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

/** Follow the panel's own authorize redirect to recover the one-shot `state` it minted. */
async function startFlow() {
  const r = await hit('/auth/login/google');
  assert.ok(r.status === 302 || r.status === 303, `expected a redirect to the provider, got ${r.status}`);
  const loc = new URL(String(r.headers.location));
  assert.equal(loc.origin, `http://127.0.0.1:${stubPort}`,
    'the authorize redirect must go to the stub — otherwise the seam is not applied to every endpoint');
  const state = loc.searchParams.get('state');
  assert.ok(state, 'no state in the authorize redirect');
  return state;
}

before(async () => {
  // The recovery codes are returned ONCE, at bootstrap. They matter here because only one TOTP
  // step is usable in a run: setup confirms with the current step (burning it), verifyTotp accepts
  // only +/-1, and the step below the current one is <= lastTotpStep and therefore refused. So the
  // single usable code is step+1, and after it is spent a second success needs another factor.
  const boot = bootstrapRoot({ email: EMAIL, password: PASSWORD });
  recovery = boot.recovery || boot.recoveryCodes || [];
  const u = loadStore().users[0];
  confirmTotp(EMAIL, PASSWORD, totpNow(u.totpSecret));
  assert.equal(loadStore().users[0].totpConfirmed, true, 'the fixture needs a CONFIRMED factor');
  assert.ok(recovery.length >= 3, `bootstrap returned ${recovery.length} recovery codes; these tests need 3`);

  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'a', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'a', label: 'a', out: 'a', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'a'), { recursive: true });

  // The stub provider: a token endpoint and a userinfo endpoint, routed by path.
  stubPort = await freePort();
  stub = createHttp((req, res) => {
    const p = req.url.split('?')[0];
    res.setHeader('content-type', 'application/json');
    if (p === '/token') { res.end(JSON.stringify({ access_token: 'stub-access-token', token_type: 'Bearer' })); return; }
    if (p === '/oauth2/v3/userinfo') {
      res.end(JSON.stringify({ email: EMAIL, email_verified: true, sub: 'stub-subject' }));
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise((r) => stub.listen(stubPort, '127.0.0.1', r));

  const pub = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(pub), CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_OAUTH_ENDPOINT_BASE: `http://127.0.0.1:${stubPort}`,
      CW_OAUTH_LIVE_EXCHANGE: '1',
      GOOGLE_OAUTH_CLIENT_ID: 'stub-client-id.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'stub-client-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status) { csrf = r.json && r.json.token; up = true; } } catch { /* not yet */ }
    if (!up) await sleep(100);
  }
  assert.ok(up, 'panel did not come up');
});

after(() => {
  if (child) child.kill('SIGKILL');
  if (stub) stub.close();
  rmSync(TMP, { recursive: true, force: true });
});

describe('the seam refuses to point anywhere but loopback', () => {
  // The validator is lifted from source and driven directly. The first version of this test spawned
  // a panel and asserted a NEGATIVE regex over its output — which passes whether the seam refuses,
  // accepts, or was never consulted. A negative over noisy output is not a measurement.
  const src = readFileSync(AUTH_SESSION, 'utf8');
  const block = src.slice(src.indexOf('const LOOPBACK_HOSTS = new Set('), src.indexOf('\n\nconst OAUTH = {'));
  const { oauthEndpointBase, providerUrl } = new Function(`${block}; return { oauthEndpointBase, providerUrl };`)();
  const withBase = (v, fn) => {
    const prev = process.env.CW_OAUTH_ENDPOINT_BASE;
    if (v === null) delete process.env.CW_OAUTH_ENDPOINT_BASE; else process.env.CW_OAUTH_ENDPOINT_BASE = v;
    try { return fn(); } finally {
      if (prev === undefined) delete process.env.CW_OAUTH_ENDPOINT_BASE; else process.env.CW_OAUTH_ENDPOINT_BASE = prev;
    }
  };

  test('loopback in every spelling is accepted', () => {
    for (const v of ['http://127.0.0.1:9', 'http://localhost:9', 'http://[::1]:9']) {
      withBase(v, () => assert.equal(oauthEndpointBase(), new URL(v).origin, `${v} was refused`));
    }
  });

  test('a REMOTE base is refused — this is where the client secret is sent', () => {
    // Refused, not ignored. An ignored override sends the secret to the REAL provider while the
    // operator believes it is going to a stub: the failure that looks like success.
    for (const v of ['https://evil.example.com', 'http://10.0.0.5:80', 'http://169.254.169.254/']) {
      withBase(v, () => assert.throws(() => oauthEndpointBase(), /must be loopback/,
        `${v} was not refused — the seam is an exfiltration route`));
    }
  });

  test('a malformed value throws rather than silently passing through', () => {
    withBase('not a url', () => assert.throws(() => oauthEndpointBase(), /is not a URL/));
    // the request-failure log prints this message, and a non-URL here may be a misplaced secret
    withBase('pasted-client-secret', () => assert.throws(() => oauthEndpointBase(),
      (e) => /is not a URL/.test(e.message) && !e.message.includes('pasted-client-secret')));
  });

  test('unset changes nothing, and set rewrites ONLY the origin', () => {
    withBase(null, () => {
      assert.equal(oauthEndpointBase(), null);
      assert.equal(providerUrl('https://oauth2.googleapis.com/token'), 'https://oauth2.googleapis.com/token',
        'with no seam the real endpoint must be untouched');
    });
    withBase('http://127.0.0.1:9', () => {
      assert.equal(providerUrl('https://oauth2.googleapis.com/token?x=1'), 'http://127.0.0.1:9/token?x=1',
        'path and query must survive — the stub routes by path');
    });
  });
});

describe('the whole callback, against a stub provider', () => {
  test('an authorised identity with a CONFIRMED authenticator parks a challenge instead of a session', async () => {
    // THIS IS THE NAMED GAP. Everything before this point was reachable; this branch was
    // not, because it needs the token exchange and the identity call to both succeed.
    const state = await startFlow();
    const r = await hit(`/auth/callback/google?code=stub-code&state=${encodeURIComponent(state)}`);
    assert.equal(r.status, 302, r.body);
    const cookies = String(r.headers['set-cookie'] || '');
    assert.match(cookies, /cw_sso_totp=/, 'a challenge must be parked');
    assert.ok(!/cw_admin_sid=/.test(cookies),
      'NO SESSION may be minted: the provider proved an identity, not a second factor');
    assert.match(cookies, /HttpOnly/, 'the challenge bears a pending login and must not be readable by script');
  });

  test('and the panel then RENDERS the prompt for that live challenge', async () => {
    // The other half of the named gap: the challenge existing, and the page reaching it.
    const state = await startFlow();
    const cb = await hit(`/auth/callback/google?code=stub-code&state=${encodeURIComponent(state)}`);
    const cid = /cw_sso_totp=([^;]+)/.exec(String(cb.headers['set-cookie'] || ''))[1];
    const page = await hit('/', { headers: { accept: 'text/html', cookie: `cw_sso_totp=${cid}` } });
    assert.equal(page.status, 200);
    assert.match(page.body, /One more step/, 'a live challenge did not reach the prompt');
    assert.match(page.body, /auth\/sso\/totp/);
  });

  test('the code completes it, and the challenge is one-shot', async () => {
    const state = await startFlow();
    const cb = await hit(`/auth/callback/google?code=stub-code&state=${encodeURIComponent(state)}`);
    const cid = /cw_sso_totp=([^;]+)/.exec(String(cb.headers['set-cookie'] || ''))[1];
    const u = loadStore().users[0];

    const done = await hit('/auth/sso/totp', { method: 'POST',
      headers: { 'x-cw-csrf': csrf, cookie: `cw_sso_totp=${cid}` },
      body: JSON.stringify({ token: totpNow(u.totpSecret, Date.now(), 1) }) });
    assert.equal(done.status, 200, done.body);
    assert.match(String(done.headers['set-cookie'] || ''), /cw_admin_sid=/, 'the session must be minted');

    // The retry uses a VALID, UNSPENT recovery code. That is the point: a 401 here can only mean
    // the CHALLENGE is gone. A second TOTP code would have been refused for being out of window,
    // and the test would have passed while proving nothing about one-shot behaviour.
    const again = await hit('/auth/sso/totp', { method: 'POST',
      headers: { 'x-cw-csrf': csrf, cookie: `cw_sso_totp=${cid}` },
      body: JSON.stringify({ token: recovery[0] }) });
    assert.equal(again.status, 401, 'a challenge that survives its own use is a replayable login');
  });

  test('a wrong code does NOT mint a session, and does not burn the challenge either', async () => {
    const state = await startFlow();
    const cb = await hit(`/auth/callback/google?code=stub-code&state=${encodeURIComponent(state)}`);
    const cid = /cw_sso_totp=([^;]+)/.exec(String(cb.headers['set-cookie'] || ''))[1];

    const bad = await hit('/auth/sso/totp', { method: 'POST',
      headers: { 'x-cw-csrf': csrf, cookie: `cw_sso_totp=${cid}` },
      body: JSON.stringify({ token: '000000' }) });
    assert.equal(bad.status, 401);
    assert.ok(!/cw_admin_sid=/.test(String(bad.headers['set-cookie'] || '')));

    // A mistyped code must not cost the operator their sign-in — they retype, they do not restart
    // the provider flow.
    const ok = await hit('/auth/sso/totp', { method: 'POST',
      headers: { 'x-cw-csrf': csrf, cookie: `cw_sso_totp=${cid}` },
      body: JSON.stringify({ token: recovery[1] }) });
    assert.equal(ok.status, 200, 'a failed attempt burned the challenge — one typo and the flow restarts');
    assert.equal(ok.json.usedRecovery, true, 'and the caller is told a recovery code was spent');
  });
});
