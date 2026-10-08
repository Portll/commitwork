// The REAL server, both wiring directions of the docsite carve-out:
//   (1) a declared-Origin /api/docsite/* request bypasses the same-host CSRF gate and still hits
//       the session gate — the bypass is not an authentication bypass;
//   (2) a PANEL route offered the same declared Origin without x-cw-csrf is still refused — the
//       carve-out does not leak past /api/docsite/*;
//   (3) host isolation both ways — the docsite hostname serves the docsite index, every other
//       host still gets the panel;
//   (4) the operator port can complete a full save end-to-end (csrf token + loopback privilege),
//       and the served page survives multi-byte content intact (responses are read with
//       Buffer.concat then ONE decode — the per-chunk-decode corruption trap).
// Requests use node:http, never fetch: Host is a forbidden fetch header.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// MUST be set before the server child below spawns: handleSave (and the sync/state/reorder/
// restore routes) each call rebuildAndDeploy(), which — unless this is set — runs a REAL
// `wrangler pages deploy` against the real production project. Spread into the child's env below
// via `...process.env`, so setting it here at module load protects that child too. Measured
// 2026-08-29: this file's "operator-port save, end to end" test live-deployed fixture content to
// i.commitwork.online before this line existed.
process.env.CW_DOCSITE_SKIP_DEPLOY = '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURE = join(REPO, 'bin', 'test', 'fixtures', 'docsite');
const ALPHA_UUID = '0a1b2c3d-1111-4222-8333-444455556666';
const PORT = 17931;
const OP_PORT = 17932;
const DOCSITE_HOST = 'i.docsite.test';
const ORIGIN = `https://${DOCSITE_HOST}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');

let child = null;
let root = null;

const request = ({ port = PORT, method = 'GET', path = '/', host = 'localhost', headers = {}, body }) => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (r) => {
    const chunks = [];
    r.on('data', (d) => chunks.push(d));
    r.on('end', () => res({ code: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', rej);
  if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
  req.end();
});

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'cw-docsite-stest-'));
  cpSync(FIXTURE, root, { recursive: true });
  execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-build.mjs')], { env: { ...process.env, CW_DOCSITE_ROOT: root }, stdio: 'pipe' });
  child = spawn(process.execPath, [join(REPO, 'admin', 'serve.mjs')], {
    cwd: REPO,
    env: {
      ...process.env,
      CW_ADMIN_PORT: String(PORT), CW_ADMIN_LOCAL_PORT: String(OP_PORT),
      CW_DOCSITE_ROOT: root, CW_DOCSITE_HOSTS: DOCSITE_HOST, CW_DOCSITE_ORIGINS: ORIGIN,
      // The AUTH STORE gets the same treatment as the registry below, and for the same reason:
      // unpinned, this test read the operator's real ~/.commitwork/users.json, so whether it passed
      // depended on whether the machine running it happens to have an account. An unwritten path
      // leaves the panel unbootstrapped, which is the state these docsite routing assertions mean
      // to exercise.
      CW_AUTH_STORE: join(root, 'users.json'),
      // The server must boot from a fixture registry — a test that reads the operator's live
      // declaration measures the operator's machine, not the code (and fails when it is absent,
      // as it was 2026-08-27).
      CW_REGISTRY: join(REPO, 'monitor', 'projects.example.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not report listening within 15s')), 15_000);
    let seen = '';
    child.stdout.on('data', (d) => { seen += d; if (seen.includes('commitwork operator')) { clearTimeout(t); res(); } });
    child.on('exit', (c) => rej(new Error(`server exited early (${c})`)));
  });
});

after(() => { if (child) child.kill('SIGKILL'); });

describe('docsite carve-out, both directions (real server)', () => {
  test('declared-Origin docsite POST bypasses same-host CSRF but NOT the session gate', async () => {
    const r = await request({
      method: 'POST', path: '/api/docsite/save', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: { slug: 'alpha', content: '# x', baseHash: sha('y') },
    });
    assert.equal(r.code, 401, `expected the SESSION refusal, got ${r.code}: ${r.body.slice(0, 200)}`);
  });

  test('undeclared-Origin docsite POST is CSRF-refused like any panel route', async () => {
    const r = await request({
      method: 'POST', path: '/api/docsite/save', headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: { slug: 'alpha', content: '# x', baseHash: sha('y') },
    });
    assert.equal(r.code, 403);
    assert.match(r.body, /CSRF/);
  });

  test('the carve-out does not leak: a PANEL route with the declared Origin is still CSRF-refused', async () => {
    const r = await request({
      method: 'POST', path: '/api/annotations/scanner', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: {},
    });
    assert.equal(r.code, 403);
    assert.match(r.body, /CSRF/);
  });

  test('preflight: declared origin 204 with exact-origin headers, undeclared 403', async () => {
    const ok = await request({ method: 'OPTIONS', path: '/api/docsite/save', headers: { origin: ORIGIN } });
    assert.equal(ok.code, 204);
    assert.equal(ok.headers['access-control-allow-origin'], ORIGIN);
    const bad = await request({ method: 'OPTIONS', path: '/api/docsite/save', headers: { origin: 'https://evil.example' } });
    assert.equal(bad.code, 403);
  });
});

describe('host isolation (real server)', () => {
  test('docsite hostname serves the docsite index; other hosts get the panel', async () => {
    const docsite = await request({ host: DOCSITE_HOST, path: '/' });
    assert.equal(docsite.code, 200);
    assert.ok(docsite.body.includes('Documents'), 'docsite index on the docsite host');
    const panel = await request({ host: 'localhost', path: '/' });
    assert.ok(!panel.body.includes('doclist'), 'panel host must not serve the docsite index');
  });

  test('a doc page serves on the docsite host with multi-byte content intact', async () => {
    const r = await request({ host: DOCSITE_HOST, path: `/${ALPHA_UUID}/` });
    assert.equal(r.code, 200);
    assert.ok(r.body.includes('✓ Ünïcode — 多字節'), 'multi-byte marker must survive transport');
    assert.ok(r.headers.etag, 'etag present for revalidation');
  });

  test('the editor page serves on the docsite host with a same-origin api base', async () => {
    const r = await request({ host: DOCSITE_HOST, path: '/edit' });
    assert.equal(r.code, 200);
    assert.ok(r.body.includes('cw-api-base'));
    assert.ok(!r.body.includes('__CW_API_BASE__'), 'placeholder substituted');
  });
});

describe('operator-port save, end to end (real server)', () => {
  test('csrf token + loopback privilege completes a save and regenerates the page', async () => {
    const tok = JSON.parse((await request({ port: OP_PORT, path: '/api/csrf' })).body).token;
    const before = readFileSync(join(root, 'content', 'alpha.md'), 'utf8');
    const next = `${before}\nSaved through the real server. ✓\n`;
    const r = await request({
      port: OP_PORT, method: 'POST', path: '/api/docsite/save',
      headers: { 'x-cw-csrf': tok, 'content-type': 'application/json' },
      body: { slug: 'alpha', content: next, baseHash: sha(before) },
    });
    assert.equal(r.code, 200, r.body.slice(0, 300));
    assert.equal(JSON.parse(r.body).newHash, sha(next));
    assert.equal(readFileSync(join(root, 'content', 'alpha.md'), 'utf8'), next);
    const page = await request({ host: DOCSITE_HOST, path: `/${ALPHA_UUID}/` });
    assert.ok(page.body.includes('Saved through the real server. ✓'), 'the public page is already regenerated');
  });
});
