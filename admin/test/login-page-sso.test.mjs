// admin/serve.mjs — what the LOGIN PAGE offers, and which port its instructions name.
// Boots the real server as a child against a temp CW_AUTH_STORE; env vars win over keychain refs,
// so dummy OAuth credentials make a provider "configured".

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVE = fileURLToPath(new URL('../serve.mjs', import.meta.url));

// Built once: every child boots against the same declared-hostname fixture.
let REGISTRY;

// One operator already bound, so the page renders the SIGN IN branch.
function storeWith(allowExternalSso) {
  const f = join(mkdtempSync(join(tmpdir(), 'cw-loginpage-')), 'users.json');
  writeFileSync(f, JSON.stringify({
    version: 1,
    users: [{ email: 'operator@example.com', provider: 'google', createdAt: new Date(0).toISOString() }],
    settings: { allowExternalSso },
  }));
  return f;
}

// A store with NO operator, so the panel is UNBOOTSTRAPPED. Needed only by the branded-404 pair
// below: once an account exists, an unauthenticated request is answered with the login page before
// routing is ever reached, so a 404 assertion would be measuring the login gate rather than the
// error page. An unbootstrapped panel is the one state where an anonymous caller still reaches the
// router, which is what those two tests are actually about.
function storeWithNoOperator() {
  const f = join(mkdtempSync(join(tmpdir(), 'cw-loginpage-bare-')), 'users.json');
  writeFileSync(f, JSON.stringify({ version: 1, users: [], settings: {} }));
  return f;
}

// THE DECLARED-HOSTNAME TESTS BELOW NEED A REGISTRY, AND USED TO BORROW THE OPERATOR'S.
//
// serve.mjs builds DECLARED_HOSTS from the `commitwork-admin` area's deploy.hostnames. Unset,
// CW_REGISTRY resolves to monitor/private/projects.json — a gitignored path reached through the
// sidecar symlink — and when that is absent the loader falls back to monitor/projects.example.json,
// whose areas are `example-*`. So find() returned undefined, DECLARED_HOSTS was empty, and
// "a DECLARED public hostname gets its own https redirect" failed on every fresh clone and on this
// Windows box (measured 2026-09-04) while oauthOrigin's allowlist was working perfectly. A test that
// passes only where one operator's private file happens to sit is asserting about the machine, not
// the code.
//
// The fixture declares the same hostname the assertions already name, so their meaning is unchanged
// — including the suffix probe `commitwork.portll.net.evil.com`, which is only a real attack to
// refuse while `commitwork.portll.net` IS declared.
function registryFixture() {
  const f = join(mkdtempSync(join(tmpdir(), 'cw-loginpage-reg-')), 'projects.json');
  writeFileSync(f, JSON.stringify({
    reportsRoot: 'reports',
    areas: [{
      slug: 'commitwork-admin',
      label: 'commitwork admin',
      out: 'commitwork-admin',
      primary: true,
      // service/public/requiresAuth are required by the registry validator, which throws at boot
      // rather than degrading — so a fixture that omits them takes the whole suite down instead of
      // quietly running against an empty allowlist. That is the loader behaving correctly.
      deploy: {
        hostnames: ['commitwork.portll.net'],
        service: 'http://127.0.0.1:7878',
        public: true,
        requiresAuth: true,
      },
    }],
  }));
  return f;
}

// The OS assigns the ports — fixed ranges collide under concurrent suite runs.
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close((e) => (e ? reject(e) : resolve(port)));
  });
});

