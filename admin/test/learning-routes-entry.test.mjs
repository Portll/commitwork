// GET /api/learning and POST /api/learning, invoked through their handlers with the ctx the
// dispatcher builds (admin/serve.mjs MODULAR_ROUTES loop): no `body` — a body arrives only through
// readJsonBody. The settings store is a temp file reached through CW_SETTINGS, HOME is a temp dir,
// and the explainer registry is the tracked monitor/explainers.json unless a test points
// CW_EXPLAINERS elsewhere. What is asserted is the store on disk, not only the reply.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-learning-entry-'));
const STORE = join(TMP, 'settings.json');
const KEYS = ['HOME', 'CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_EXPLAINERS', 'CW_LEARNING_MODE', 'CW_LEARNING_DISMISSED'];
const saved = {};
for (const k of KEYS) saved[k] = process.env[k];
for (const k of KEYS) delete process.env[k]; // an env shadow would make every write a refusal
process.env.HOME = join(TMP, 'home');
process.env.CW_SETTINGS = STORE;

const { routes, loadExplainers } = await import('../routes/learning.mjs');
const { sessionWho } = await import('../../monitor/attribution.mjs');

after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/learning');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/learning');
const SESSION = { user: 'op@example.test', provider: 'password' };
const IDS = loadExplainers().explainers.map((e) => e.id);

/** The dispatcher's ctx, nothing more. A settled promise either way, so a throw is a result too. */
const call = (route, { body = {}, bodyErr = null, session = SESSION, loopback = false } = {}) =>
  new Promise((resolve) => {
    Promise.resolve(route.handle({
      req: {}, isLoopbackReq: loopback, adminSession: () => session,
      query: new URLSearchParams(),
      readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
      send: (code, payload) => resolve({ code, payload }),
    })).catch((e) => resolve({ code: 'threw', payload: String(e && e.message) }));
  });

const store = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : null);
const fresh = () => rmSync(STORE, { force: true });

test('the registry has explainers to dismiss (the fixtures below depend on it)', () => {
  assert.ok(IDS.length >= 2, `monitor/explainers.json served ${IDS.length} ids`);
});

// ---- the gate

test('no session off the operator port is 401 on both routes, and the store is not created', async () => {
  fresh();
  for (const route of [GET, POST]) {
    for (const session of [null, { provider: 'password' }]) {
      const r = await call(route, { session, body: { on: true } });
      assert.equal(r.code, 401, `${route.method} session=${JSON.stringify(session)}`);
      assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
    }
  }
  assert.equal(store(), null);
});

test('the operator port needs no session and stamps the write as the loopback operator', async () => {
  fresh();
  const r = await call(POST, { session: null, loopback: true, body: { on: true } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(store().settings.learningMode.by, 'operator@loopback');
});

test('a session off the operator port is stamped with that session\'s identity', async () => {
  fresh();
  const r = await call(POST, { body: { on: true } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(store().settings.learningMode.by, sessionWho(SESSION));
});

// ---- GET

test('GET: off by default, nothing visible, every explainer counted', async () => {
  fresh();
  const r = await call(GET);
  assert.equal(r.code, 200);
  assert.equal(r.payload.on, false);
  assert.deepEqual(r.payload.visible, []);
  assert.equal(r.payload.total, IDS.length);
  assert.equal(r.payload.registryOk, true);
});

test('GET: an unreadable registry serves no explainers and says so, even when on', async () => {
  fresh();
  await call(POST, { body: { on: true } });
  const dir = join(TMP, 'registry-is-a-dir');
  mkdirSync(dir, { recursive: true });
  process.env.CW_EXPLAINERS = dir;
  try {
    const r = await call(GET);
    assert.equal(r.code, 200);
    assert.equal(r.payload.on, true);
    assert.equal(r.payload.registryOk, false);
    assert.match(r.payload.registryError, /unreadable/);
    assert.deepEqual(r.payload.visible, []);
  } finally { delete process.env.CW_EXPLAINERS; }
});

// ---- POST: body validation

test('POST: an unparseable body is 400 and the store is not created', async () => {
  fresh();
  const r = await call(POST, { bodyErr: 'body is not valid JSON' });
  assert.equal(r.code, 400);
  assert.deepEqual(r.payload, { ok: false, error: 'body is not valid JSON' });
  assert.equal(store(), null);
});

test('POST: each malformed field is refused 400 with its own reason, and nothing is written', async () => {
  fresh();
  const cases = [
    [{}, 'nothing to change — send `on`, `dismiss` or `restoreAll`'],
    [{ restoreAll: 'yes' }, 'nothing to change — send `on`, `dismiss` or `restoreAll`'],
    [{ on: 'true' }, '`on` must be true or false'],
    [{ dismiss: 7 }, '`dismiss` must be an explainer id'],
    [{ dismiss: 'no-such-explainer' }, '"no-such-explainer" is not an explainer in monitor/explainers.json'],
  ];
  for (const [body, error] of cases) {
    const r = await call(POST, { body });
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.deepEqual(r.payload, { ok: false, error });
  }
  assert.equal(store(), null);
});

// ---- POST: effect

test('POST: on, dismiss and restoreAll each land in the store and in the reply', async () => {
  fresh();
  let r = await call(POST, { body: { on: true } });
  assert.equal(r.payload.on, true);
  assert.equal(store().settings.learningMode.value, true);
  assert.equal(r.payload.visible.length, IDS.length);

  r = await call(POST, { body: { dismiss: IDS[1] } });
  assert.equal(r.code, 200);
  r = await call(POST, { body: { dismiss: IDS[0] } });
  assert.deepEqual(store().settings.learningDismissed.value, [IDS[0], IDS[1]].sort(), 'sorted, both kept');
  assert.equal(r.payload.visible.some((e) => e.id === IDS[0] || e.id === IDS[1]), false);
  assert.equal(r.payload.visible.length, IDS.length - 2);

  r = await call(POST, { body: { restoreAll: true } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.payload.dismissed, []);
  assert.equal(r.payload.visible.length, IDS.length);

  r = await call(POST, { body: { on: false } });
  assert.equal(store().settings.learningMode.value, false);
  assert.deepEqual(r.payload.visible, []);
});

// ---- POST: unreadable store

// The status is not pinned: setSettings answers 503 and the handler re-labels it 400 (reported, not
// fixed here). What is pinned is the refusal, its reason and the untouched store.
test('POST: an unreadable settings store refuses the write and is left as it was', async () => {
  const corrupt = '{ this is not json';
  writeFileSync(STORE, corrupt);
  try {
    for (const body of [{ on: true }, { dismiss: IDS[0] }]) {
      const r = await call(POST, { body });
      assert.ok(r.code >= 400 && r.code < 600, `${JSON.stringify(body)}: ${r.code} ${JSON.stringify(r.payload)}`);
      assert.equal(r.payload.ok, false);
      assert.match(r.payload.error, /refusing to write/);
    }
    assert.equal(readFileSync(STORE, 'utf8'), corrupt, 'a store nobody could read is never overwritten');
  } finally { fresh(); }
});
