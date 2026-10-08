// admin/routes/launchlist.mjs over a really-spawned panel: the page and the API sit behind the
// login gate, a launchlist hostname opens on the checklist at `/`, and a tick is attributed to the
// session that made it. CW_AUTH_STORE / CW_REGISTRY / CW_LAUNCHLIST_DIR point at temp files.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-launchlist-route-'));
const STORE = join(TMP, 'launchlist');
const HOST = 'launchlist.fixture.test';

let port, localPort, child, csrf, cookie = '';

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

function hit(path, { method = 'GET', headers = {}, body = null, operator = true, auth = false } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: 'localhost', ...headers };
    if (auth && cookie) h.cookie = cookie;
    if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
    const req = request({ host: '127.0.0.1', port: operator ? localPort : port, path, method, headers: h }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, body: buf, json }); });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
const post = (path, payload, opts = {}) =>
  hit(path, { ...opts, method: 'POST', body: JSON.stringify(payload), headers: { 'x-cw-csrf': csrf, ...(opts.headers || {}) } });
const state = () => (existsSync(join(STORE, 'state.json')) ? JSON.parse(readFileSync(join(STORE, 'state.json'), 'utf8')) : null);

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
  }));
  mkdirSync(join(TMP, 'src'), { recursive: true });
  mkdirSync(STORE, { recursive: true });
  writeFileSync(join(STORE, 'config.json'), JSON.stringify({ projects: { fixrepo: { profiles: ['featureset'] } } }));

  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    port = await freePort();
    localPort = await freePort();
    let err = '';
    child = spawn(process.execPath, [SERVE], {
      env: {
        ...process.env,
        CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
        CW_LAUNCHLIST_DIR: STORE, CW_LAUNCHLIST_HOSTS: HOST,
        CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (d) => { err += String(d); });
    for (let i = 0; i < 100 && !csrf; i++) {
      try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; break; } } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (csrf) break;
    child.kill('SIGKILL');
    lastErr = err;
  }
  assert.ok(csrf, `panel did not come up${lastErr ? ` — last child stderr:\n${lastErr}` : ''}`);
  // A user must exist first: with none, the zero-user posture refuses every remote caller before
  // the login gate, and these tests would prove that posture instead of the gate.
  const boot = await post('/auth/bootstrap', { email: 'op@example.com', password: 'correct horse battery' });
  assert.equal(boot.status, 200, `bootstrap failed: ${boot.body}`);
  const login = await post('/auth/login', { email: 'op@example.com', password: 'correct horse battery' });
  assert.equal(login.status, 200, `login failed: ${login.body}`);
  cookie = String(login.headers['set-cookie'] || '').split(';')[0];
  assert.ok(cookie, 'login set no cookie');
});

after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

describe('launchlist route — gated', () => {
  test('the published port answers the launchlist hostname with the login gate, not the checklist', async () => {
    const r = await hit('/', { operator: false, headers: { host: HOST } });
    assert.notEqual(r.status, 200);
    assert.ok(!r.body.includes('launchlist-data'), 'no checklist content before a session exists');
  });

  test('an anonymous tick is refused and writes nothing', async () => {
    const r = await post('/api/launchlist/tick', { project: 'fixrepo', item: 'feat.census' }, { operator: false, headers: { host: HOST, origin: `http://${HOST}` } });
    assert.ok([401, 403].includes(r.status), `got ${r.status}`);
    assert.equal(state(), null);
  });
});

describe('launchlist route — signed in', () => {
  test('GET /launchlist/ serves the interactive page under a hash-pinned CSP', async () => {
    const r = await hit('/launchlist/', { auth: true });
    assert.equal(r.status, 200);
    assert.match(r.body, /"interactive":true/);
    assert.match(r.body, /feat\.census/);
    assert.match(r.headers['content-security-policy'], /default-src 'none'; style-src 'sha256-/);
    assert.equal(r.headers['cache-control'], 'no-store');
  });

  test('with a session, `/` on the launchlist hostname is the checklist and `/` elsewhere is not', async () => {
    const ll = await hit('/', { operator: false, auth: true, headers: { host: HOST } });
    assert.equal(ll.status, 200, ll.body.slice(0, 200));
    assert.match(ll.body, /id="launchlist-data"/);
    const panel = await hit('/', { auth: true });
    assert.ok(!panel.body.includes('id="launchlist-data"'), 'the panel host keeps its own home page');
  });

  test('GET /api/launchlist returns the evaluated model', async () => {
    const r = await hit('/api/launchlist', { auth: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.projects.map((p) => p.project), ['fixrepo']);
    assert.equal(r.json.projects[0].summary.openHard, 3);
  });

  test('a tick is recorded against the session identity; an unknown item is 404', async () => {
    const r = await post('/api/launchlist/tick', { project: 'fixrepo', item: 'feat.census', state: 'done', note: 'ran it' }, { auth: true });
    assert.equal(r.status, 200, r.body);
    const t = state().ticks.fixrepo['feat.census'];
    assert.match(t.by, /^op@example\.com/);
    assert.equal(t.note, 'ran it');
    const miss = await post('/api/launchlist/tick', { project: 'fixrepo', item: 'no.such' }, { auth: true });
    assert.equal(miss.status, 404);
    const bad = await post('/api/launchlist/tick', { project: '../x', item: 'feat.census' }, { auth: true });
    assert.equal(bad.status, 400);
  });

  test('a tick without the CSRF header is refused before the route', async () => {
    const r = await hit('/api/launchlist/tick', { method: 'POST', auth: true, body: JSON.stringify({ project: 'fixrepo', item: 'feat.core' }) });
    assert.equal(r.status, 403);
  });
});
