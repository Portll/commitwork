// admin/routes/cra.mjs — the CRA panel routes. Handlers are pure functions of their ctx, so these
// invoke them directly with a mock ctx (no server spawn): every route is session-gated, and the
// cases/escalations payloads reflect the case log at CW_CASES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/cra.mjs';

const route = (method, p) => routes.find((r) => r.method === method && r.path === p);
function invoke(r, { session = null, body = undefined, isLoopbackReq = false } = {}) {
  let out;
  r.handle({
    req: {}, adminSession: () => session, isLoopbackReq,
    send: (code, b) => { out = { code, body: b }; },
    readJsonBody: (req, cb) => cb(body, null),
  });
  return out;
}
const SESSION = { user: 'op@example.test', provider: 'password' };

const TMP = mkdtempSync(join(tmpdir(), 'cw-cra-routes-'));
const CASES = join(TMP, 'cases.json');
writeFileSync(CASES, JSON.stringify({
  note: 'test', events: [
    { type: 'paged', caseId: 'client-a--cve-2026-1', at: '2026-09-20T00:00:00.000Z',
      data: { clock: 'notification-72h', due: '2026-09-19T19:00:00.000Z', ref: 'abc0123456789def', target: 'webhook' } },
  ],
  cases: {
    'client-a--cve-2026-1': {
      caseId: 'client-a--cve-2026-1', productId: 'client-a', vulnId: 'CVE-2026-1', kind: 'vulnerability',
      status: 'open', trigger: 'kev', kev: true, epss: 0.9,
      clocks: { earlyWarningDue: '2000-01-01T00:00:00.000Z', notificationDue: '2000-01-02T00:00:00.000Z', finalDue: '2999-01-01T00:00:00.000Z' },
    },
    'closed-one': { caseId: 'closed-one', productId: 'x', vulnId: 'CVE-0', kind: 'vulnerability', status: 'closed', clocks: {} },
  },
}));
process.env.CW_CASES = CASES;

test('every CRA route refuses without a session (401)', () => {
  for (const p of ['/api/cra/cases', '/api/cra/preflight', '/api/cra/escalations', '/api/cra/evidence']) {
    const out = invoke(route('GET', p), { session: null });
    assert.equal(out.code, 401, p);
    assert.equal(out.body.ok, false);
  }
});

test('GET /api/cra/cases returns open cases with overdue flags (closed ones excluded)', () => {
  const out = invoke(route('GET', '/api/cra/cases'), { session: SESSION });
  assert.equal(out.code, 200);
  assert.equal(out.body.configured, true);
  assert.equal(out.body.count, 1, 'the closed case is excluded');
  const c = out.body.cases[0];
  assert.equal(c.caseId, 'client-a--cve-2026-1');
  assert.deepEqual(c.overdue, ['early-warning-24h', 'notification-72h'], 'both past clocks flagged, final is not');
  assert.equal(c.draftsPath, 'reports/cra/cases/client-a--cve-2026-1/');
});

test('GET /api/cra/evidence reports a pack that was never generated as such, never as current', () => {
  const before = process.env.CW_CRA_OUT;
  process.env.CW_CRA_OUT = join(TMP, 'no-pack-out');
  try {
    const out = invoke(route('GET', '/api/cra/evidence'), { session: SESSION });
    assert.equal(out.code, 200);
    assert.equal(out.body.state, 'never-generated');
    assert.match(out.body.reasons[0], /no evidence pack has been generated/);
  } finally {
    if (before === undefined) delete process.env.CW_CRA_OUT; else process.env.CW_CRA_OUT = before;
  }
});

test('GET /api/cra/escalations returns the chain-covered paged events', () => {
  const out = invoke(route('GET', '/api/cra/escalations'), { session: SESSION });
  assert.equal(out.code, 200);
  assert.equal(out.body.count, 1);
  assert.equal(out.body.escalations[0].clock, 'notification-72h');
  assert.equal(out.body.escalations[0].ref, 'abc0123456789def');
});

