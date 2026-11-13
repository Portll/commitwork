// admin/routes/lane-trust.mjs — GET /api/lane-trust, driven through its handler with a fake send,
// as correlations-route.test.mjs does. CW_REGISTRY names a fixture registry whose reportsRoot is a
// temp directory, so no real reports directory is read.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/lane-trust.mjs';

const ENV = ['CW_LANE_TRUST_OUT', 'CW_REGISTRY'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const dirs = [];
let dir, trustPath, capabilityPath;

const TRUST = {
  generated: '2026-01-05T00:00:00.000Z',
  lanes: { secrets: { fixture: { source: 'real' }, canary: { state: 'not-measured' } } },
  summary: { lanes: 1 },
};
const CAPABILITY = {
  generated: '2026-01-05T00:00:00.000Z',
  tally: { counting: 3, 'shape-only': 1, 'zero-on-golden': 0, 'no-fixture': 2 },
  measured: { measured: 3, lanes: 6, undetermined: 3 },
  lanes: { secrets: { witness: 'counting' } },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-lane-trust-route-'));
  dirs.push(dir);
  trustPath = join(dir, 'lane-trust.json');
  capabilityPath = join(dir, 'lane-capability.json');
  const registry = join(dir, 'projects.json');
  writeFileSync(registry, JSON.stringify({ reportsRoot: dir, defaultManifest: 'security-baseline', roots: [], projects: [], areas: [] }));
  process.env.CW_REGISTRY = registry;
  delete process.env.CW_LANE_TRUST_OUT;
});
after(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const route = routes.find((r) => r.method === 'GET' && r.path === '/api/lane-trust');
const ctx = ({ session = { user: 'tester' }, loopback = false } = {}) => {
  const out = {};
  return {
    out,
    ctx: { req: {}, isLoopbackReq: loopback, adminSession: () => session, send: (code, body) => { out.code = code; out.body = body; } },
  };
};
const call = (c = ctx()) => { route.handle(c.ctx); return c.out; };
const write = (path, value) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
const ok = (artifact) => ({ state: 'ok', generated: artifact.generated, data: artifact });

test('both artifacts present: the parsed bodies and their generated stamps', () => {
  write(trustPath, TRUST);
  write(capabilityPath, CAPABILITY);
  const o = call();
  assert.equal(o.code, 200);
  assert.deepEqual(o.body, { trust: ok(TRUST), capability: ok(CAPABILITY) });
});

test('a missing trust artifact is absent, and the capability artifact is still served', () => {
  write(capabilityPath, CAPABILITY);
  const o = call();
  assert.equal(o.code, 200);
  assert.deepEqual(o.body, { trust: { state: 'absent' }, capability: ok(CAPABILITY) });
});

test('a missing capability artifact is absent, and the trust artifact is still served', () => {
  write(trustPath, TRUST);
  const o = call();
  assert.equal(o.code, 200);
  assert.deepEqual(o.body, { trust: ok(TRUST), capability: { state: 'absent' } });
});

test('an unparseable artifact is unreadable, never absent, and the other is still ok', () => {
  write(trustPath, '{not json');
  write(capabilityPath, CAPABILITY);
  const o = call();
  assert.equal(o.code, 200);
  assert.deepEqual(o.body, {
    trust: { state: 'unreadable', reason: 'parse' },
    capability: ok(CAPABILITY),
  });
});

test('parsed JSON that is not an object is unreadable', () => {
  write(trustPath, '[]');
  write(capabilityPath, 'null');
  const o = call();
  assert.deepEqual(o.body, {
    trust: { state: 'unreadable', reason: 'not-a-json-object' },
    capability: { state: 'unreadable', reason: 'not-a-json-object' },
  });
});

test('a directory where the artifact should be is unreadable', () => {
  mkdirSync(trustPath);
  write(capabilityPath, CAPABILITY);
  const o = call();
  assert.equal(o.code, 200);
  assert.deepEqual(o.body, {
    trust: { state: 'unreadable', reason: 'EISDIR' },
    capability: ok(CAPABILITY),
  });
});

test('an unauthenticated caller on the published port is refused', () => {
  write(trustPath, TRUST);
  write(capabilityPath, CAPABILITY);
  const o = call(ctx({ session: null, loopback: false }));
  assert.equal(o.code, 401);
  assert.deepEqual(o.body, { ok: false, error: 'authentication required' });
});

test('the route table is GET-only, so every other method gets the dispatcher refusal', () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`), ['GET /api/lane-trust']);
});

test('serve.mjs registers the group: one import and one MODULAR_ROUTES entry', () => {
  const serve = readFileSync(new URL('../serve.mjs', import.meta.url), 'utf8');
  assert.match(serve, /import \{ routes as laneTrustRoutes \} from '\.\/routes\/lane-trust\.mjs';/);
  assert.match(serve, /const MODULAR_ROUTES = \[[^\]]*\.\.\.laneTrustRoutes[^\]]*\];/);
});

test('CW_LANE_TRUST_OUT moves the trust artifact only, as it does for the producer', () => {
  const elsewhere = join(dir, 'elsewhere');
  mkdirSync(elsewhere);
  process.env.CW_LANE_TRUST_OUT = join(elsewhere, 'trust.json');
  write(process.env.CW_LANE_TRUST_OUT, TRUST);
  write(capabilityPath, CAPABILITY);
  write(trustPath, { generated: 'stale', lanes: {} });
  assert.deepEqual(call().body, { trust: ok(TRUST), capability: ok(CAPABILITY) });
});

test('an unreadable registry leaves both artifacts unreadable, never absent', () => {
  writeFileSync(process.env.CW_REGISTRY, '{ not json');
  const o = call();
  assert.equal(o.code, 200);
  assert.equal(o.body.trust.state, 'unreadable');
  assert.equal(o.body.capability.state, 'unreadable');
  assert.ok(o.body.capability.reason);
});
