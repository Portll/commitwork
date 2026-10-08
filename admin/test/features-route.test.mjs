// GET and POST /api/features through their handlers with the ctx the dispatcher builds (no `body`;
// a body arrives only through readJsonBody), then the dispatcher itself on a booted panel: a route
// in a switched-off group answers 404 naming the flag. What is asserted is the store on disk and
// the status a caller receives, never a marker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-features-route-'));
const STORE = join(TMP, 'settings.json');
const KEYS = ['HOME', 'CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_EXPERIMENTAL', 'CW_FEATURE_DOCSITE', 'CW_FEATURE_OFFBOX', 'CW_FC_CHARTER'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];
process.env.HOME = join(TMP, 'home');
process.env.CW_SETTINGS = STORE;

const { routes } = await import('../routes/features.mjs');
const { resetSettingsWarnings } = await import('../../monitor/settings.mjs');
const { sessionWho } = await import('../../monitor/attribution.mjs');

let child = null;
after(() => {
  child?.kill('SIGKILL');
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/features');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/features');
const SESSION = { user: 'op@example.test', provider: 'password' };

const call = (route, { body = {}, bodyErr = null, session = SESSION, loopback = false } = {}) =>
  new Promise((done) => {
    Promise.resolve(route.handle({
      req: {}, isLoopbackReq: loopback, adminSession: () => session,
      query: new URLSearchParams(),
      readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
      send: (code, payload) => done({ code, payload }),
    })).catch((e) => done({ code: 'threw', payload: String(e && e.message) }));
  });
const store = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : null);
const fresh = () => { rmSync(STORE, { force: true }); resetSettingsWarnings(); for (const k of ['CW_EXPERIMENTAL', 'CW_FEATURE_DOCSITE', 'CW_FEATURE_OFFBOX']) delete process.env[k]; };

test('no session off the operator port is 401 on both methods, and the store is not created', async () => {
  fresh();
  for (const route of [GET, POST]) {
    for (const session of [null, { provider: 'password' }]) {
      const r = await call(route, { session, body: { flag: 'docsite', on: false } });
      assert.equal(r.code, 401, `${route.method} session=${JSON.stringify(session)}`);
    }
  }
  assert.equal(store(), null);
});

test('GET: every flag ON by default, with the views and nav groups the panel hides when off', async () => {
  fresh();
  const r = await call(GET, { session: null, loopback: true });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.ok(r.payload.flags.length >= 10);
  assert.ok(r.payload.flags.every((f) => f.on && f.source === 'default'));
  const by = (id) => r.payload.flags.find((f) => f.id === id);
  assert.deepEqual(by('lanes-quality').navGroups, ['quality']);
  assert.deepEqual(by('agents').views, ['overwatch']);
});

