// admin/serve.mjs — the zero-user posture (R8a) and the auth cost governor (R8b).
// Route tests against a really-spawned panel; CW_AUTH_STORE points at a temp store.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-posture-'));
const STORE = join(TMP, 'users.json');

// A real published hostname — the gate's job is to distinguish it from localhost.
const PUBLIC_HOST = 'commitwork.portll.net';

// port = published (tunnel-routed, never privileged); localPort = operator-only (locality proof).
let port, localPort, child, csrf;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// Raw HTTP so the Host header can be set independently of the connection target (fetch cannot).
function hit(path, { method = 'GET', host = 'localhost', headers = {}, body = null, operator = false } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: `${host}`, ...headers };
    if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
    const req = request({ host: '127.0.0.1', port: operator ? localPort : port, path, method, headers: h }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* html or empty */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// Spread opts first so caller-supplied headers cannot drop the CSRF token.
const post = (path, payload, opts = {}) =>
  hit(path, { ...opts, method: 'POST', body: JSON.stringify(payload), headers: { 'x-cw-csrf': csrf, ...(opts.headers || {}) } });

// Retried on fresh ports — freePort() cannot hand a port over atomically, so the race is absorbed.
const BOOT_ATTEMPTS = 3;
before(async () => {
  let lastErr = '';
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt++) {
    // fresh ports per attempt — reusing a stolen one would just fail again
    port = await freePort();
    localPort = await freePort();
    let err = '';
    child = spawn(process.execPath, [SERVE], {
      env: { ...process.env, CW_AUTH_STORE: STORE, CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (d) => { err += String(d); });
    for (let i = 0; i < 100; i++) {
      try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; break; } } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (csrf) return;
    child.kill('SIGKILL');
    lastErr = err;
  }
  assert.ok(csrf, `panel did not come up in ${BOOT_ATTEMPTS} attempts on fresh ports each time`
    + (lastErr ? ` — last child stderr:\n${lastErr}` : ' — child produced no stderr'));
});

after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

// ── R8a: with zero operators, a remote caller gets nothing ──────────────────────────────────

test('an unbootstrapped panel refuses a REMOTE data route with 503, not 200', async () => {
  const r = await hit('/api/state', { host: PUBLIC_HOST });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /unbootstrapped/);
});

test('an unbootstrapped panel refuses the REMOTE credential routes — the /auth/ exemption does not apply', async () => {
  // Each costs a scrypt, and /auth/totp/confirm mutates credential state.
  for (const path of ['/auth/login', '/auth/totp/confirm', '/auth/bootstrap']) {
    const r = await post(path, { email: 'someone@example.com', password: 'x'.repeat(12), token: '000000' }, { host: PUBLIC_HOST });
    assert.equal(r.status, 503, `${path} must be refused remotely while zero users exist (got ${r.status})`);
  }
});

test('a remote browser gets the "no account yet" page, not a bare error', async () => {
  const r = await hit('/', { host: PUBLIC_HOST, headers: { accept: 'text/html' } });
  assert.equal(r.status, 503);
  assert.match(r.body, /No account yet/);
  // It must not leak an operator address or tell a stranger which accounts exist.
  assert.doesNotMatch(r.body, /@[a-z0-9-]+\.[a-z]{2,}/i, 'the unbootstrapped page must not disclose an address');
});

test('LOCAL access is ungated WHILE UNBOOTSTRAPPED — the window that creates the first account', async () => {
  // The title used to read "LOCAL access is never gated — that is the documented design, and the
  // way back in", and it asserted the same 200 for the same reason: gating loopback would lock the
  // operator out. That was true when there was no other way in. It stopped being true once
  // passkeys, SSO, recovery codes and bin/panel-breakglass.mjs existed, and the claim outlived the
  // condition that justified it — so the panel served EVERY route to any process that could open a
  // socket on the box, for as long as an account existed.
  //
  // This suite runs with ZERO users, which is the half that still holds and is asserted here: while
  // no account exists no session is obtainable, so demanding one would protect nothing and would
  // break the only path to creating the first one.
  //
  // The other half — that loopback IS gated once an account exists — is asserted in
  // admin/test/local-not-trusted.test.mjs, because it needs a store this suite deliberately does
  // not have.
  const r = await hit('/api/state', { host: 'localhost', operator: true });
  assert.equal(r.status, 200,
    'the bootstrap window must stay open on the operator port, or the first account cannot be made');
});

// ── R6b: locality is a property of the SOCKET, not of a header ──────────────────────────────

test('commitwork.local is local on the operator port and remote on the published one', async () => {
  // bin/panel-local-name.mjs maps the name to 127.0.0.1 and redirects loopback :80 to the operator
  // port, so the browser sends Host: commitwork.local with no port. The name narrows the port's
  // proof and never stands in for it.
  assert.equal((await hit('/api/state', { host: 'commitwork.local', operator: true })).status, 200);
  assert.equal((await hit('/api/state', { host: 'commitwork.local' })).status, 503);
  const boot = await post('/auth/bootstrap', { email: 'attacker@example.com', password: 'x'.repeat(14) }, { host: 'commitwork.local' });
  assert.equal(boot.status, 503, 'bootstrap minting stays closed to the published port under the local name');
});

