// admin/routes/runner.mjs over a fake ctx: the session check, a stopped stack, a live stack API
// (runner/api.mjs), and its registration in serve.mjs and the rail.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/runner.mjs';
import { createStackApi } from '../../runner/api.mjs';

const TOKEN = 'synthetic-token-0123456789abcdef';
const DIR = mkdtempSync(join(tmpdir(), 'cw-runner-route-'));
writeFileSync(join(DIR, 'api-token'), `${TOKEN}\n`);
const SLOTS = JSON.parse(readFileSync(new URL('./fixtures/stack-api/slots.json', import.meta.url), 'utf8')).data.slots;
const route = (path) => routes.find((r) => r.path === path);

const api = createStackApi({ token: TOKEN, host: '127.0.0.1', port: 0, slots: () => SLOTS, probes: {} });
const LIVE = `http://127.0.0.1:${(await api.listen()).port}`;
const closed = createServer();
await new Promise((r) => closed.listen(0, '127.0.0.1', r));
const DOWN = `http://127.0.0.1:${closed.address().port}`;
await new Promise((r) => closed.close(r));
after(() => api.close());

async function call(path, { session = true, url = DOWN } = {}) {
  const keep = { u: process.env.CW_STACK_API_URL, t: process.env.CW_STACK_API_TOKEN_FILE };
  process.env.CW_STACK_API_URL = url;
  process.env.CW_STACK_API_TOKEN_FILE = join(DIR, 'api-token');
  let out = null;
  const ctx = { req: {}, adminSession: () => (session ? { user: 'op@example.com' } : null), send: (status, body, type = 'application/json', headers = {}) => { out = { status, body, type, headers }; } };
  try { await route(path).handle(ctx); } finally {
    for (const [k, v] of [['CW_STACK_API_URL', keep.u], ['CW_STACK_API_TOKEN_FILE', keep.t]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return out;
}

test('two GET routes under /api/, each refusing a caller without a session', async () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`), ['GET /api/runner', 'GET /api/runner.html']);
  for (const r of routes) assert.equal((await call(r.path, { session: false })).status, 401);
});

test('a stopped stack answers 200 with every figure UNMEASURED and the remedy', async () => {
  const json = await call('/api/runner');
  assert.equal(json.status, 200);
  assert.equal(json.body.api.state, 'unmeasured');
  assert.match(json.body.api.why, /refused the connection/);
  assert.ok(json.body.kpis.every((k) => k.v.text === 'UNMEASURED'));
  const page = await call('/api/runner.html');
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.body, /run node bin\/stack\.mjs up in the spine checkout/);
});

test('a live stack API: the slot table is measured, an unconfigured ledger is UNMEASURED by name', async () => {
  const { body } = await call('/api/runner', { url: LIVE });
  assert.equal(body.api.state, 'measured');
  assert.deepEqual(body.slots.rows.map((s) => [s.id, s.state]), [['slot-1', 'idle'], ['slot-2', 'running']]);
  assert.equal(body.layers.jobs.why, 'ledger unavailable: no ledger configured');
});

test('registered: one import and one MODULAR_ROUTES entry in serve.mjs, one rail link', () => {
  const serve = readFileSync(new URL('../serve.mjs', import.meta.url), 'utf8');
  assert.match(serve, /import \{ routes as runnerRoutes \} from '\.\/routes\/runner\.mjs';/);
  assert.match(serve, /const MODULAR_ROUTES = \[[^\]]*\.\.\.runnerRoutes[^\]]*\];/);
  const rail = readFileSync(new URL('../menus/section-rail.html', import.meta.url), 'utf8');
  assert.match(rail, /<a class="rail-link" href="\/api\/runner\.html"[^>]*>Actions runner<\/a>/);
});