test('a missing case log is configured:false, not an empty green', () => {
  const saved = process.env.CW_CASES;
  process.env.CW_CASES = join(TMP, 'does-not-exist.json');
  try {
    const out = invoke(route('GET', '/api/cra/cases'), { session: SESSION });
    assert.equal(out.code, 200);
    assert.equal(out.body.configured, false); // explicit uncertainty
    assert.equal(out.body.count, 0);
  } finally { process.env.CW_CASES = saved; }
});

// ── the products.json wizard (W4) ────────────────────────────────────────────
const PRODUCTS = join(TMP, 'products.json');
process.env.CW_PRODUCTS = PRODUCTS;
const validDoc = {
  manufacturer: { name: 'Real GmbH', contact: 'psirt@real.example' },
  products: [{ id: 'p', name: 'P', version: '1.0.0', repos: ['r'], market: { eu: false } }],
};

test('POST /api/cra/products refuses without a session (401)', () => {
  assert.equal(invoke(route('POST', '/api/cra/products'), { session: null, body: { products: validDoc } }).code, 401);
});

test('POST /api/cra/products: create (no store, baseHash null) writes + returns hash + preflight, GET round-trips', () => {
  rmSync(PRODUCTS, { force: true });
  const out = invoke(route('POST', '/api/cra/products'), { session: SESSION, body: { products: validDoc, baseHash: null } });
  assert.equal(out.code, 200, JSON.stringify(out.body));
  assert.match(out.body.hash, /^[0-9a-f]{64}$/);
  assert.ok(out.body.preflight);
  const got = invoke(route('GET', '/api/cra/products'), { session: SESSION });
  assert.equal(got.body.exists, true);
  assert.deepEqual(got.body.products, validDoc);
  assert.equal(got.body.hash, out.body.hash, 'returned hash matches on-disk bytes → usable as next baseHash');
});

test('POST /api/cra/products: a stale/missing baseHash is a 409 (concurrent-change guard)', () => {
  assert.equal(invoke(route('POST', '/api/cra/products'), { session: SESSION, body: { products: validDoc, baseHash: 'stale' } }).code, 409);
});

test('POST /api/cra/products: validateProducts errors are a 400, and the store is untouched', () => {
  const cur = invoke(route('GET', '/api/cra/products'), { session: SESSION }).body.hash;
  const out = invoke(route('POST', '/api/cra/products'), { session: SESSION, body: { products: { products: [] }, baseHash: cur } });
  assert.equal(out.code, 400);
  assert.ok(out.body.errors?.length);
  assert.equal(invoke(route('GET', '/api/cra/products'), { session: SESSION }).body.hash, cur, 'unchanged');
});

test('POST /api/cra/products: a corrupt store is a 503, never a blind overwrite', () => {
  writeFileSync(PRODUCTS, '{ not valid json');
  assert.equal(invoke(route('POST', '/api/cra/products'), { session: SESSION, body: { products: validDoc, baseHash: null } }).code, 503);
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));

// ── the operator port (ruling 2026-08-22) ──────────────────────────────────────────────────────
// These routes used to demand a session even on loopback, which made the CRA page dead on the very
// port an operator uses standing at the box: the clocks rendered and no data ever arrived. Loopback
// privilege is keyed to req.socket.localPort — a property of the accepted socket that no caller can
// assert — and serve.mjs verifies at boot that the tunnel never routes it.

test('every CRA route is reachable on the operator port with no session', () => {
  for (const r of routes) {
    const out = invoke(r, { isLoopbackReq: true, body: { products: { manufacturer: {}, products: [] } } });
    assert.notEqual(out.code, 401, `${r.method} ${r.path} refused the operator port`);
  }
});

test('the operator port is the ONLY thing that substitutes for a session', () => {
  // Belt and braces: a falsy isLoopbackReq must not be read as permission, and an adminSession that
  // returns a session-shaped object with no user must not either.
  for (const r of routes) {
    assert.equal(invoke(r, { isLoopbackReq: false }).code, 401, `${r.method} ${r.path} leaked off-port`);
    assert.equal(invoke(r, { session: { provider: 'password' } }).code, 401,
      `${r.method} ${r.path} accepted a session with no user`);
  }
});
