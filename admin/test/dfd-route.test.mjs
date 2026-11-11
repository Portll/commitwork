// admin/routes/dfd.mjs over a really-spawned panel: the page and the document sit behind the login
// gate, and a signed-in request gets the page under its own hash-pinned policy. CW_AUTH_STORE /
// CW_REGISTRY / CW_DFD_FILE point at temp files and the synthetic fixture.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const FIXTURE = join(HERE, '..', '..', 'lib', 'test', 'fixtures', 'dfd-synthetic.json');
const TMP = mkdtempSync(join(tmpdir(), 'cw-dfd-route-'));

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

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
  }));
  mkdirSync(join(TMP, 'src'), { recursive: true });

  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    port = await freePort();
    localPort = await freePort();
    let err = '';
    child = spawn(process.execPath, [SERVE], {
      env: {
        ...process.env,
        CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'), CW_DFD_FILE: FIXTURE,
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
  // a user must exist first: with none, the zero-user posture refuses every remote caller before the gate
  const boot = await post('/auth/bootstrap', { email: 'op@example.com', password: 'correct horse battery' });
  assert.equal(boot.status, 200, `bootstrap failed: ${boot.body}`);
  const login = await post('/auth/login', { email: 'op@example.com', password: 'correct horse battery' });
  assert.equal(login.status, 200, `login failed: ${login.body}`);
  cookie = String(login.headers['set-cookie'] || '').split(';')[0];
  assert.ok(cookie, 'login set no cookie');
});

after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

describe('dfd route — gated', () => {
  test('without a session the published port answers neither the page nor the document', async () => {
    // arrange
    const paths = ['/dfd/', '/api/dfd'];

    // act
    const rs = await Promise.all(paths.map((p) => hit(p, { operator: false })));

    // assert
    for (const r of rs) {
      assert.notEqual(r.status, 200);
      assert.doesNotMatch(r.body, /<svg class="dfd"|"kind":"dfd"/);
    }
  });
});

describe('dfd route — signed in', () => {
  test('GET /dfd/ serves the diagram under the page\'s own hash-pinned CSP', async () => {
    // arrange
    const path = '/dfd/?orientation=TB';

    // act
    const r = await hit(path, { operator: false, auth: true });

    // assert
    assert.equal(r.status, 200, r.body.slice(0, 200));
    assert.match(r.body, /<svg class="dfd"/);
    assert.match(r.headers['content-security-policy'], /^default-src 'none'; style-src 'sha256-[^']+'; script-src 'sha256-[^']+'; img-src data:; font-src 'self'/);
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'self'$/);
    assert.equal(r.headers['cache-control'], 'no-store');
  });

  test('GET /api/dfd returns the dfd@1 document, filtered by the query', async () => {
    // arrange
    const path = '/api/dfd?prefix=val&hops=0';

    // act
    const r = await hit(path, { operator: false, auth: true });

    // assert
    assert.equal(r.status, 200, r.body.slice(0, 200));
    assert.equal(r.json.kind, 'dfd');
    assert.deepEqual(r.json.nodes.map((nd) => nd.id), ['validate']);
  });
});
