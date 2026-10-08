// The SECOND witness for the auth gate, and it cannot share the first's failure mode.
//
// route-auth.test.mjs reads serve.mjs and asserts the ORDER — modular dispatch sits after the login
// gate. That is a source claim. It would still pass if the gate were reached and then answered
// wrongly, or if a route registered somewhere the source scan does not look. This one boots a real
// panel on the published port and asks it.
//
// The bypass this guards was live on 2026-08-25: /api/report/states, /api/report/evidence,
// /api/posture and /api/a11y each answered 200 with real content to a caller holding no session,
// because modular routes dispatched BEFORE the gate and each route was left to check for itself.
// admin/routes/report.mjs contained no session helper at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, request as httpRequest } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-routeauth-'));
const WT = join(TMP, 'wt');

let child; let port; let localPort; let up = false;

const freePort = () => new Promise((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); });
});

// The PUBLISHED port. Loopback privilege is keyed to the operator port's socket, so asking on that
// one would measure the exemption rather than the gate.
const pub = (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: 'manual' });

before(async () => {
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '-q', '--detach', WT, 'HEAD'], { stdio: 'pipe' });
  cpSync(join(REPO, 'admin'), join(WT, 'admin'), { recursive: true, force: true });
  cpSync(join(REPO, 'monitor'), join(WT, 'monitor'), { recursive: true, force: true });

  mkdirSync(join(TMP, 'src'), { recursive: true });
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
  }));
  // A user EXISTS, so the panel is past bootstrap. Without one the zero-user posture refuses
  // everything for a different reason and every assertion below would pass without testing the gate.
  writeFileSync(join(TMP, 'users.json'), JSON.stringify({ version: 1, users: [{ email: 'op@example.test', role: 'admin', pwHash: 'x', createdAt: new Date().toISOString() }] }));

  port = await freePort(); localPort = await freePort();
  let err = '';
  child = spawn(process.execPath, [join(WT, 'admin', 'serve.mjs')], {
    env: { ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => { err += String(d); });
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await pub('/api/csrf'); if (r.status) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, `panel did not come up${err ? ` — child stderr:\n${err}` : ''}`);
});

after(() => {
  child?.kill('SIGKILL');
  try { execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', WT], { stdio: 'pipe' }); } catch { /* best effort */ }
  rmSync(TMP, { recursive: true, force: true });
});

// The exact four that leaked, by name, so a regression names itself.
const LEAKED = ['/api/report/states', '/api/report/evidence', '/api/posture', '/api/a11y'];

test('the four endpoints that leaked in 2026-08-25 refuse an unauthenticated caller', async () => {
  for (const p of LEAKED) {
    const r = await pub(p);
    assert.equal(r.status, 401, `${p} answered ${r.status} without a session — this is the bypass, live again`);
  }
});

test('and they refuse with a REFUSAL, not with data that happens to be empty', async () => {
  // A 200 carrying {absent:true} would be the false-clean version of the same bug: the caller learns
  // the fleet's shape from a panel that never authenticated them.
  for (const p of LEAKED) {
    const r = await pub(p);
    const body = await r.text();
    assert.ok(!/"(states|findings|repos|scanners)"\s*:/.test(body),
      `${p} returned a data-shaped body to an anonymous caller`);
  }
});

test('a route that already guarded itself still refuses — the control arm', async () => {
  const r = await pub('/api/projects/tree');
  assert.equal(r.status, 401, 'if this one stopped refusing, the gate moved rather than the routes being fixed');
});

test('THE OTHER DIRECTION: the login page still renders anonymously', async () => {
  // An over-broad gate locks the operator out of a published panel with no loopback path. This is
  // the assertion that makes the four above safe to tighten.
  const r = await pub('/', { accept: 'text/html' });
  assert.equal(r.status, 200, 'the login page must be reachable without a session, or nobody can ever sign in');
  const html = await r.text();
  assert.match(html, /Sign in/, 'a 200 that is not the login page is not the same guarantee');
});

test('the login page assets it references are reachable too', async () => {
  for (const a of ['/static/panel.css', '/static/theme-switch.js', '/cw-favicon.svg']) {
    const r = await pub(a);
    assert.notEqual(r.status, 401, `${a} is referenced by the anonymous login page and must not require a session`);
  }
});

// fact: fetch normalises dot segments, raw http does not
const raw = (path) => new Promise((res, rej) => {
  const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (r) => {
    let body = '';
    r.on('data', (d) => { body += d; });
    r.on('end', () => res({ status: r.statusCode, body }));
  });
  req.on('error', rej);
  req.end();
});

test('a dot-segment path under /auth/ never reaches a gated route', async () => {
  const paths = ['/auth/../api/state', '/auth/%2e%2e/api/state', '/auth/..%2fapi/state', '/auth/./../api/report/states'];
  for (const p of paths) {
    const r = await raw(p);
    assert.ok(r.status === 401 || r.status === 404, `${p} answered ${r.status} — the login check and the router disagree on the path`);
    assert.ok(!/"(states|findings|repos|scanners|areas)"\s*:/.test(r.body), `${p} returned a data-shaped body`);
  }
});

test('the raw client is a real witness: an undotted gated path refuses', async () => {
  assert.equal((await raw('/api/state')).status, 401);
});