// Readiness comes from THIS child's own stdout — a port answering does not prove it is this child.
async function boot(store, port, localPort) {
  const child = spawn(process.execPath, [SERVE, String(port)], {
    env: {
      ...process.env,
      CW_AUTH_STORE: store,
      CW_REGISTRY: REGISTRY,
      CW_ADMIN_LOCAL_PORT: String(localPort),
      CW_OAUTH_LIVE_EXCHANGE: '1',
      GOOGLE_OAUTH_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });

  const deadline = Date.now() + 10_000;
  for (;;) {
    // the operator line is printed by the SECOND listen(), so it means both sockets are bound
    if (out.includes(`http://127.0.0.1:${localPort}`)) return child;
    if (/EADDRINUSE/.test(err) || /EADDRINUSE/.test(out)) { child.kill('SIGKILL'); return null; }
    if (child.exitCode !== null) { child.kill('SIGKILL'); return null; }
    // A timeout is retryable — a lost port race is an expected occasional outcome.
    if (Date.now() > deadline) { child.kill('SIGKILL'); return null; }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function bootAnywhere(store) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = await freePort();
    const localPort = await freePort();
    if (port === localPort) continue;              // the allocator may hand back the one just released
    const child = await boot(store, port, localPort);
    if (!child) continue;
    // Listened once is not listening now — verify the server still answers before handing it out.
    if (await answers(port)) return { child, port, localPort };
    child.kill('SIGKILL');
  }
  throw new Error('could not obtain a working ephemeral port pair in 8 attempts');
}

// Asks only "is anyone home"; a no is a retry signal, not an assertion.
async function answers(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { headers: { Accept: 'text/html' } });
    return r.status > 0;
  } catch { return false; }
}

// text/html required — without it the same route answers a JSON 401.
const loginPage = (port) => fetch(`http://127.0.0.1:${port}/`, { headers: { Accept: 'text/html' } })
  .then(async (r) => ({ status: r.status, html: await r.text() }));

