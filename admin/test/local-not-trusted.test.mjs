// LOCAL ORIGIN IS NOT IDENTITY — the half that admin/test/bootstrap-posture.test.mjs cannot assert.
//
// That suite runs with ZERO users, which is exactly the state where the loopback exemption is
// correct: no session is obtainable, so demanding one would protect nothing and would break the
// only path to a first account. It therefore cannot test what happens once an account EXISTS —
// which is the case the change of 2026-09-02 is about.
//
// Until then a panel with an operator account served every route to anything that could open a
// socket on the box: any process the operator runs, any dependency's postinstall, any page that can
// POST a form. The port check is excellent evidence of ORIGIN — a socket property no caller can
// assert, on a port verified unroutable at boot — and no evidence at all of IDENTITY.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

// Pin the store BEFORE auth.mjs loads — see admin/test/store-path-call-time.test.mjs.
const TMP = mkdtempSync(join(tmpdir(), 'cw-localtrust-'));
process.env.CW_AUTH_STORE = join(TMP, 'users.json');
const { bootstrapRoot } = await import('../auth.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const EMAIL = 'op@example.com';
const PASSWORD = 'correct horse battery staple';

let child, localPort, publicPort;

const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

/** `operator: true` hits the OPERATOR port — the one that used to confer access by itself. */
const hit = (path, { operator = true, headers = {}, method = 'GET' } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: operator ? localPort : publicPort, path, method,
    headers: { host: 'localhost', ...headers } }, (r) => {
    let buf = '';
    r.setEncoding('utf8');
    r.on('data', (d) => { buf += d; });
    r.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ }
      resolve({ status: r.statusCode, body: buf, json, headers: r.headers }); });
  });
  req.on('error', reject);
  req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  // AN ACCOUNT EXISTS. That single fact is what this suite is for.
  bootstrapRoot({ email: EMAIL, password: PASSWORD });

  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'a', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'a', label: 'a', out: 'a', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'a'), { recursive: true });

  publicPort = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(publicPort), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status) up = true; } catch { /* not yet */ }
    if (!up) await sleep(100);
  }
  assert.ok(up, 'panel did not come up');
});

after(() => { if (child) child.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

describe('with an account, the operator port confers nothing on its own', () => {
  test('an unauthenticated API call on LOOPBACK is refused', async () => {
    // This is the whole change. Before 2026-09-02 this answered 200 with the fleet's state.
    const r = await hit('/api/state');
    assert.equal(r.status, 401, 'local origin still admitted an unauthenticated caller');
    assert.ok(!/"scanners"/.test(r.body), 'and it must not leak the payload alongside the refusal');
  });

  test('the published port behaves identically — the two ports agree now', async () => {
    const r = await hit('/api/state', { operator: false });
    assert.equal(r.status, 401);
  });

  test('a browser on loopback gets the LOGIN PAGE, not a bare 401', async () => {
    // The refusal must be a door, not a wall: an operator opening the panel locally should be able
    // to sign in from what they are shown.
    const r = await hit('/', { headers: { accept: 'text/html' } });
    assert.equal(r.status, 200);
    assert.match(r.body, /name="password"/, 'the page served must be one that can sign you in');
  });

  test('signing in is still reachable — /auth/* is exempt, or the gate would be a lockout', async () => {
    const r = await hit('/api/csrf');
    assert.equal(r.status, 200, 'the CSRF token a login needs must be obtainable without a session');
  });
});

describe('the exemption is scoped to the bootstrap window, and that window is closed', () => {
  test('the panel is NOT unbootstrapped — so this suite is testing the case it claims to', async () => {
    // Without this the suite would pass vacuously against a userless panel, which is the state
    // bootstrap-posture.test.mjs covers and where 401 would mean something else entirely.
    const r = await hit('/', { headers: { accept: 'text/html' } });
    assert.ok(!/No account yet/.test(r.body),
      'the store is empty — these assertions would be about the bootstrap window, not about identity');
    assert.ok(!/Create the first account/.test(r.body));
  });
});