test('POST switches one flag, stamps who, and the GET reflects it', async () => {
  fresh();
  const r = await call(POST, { body: { flag: 'docsite', on: false } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.flags.find((f) => f.id === 'docsite').on, false);
  const rec = store().settings.experimentalFeatures;
  assert.deepEqual(rec.value, { docsite: 'off' });
  assert.equal(rec.by, sessionWho(SESSION));
  const back = await call(POST, { session: null, loopback: true, body: { flag: 'docsite', on: true } });
  assert.equal(back.code, 200);
  assert.deepEqual(store().settings.experimentalFeatures.value, { docsite: 'on' });
  assert.equal(store().settings.experimentalFeatures.by, 'operator@loopback');
});

test('POST body validation: each malformed body is a 400 and writes nothing', async () => {
  fresh();
  const bad = [
    [{ body: null }, /send \{"flag"/],
    [{ body: [] }, /send \{"flag"/],
    [{ body: { flag: 'docsite' } }, /`on` must be true or false/],
    [{ body: { flag: 'docsite', on: 'off' } }, /`on` must be true or false/],
    [{ body: { flag: 7, on: true } }, /`flag` must be a flag id/],
    [{ body: { flag: 'no-such-flag', on: true } }, /not a flag in manifests\/feature-charter.json/],
    [{ body: { flag: 'docsite', on: true, extra: 1 } }, /unknown field\(s\): extra/],
    [{ bodyErr: 'invalid JSON' }, /invalid JSON/],
  ];
  for (const [opts, re] of bad) {
    const r = await call(POST, opts);
    assert.equal(r.code, 400, JSON.stringify(opts));
    assert.match(r.payload.error, re);
  }
  assert.equal(store(), null);
});

test('a write the env shadows is 409, naming the variable; the store is untouched', async () => {
  fresh();
  process.env.CW_FEATURE_DOCSITE = 'on';
  let r = await call(POST, { body: { flag: 'docsite', on: false } });
  assert.equal(r.code, 409);
  assert.match(r.payload.error, /CW_FEATURE_DOCSITE/);
  delete process.env.CW_FEATURE_DOCSITE;
  process.env.CW_EXPERIMENTAL = 'on';
  r = await call(POST, { body: { flag: 'docsite', on: false } });
  assert.equal(r.code, 409);
  assert.match(r.payload.error, /CW_EXPERIMENTAL/);
  assert.equal(store(), null);
});

test('an unreadable store answers GET (all ON, reported) and refuses POST with 503', async () => {
  fresh();
  writeFileSync(STORE, '{ not json');
  const g = await call(GET);
  assert.equal(g.code, 200);
  assert.match(g.payload.storeError, /unparseable JSON/);
  assert.ok(g.payload.flags.every((f) => f.on && f.source === 'corrupt-store-fallback'));
  const p = await call(POST, { body: { flag: 'docsite', on: false } });
  assert.equal(p.code, 503);
  assert.equal(readFileSync(STORE, 'utf8'), '{ not json');
});

// ── the dispatcher, on a booted panel ───────────────────────────────────────────────────────────
const freePort = () => new Promise((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

test('DISPATCHER: a route in a switched-off group answers 404 naming the flag; others are served', async () => {
  const home = join(TMP, 'boot-home');
  mkdirSync(join(TMP, 'src'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
  }));
  // No users: on the operator port that is the one state with no session to demand, so each answer
  // below is the flag gate's and never the login gate's.
  writeFileSync(join(TMP, 'users.json'), JSON.stringify({ version: 1, users: [] }));
  const bootStore = join(TMP, 'boot-settings.json');
  writeFileSync(bootStore, JSON.stringify({ v: 1, settings: { experimentalFeatures: { value: { launchlist: 'off' }, at: 'T', by: 'test' } } }));
  const port = await freePort();
  const localPort = await freePort();
  let err = '';
  child = spawn(process.execPath, [join(REPO, 'admin', 'serve.mjs')], {
    env: { ...process.env, HOME: home, CW_SETTINGS: bootStore, CW_FEATURE_OFFBOX: 'off',
      CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => { err += String(d); });
  const local = (p) => fetch(`http://127.0.0.1:${localPort}${p}`, { headers: { host: 'localhost' } });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try { const r = await local('/api/features'); if (r.status) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, `panel did not come up — stderr:\n${err}`);

  const off = await local('/api/launchlist');
  assert.equal(off.status, 404);
  const body = await off.json();
  assert.deepEqual([body.ok, body.flag, body.featureOff], [false, 'launchlist', true]);
  assert.match(body.error, /"launchlist".*switched off/);

  const envOff = await local('/offbox/');
  assert.equal(envOff.status, 404, 'an env-switched-off group is refused too');
  assert.match((await envOff.json()).error, /CW_FEATURE_OFFBOX/);

  const feats = await local('/api/features');
  assert.equal(feats.status, 200);
  const fj = await feats.json();
  assert.deepEqual(fj.flags.find((f) => f.id === 'launchlist').source, 'store');

  const on = await local('/api/docsite/list');
  assert.notEqual(on.status, 404, 'a group that is on is still served');
  const core = await local('/api/settings');
  assert.equal(core.status, 200, 'a core route is never gated');
});