describe('the login page offers only what can actually succeed', () => {
  let off, on;
  let bare;
  before(async () => {
    REGISTRY = registryFixture();
    off = await bootAnywhere(storeWith(false));
    on = await bootAnywhere(storeWith(true));
    bare = await bootAnywhere(storeWithNoOperator());
  });
  after(() => { off?.child.kill('SIGKILL'); on?.child.kill('SIGKILL'); bare?.child.kill('SIGKILL'); });

  test('external sign-in OFF: the SSO button is ABSENT, not disabled', async () => {
    const { status, html } = await loginPage(off.port);
    assert.equal(status, 200);
    assert.equal(/Sign in with Google/.test(html), false,
      'a button that leads to a Google consent screen followed by a refusal must not be rendered at all');
    assert.equal(/id="google"/.test(html), false, 'not merely hidden or disabled — absent');
  });

  test('external sign-in OFF: password sign-in is UNAFFECTED', async () => {
    // the switch governs SSO, not the panel. Hiding the button must not lock the operator out.
    const { html } = await loginPage(off.port);
    assert.match(html, /name="password"/, 'the password form is the path that still works');
  });

  test('external sign-in ON: the SSO button appears', async () => {
    const { status, html } = await loginPage(on.port);
    assert.equal(status, 200);
    assert.match(html, /Sign in with Google/, 'with the switch on and a provider configured, the flow can succeed');
  });

  // The login page is unauthenticated by design, so every asset it references must be too.
  test('every asset the LOGIN PAGE references is reachable without a session', async () => {
    const { html } = await loginPage(off.port);
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length, 'the login page must reference at least one asset for this to mean anything');
    for (const ref of refs) {
      const r = await fetch(`http://127.0.0.1:${off.port}${ref}`);
      assert.equal(r.status, 200, `${ref} is referenced by the unauthenticated login page but answered ${r.status}`);
    }
  });

  // The exemption is an exact allowlist, never a prefix match.
  test('the public-asset exemption is EXACT — a prefix cannot walk out of it', async () => {
    for (const probe of ['/cw-favicon../../admin/serve.mjs', '/cw-favicon.svg/../../package.json',
      '/cw-favicon-nope.svg', '/api/state', '/index.html']) {
      const r = await fetch(`http://127.0.0.1:${off.port}${probe}`);
      assert.notEqual(r.status, 200, `${probe} must not clear the gate (got ${r.status})`);
    }
  });

  // node:http, not fetch — Host is a forbidden fetch header and undici silently drops it.
  const redirectUriFor = (port, host) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/auth/login/google', method: 'GET',
      headers: { host } }, (res) => {
      res.resume();
      const loc = res.headers.location || '';
      const m = /[?&]redirect_uri=([^&]+)/.exec(loc);
      resolve(m ? decodeURIComponent(m[1]) : null);
    });
    req.on('error', reject);
    req.end();
  });

  test('a DECLARED public hostname gets its own https redirect, not loopback', async () => {
    const uri = await redirectUriFor(on.port, 'commitwork.portll.net');
    assert.equal(uri, 'https://commitwork.portll.net/auth/callback/google',
      'the flow must return to the host the user started from, over the scheme the tunnel serves');
  });

  test('loopback gets a loopback redirect — local sign-in must keep working', async () => {
    const uri = await redirectUriFor(on.port, `127.0.0.1:${on.port}`);
    assert.equal(uri, `http://127.0.0.1:${on.port}/auth/callback/google`);
  });

  // Host is caller-controlled; the allowlist is the whole security of this.
  test('an UNDECLARED Host cannot steer the redirect — it falls back, never follows', async () => {
    for (const forged of ['evil.example.com', 'commitwork.portll.net.evil.com', 'localhost:1']) {
      const uri = await redirectUriFor(on.port, forged);
      assert.ok(uri, `no redirect produced for ${forged}`);
      assert.equal(uri.includes(forged.split(':')[0]) && !uri.startsWith('http://127.0.0.1'), false,
        `${forged} steered the redirect to ${uri}`);
    }
  });

  // /?login=google is the URL this panel's own OAuth callback redirects to.
  test('a query string does not turn a real route into a 404', async () => {
    for (const path of ['/', '/?login=google', '/index.html?x=1', '/api/csrf', '/api/csrf?t=1']) {
      const r = await fetch(`http://127.0.0.1:${on.localPort}${path}`, { headers: { Accept: 'text/html' } });
      assert.notEqual(r.status, 404, `${path} must not 404 merely because of its query string`);
    }
  });

  // Matched above the login gate, so it reads the pathname before most routes do.
  test('/api/csrf still answers — it is matched before the gate and must not hit a TDZ', async () => {
    const r = await fetch(`http://127.0.0.1:${on.localPort}/api/csrf`);
    assert.equal(r.status, 200);
    assert.ok((await r.json()).token, 'a CSRF token must come back, not a ReferenceError 500');
  });

  test('a browser gets a BRANDED error page; a client still gets JSON', async () => {
    const html = await fetch(`http://127.0.0.1:${bare.localPort}/definitely-not-a-route`, {
      headers: { Accept: 'text/html' },
    });
    assert.equal(html.status, 404);
    const body = await html.text();
    // fact: this asserted /cw-wordmark/ — the FILENAME of whichever image was the mark that week
    // / a brand assertion keyed to an asset path fails the moment the brand legitimately changes,
    // and it fails as 'the branded shell is missing' when the shell is present and simply set
    // differently, which sends the reader to the wrong place (expiry: never, prev: wrong)
    assert.match(body, /class="mark"/, 'the branded shell must be present');
    assert.match(body, /<span class="wordmark">commitwork<\/span>/,
      'the mark must carry the name as text — an image alone leaves the page unnamed if it 404s');
    assert.match(body, /Not found/);
    assert.match(body, /Back to the panel/, 'an error page must offer a way out');

    const json = await fetch(`http://127.0.0.1:${bare.localPort}/definitely-not-a-route`);
    assert.equal(json.status, 404);
    assert.deepEqual(await json.json(), { error: 'not found' }, 'the machine contract is unchanged');
  });

  test('the refusal names the OPERATOR port, not the published one that just refused', async () => {
    // The published port is external by definition, so the refusal must name the port that works.
    const origin = `http://127.0.0.1:${off.port}`;
    const { token } = await fetch(`${origin}/api/csrf`).then((r) => r.json());
    const r = await fetch(`${origin}/auth/sso/external`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cw-csrf': token, Origin: origin },
      body: JSON.stringify({ enabled: true }),
    });
    const body = await r.text();
    assert.equal(/CSRF/.test(body), false, `the CSRF gate answered instead of the handler: ${body}`);
    assert.equal(r.status, 403, 'changing the switch from the published port must be refused');
    assert.match(body, new RegExp(`127\\.0\\.0\\.1:${off.localPort}\\b`),
      `the refusal must name the operator port ${off.localPort} — the only one where this succeeds`);
  });
});