test('a forged Host: localhost on the PUBLISHED port confers nothing', async () => {
  // The PORT decides locality — cloudflared dials from 127.0.0.1, so neither Host nor socket
  // address distinguishes a tunnelled request from a local one.
  const r = await hit('/api/state', { host: 'localhost' });   // published port, loopback Host
  assert.notEqual(r.status, 200, 'a loopback Host on the published port must not be privileged');
  assert.equal(r.status, 503, 'while zero users exist it is the unbootstrapped refusal');
});

test('the loopback-ONLY routes refuse a forged Host on the published port', async () => {
  // One mints the first operator, the other opens remote sign-in; both isLoopbackReq-guarded.
  const boot = await post('/auth/bootstrap', { email: 'attacker@example.com', password: 'x'.repeat(14) }, { host: 'localhost' });
  assert.notEqual(boot.status, 200, 'bootstrap must never be reachable on the published port');
  const sso = await post('/auth/sso/external', { enabled: true }, { host: 'localhost' });
  assert.notEqual(sso.status, 200, 'the external-SSO toggle must never be reachable on the published port');
});

// ── R8b: the cost governor ──────────────────────────────────────────────────────────────────

test('a remote credential spray is throttled with 429 + Retry-After, before any scrypt runs', async () => {
  // Bootstrap first so the limiter, not the R8a gate, does the refusing.
  const boot = await post('/auth/bootstrap', { email: 'op@example.com', password: 'correct horse battery' }, { host: 'localhost', operator: true });
  assert.equal(boot.status, 200, `bootstrap should succeed over loopback: ${boot.body}`);

  // Remote is now 401 rather than 503 — the zero-user posture lifts once an operator exists.
  const gated = await hit('/api/state', { host: PUBLIC_HOST });
  assert.equal(gated.status, 401, 'once an operator exists the posture is "authenticate", not "unbootstrapped"');

  // Spray from one source. AUTH_MAX_ATTEMPTS is 10 per 15-minute window.
  const ip = '203.0.113.9';
  const codes = [];
  const cost = { 401: [], 429: [] };   // per-attempt wall time, bucketed by what came back
  for (let i = 0; i < 14; i++) {
    const t = Date.now();
    const r = await post('/auth/login', { email: 'op@example.com', password: `wrong-${i}` },
      { host: PUBLIC_HOST, headers: { 'x-cw-csrf': csrf, 'cf-connecting-ip': ip } });
    const dt = Date.now() - t;
    codes.push(r.status);
    if (cost[r.status]) cost[r.status].push(dt);
    if (r.status === 429) {
      assert.ok(r.headers['retry-after'], '429 must carry Retry-After so a client can back off correctly');
      // one more, to have a second throttled sample and to prove the refusal is stable
      const t2 = Date.now();
      const again = await post('/auth/login', { email: 'op@example.com', password: 'wrong-again' },
        { host: PUBLIC_HOST, headers: { 'x-cw-csrf': csrf, 'cf-connecting-ip': ip } });
      if (again.status === 429) cost[429].push(Date.now() - t2);
      break;
    }
  }
  assert.ok(codes.includes(429), `expected a 429 within 14 attempts, got ${JSON.stringify(codes)}`);
  assert.ok(codes.filter((c) => c === 401).length <= 10, 'no more than AUTH_MAX_ATTEMPTS may reach the KDF');

  // Compare FASTEST samples, as a ratio — contention only adds time, so minima self-calibrate;
  // a limiter running after the KDF would raise min(refused) to meet min(hashed).
  const fastest = (xs) => Math.min(...xs);
  assert.ok(cost[401].length && cost[429].length,
    `need both an accepted and a throttled sample to compare, got ${JSON.stringify(codes)}`);
  const hashed = fastest(cost[401]);
  const refused = fastest(cost[429]);
  // 3x, not a tight bound: the gap under test is order-of-magnitude (no-KDF vs KDF).
  assert.ok(refused * 3 < hashed || refused <= 5,
    `a throttled attempt must not pay a scrypt: refused fastest ${refused}ms vs hashed fastest ${hashed}ms — `
    + 'if these are comparable, the rate limit is being checked after the KDF rather than before it');
});

test('a DIFFERENT source is unaffected — the limiter is keyed on origin, never on the account', async () => {
  // Keying on the email would let anyone lock the operator out by spraying their address.
  const r = await post('/auth/login', { email: 'op@example.com', password: 'still wrong' },
    { host: PUBLIC_HOST, headers: { 'x-cw-csrf': csrf, 'cf-connecting-ip': '198.51.100.4' } });
  assert.equal(r.status, 401, 'a fresh source must get a real answer, not the neighbour\'s lockout');
});

test('the operator can still log in from the box while a remote source is locked out', async () => {
  const r = await post('/auth/login', { email: 'op@example.com', password: 'correct horse battery' }, { host: 'localhost', operator: true });
  assert.equal(r.status, 200, `local login must survive a remote spray: ${r.body}`);
  assert.match(String(r.headers['set-cookie'] || ''), /cw_admin_sid=/);
});
