// The BOLA tab's wire contract — GET /api/bola + POST /api/bola/run against a really-spawned
// panel: each declared area carries credential readiness (BLOCKED names the missing secrets) and
// the latest persisted run; run is 409 for an unready area, 400 for one with no bola block.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-bola-'));

let localPort, child, csrf;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path, opts = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
    let buf = ''; res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  if (opts.body) req.write(opts.body);
  req.end();
});

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixbola',
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [
      { slug: 'fixbola', label: 'FixBola', out: 'fixbola', primary: true,
        bola: { manifest: 'synthetic', base: 'http://127.0.0.1:8080' } },
      { slug: 'plain', label: 'Plain', out: 'plain' },
    ],
  }));
  // a synthetic manifest, aimed at through CW_BOLA_MANIFEST_DIR, so readiness never depends on
  // whichever client manifest the tree bundles
  const credential = (passwordEnv) => ({ type: 'keycloak', realm: 'fixture', client: 'fixture-web', username: 'x@example.test', passwordEnv });
  writeFileSync(join(TMP, 'synthetic.json'), JSON.stringify({
    repo: 'synthetic keycloak target',
    actors: [
      { name: 'anon', role: 'anon' },
      { name: 'userA', role: 'user', tenant: 'tenantA', credential: credential('BOLA_PASS_A') },
      { name: 'userB', role: 'user', tenant: 'tenantB', credential: credential('BOLA_PASS_B') },
      { name: 'adminA', role: 'admin', tenant: 'tenantA', credential: credential('BOLA_PASS_ADMIN_A') },
      { name: 'adminB', role: 'admin', tenant: 'tenantB', credential: credential('BOLA_PASS_ADMIN_B') },
    ],
    objects: { model: 'seed', types: [{ name: 'thing', create: { path: '/api/things', body: {} }, idPath: 'id', getPath: '/api/things/{id}' }] },
  }));
  // a persisted run for fixbola so the present path renders real evidence
  mkdirSync(join(TMP, 'reports', 'fixbola'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixbola', 'bola-latest.json'), JSON.stringify({
    tool: 'authz-bola', area: 'fixbola', base: 'http://127.0.0.1:8080', generatedAt: '2026-08-02T00:00:00.000Z',
    summary: { ran: true, verdict: 'POTENTIAL BOLA/BFLA — 2 finding(s)', findings: 2 },
    findings: [
      { type: 'bola', severity: 'critical', path: '/api/listings/1', attacker: 'userB', owner: 'userA', detail: 'peer read' },
      { type: 'bfla', severity: 'critical', path: '/api/listings/9', attacker: 'userA', owner: 'adminA', detail: 'vertical' },
    ],
    actors: [{ name: 'userA', role: 'user', tenant: 'tenantA', minted: true }, { name: 'anon', role: 'anon', tenant: 'default', minted: true }],
    voids: ['seed listing for adminB: create POST /api/listings returned HTTP 500'],
  }));

  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    // empty secrets file + no BOLA_PASS_* in env ⇒ fixbola is BLOCKED, which is the state under test
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_SECRETS_FILE: join(TMP, 'secrets.json'), CW_NOW: '2026-08-02T00:00:00.000Z', CW_BOLA_MANIFEST_DIR: TMP,
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
      BOLA_PASS_A: '', BOLA_PASS_B: '', BOLA_PASS_ADMIN_A: '', BOLA_PASS_ADMIN_B: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) { csrf = r.json.token; up = true; } } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

test('GET /api/bola presents declared areas with readiness + latest evidence', async () => {
  const r = await hit('/api/bola');
  assert.equal(r.status, 200);
  const areas = r.json.areas;
  assert.ok(Array.isArray(areas));
  const fix = areas.find((a) => a.slug === 'fixbola');
  assert.ok(fix, 'the declared area is present');
  assert.ok(!areas.some((a) => a.slug === 'plain'), 'an area without a bola block is not listed');

  // readiness: BLOCKED, with the missing secrets NAMED
  assert.equal(fix.readiness.ready, false);
  assert.deepEqual(fix.readiness.missing.map((m) => m.name).sort(),
    ['BOLA_PASS_A', 'BOLA_PASS_ADMIN_A', 'BOLA_PASS_ADMIN_B', 'BOLA_PASS_B'].sort());

  // evidence: the persisted run, surfaced
  assert.equal(fix.evidence.present, true);
  assert.equal(fix.evidence.findings.length, 2);
  assert.deepEqual(fix.evidence.findings.map((f) => f.type).sort(), ['bfla', 'bola']);
  assert.equal(fix.evidence.actors.length, 2);
  assert.equal(fix.evidence.voids.length, 1);
  assert.equal(fix.evidence.generatedAt, '2026-08-02T00:00:00.000Z');
});

test('POST /api/bola/run is refused (409) for a BLOCKED area', async () => {
  const r = await hit('/api/bola/run?project=fixbola', { method: 'POST', headers: { 'x-cw-csrf': csrf } });
  assert.equal(r.status, 409);
  assert.equal(r.json.started, false);
  assert.match(r.json.reason, /not configured|not yet stored/);
});

test('POST /api/bola/run is 400 for an area with no bola block', async () => {
  const r = await hit('/api/bola/run?project=plain', { method: 'POST', headers: { 'x-cw-csrf': csrf } });
  assert.equal(r.status, 400);
  assert.equal(r.json.started, false);
  assert.match(r.json.reason, /no bola block/);
});

test('POST /api/bola/run without CSRF is refused before any of this runs', async () => {
  const r = await hit('/api/bola/run?project=fixbola', { method: 'POST' });
  assert.equal(r.status, 403);
});
