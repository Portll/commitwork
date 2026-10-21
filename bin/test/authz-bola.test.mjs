// Tests for bin/authz-bola.mjs — the single-target BOLA probe. The probe is a top-level script
// with no exports, so every test SPAWNS it against a purpose-built fake gateway and reads the
// JSON it emits. Each gateway pins WHICH backends must produce a finding and which must not —
// both directions have been wrong here before (false CLEAN and false CRITICAL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disclosesObject } from '../bola-run.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'authz-bola.mjs');
const TA = 'tenant-aaaa';
const TB = 'tenant-bbbb';

// Spawn the probe and hand back its parsed JSON. The environment is scrubbed of every CW_* input
// first: inheriting the operator's real CW_TARGET_URL would point a test at a live service.
function probe(base, extra = {}) {
  const env = { ...process.env };
  for (const k of ['CW_TARGET_URL', 'CW_BEARER_A', 'CW_BEARER_B', 'CW_TENANT_A', 'CW_TENANT_B', 'CW_BOLA_PATHS']) delete env[k];
  Object.assign(env, extra);
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, base ? [SCRIPT, base] : [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', rej);
    p.on('close', (code) => {
      let json = null;
      try { json = JSON.parse(out); } catch { /* a non-JSON stdout is itself a failure the test asserts */ }
      res({ code, out, err, json });
    });
  });
}

function serve(handler) {
  const server = createServer(handler);
  return new Promise((res) => server.listen(0, '127.0.0.1', () =>
    res({ base: `http://127.0.0.1:${server.address().port}`, server, close: () => server.close() })));
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const SPEC = { paths: { '/api/things/{id}': { get: {} } } };
// A gateway that serves the springdoc spec unauthenticated and delegates everything else.
const withSpec = (rest) => (req, res) => {
  if (req.url === '/v3/api-docs') return json(res, 200, SPEC);
  if (req.url.startsWith('/v3/api-docs') || req.url === '/swagger-resources') return json(res, 404, {});
  return rest(req, res);
};
// 404 every spec path, so discovery must fall back to CW_BOLA_PATHS.
const noSpec = (rest) => (req, res) => {
  if (req.url.startsWith('/v3/api-docs') || req.url === '/swagger-resources') return json(res, 404, {});
  return rest(req, res);
};

// ── the void path: a probe that could not run must never look clean ────────────────────────────────

test('no target at all ⇒ a void with a reason, exit 0 (a void is not a tool failure)', async () => {
  const r = await probe(null);
  assert.equal(r.code, 0);
  assert.equal(r.json.ran, false);
  assert.equal(r.json.skipped, true);
  assert.match(r.json.reason, /no target/);
  // the reason is repeated inside summary because the rollup and panel read summary.verdict
  assert.match(r.json.summary.verdict, /^NOT RUN —/);
  assert.deepEqual(r.json.findings, []);
});

test('no reachable spec and no named paths ⇒ a coverage void, NOT "no exposure found"', async (t) => {
  // guessed nouns 404 everywhere and used to read as a clean bill of health
  const g = await serve(noSpec((req, res) => json(res, 200, { anything: true })));
  t.after(g.close);
  const r = await probe(g.base);
  assert.equal(r.code, 0);
  assert.equal(r.json.ran, false, 'a scan with no endpoints must be a void, never a clean verdict');
  assert.match(r.json.reason, /no object-level endpoints to probe/);
  assert.match(r.json.reason, /no OpenAPI reachable/);
  assert.match(r.json.reason, /CW_BOLA_PATHS/, 'the reason must say what to set to make it run');
  assert.deepEqual(r.json.findings, []);
});

test('a spec that declares no GET paths ⇒ a void that names the spec it read', async (t) => {
  const g = await serve((req, res) => {
    if (req.url === '/v3/api-docs') return json(res, 200, { paths: { '/api/things': { post: {} } } });
    return json(res, 404, {});
  });
  t.after(g.close);
  const r = await probe(g.base);
  assert.equal(r.json.ran, false);
  assert.match(r.json.reason, /declares no GET paths/);
  assert.match(r.json.reason, /\/v3\/api-docs/, 'naming the spec makes the void diagnosable');
});

// ── spec discovery ────────────────────────────────────────────────────────────────────────────────

test('an AUTH-GATED spec is still discovered, because discovery presents the bearer too', async (t) => {
  // CWS-11: the gateway 401s the spec unauthenticated — discovery must present the bearer too
  const g = await serve((req, res) => {
    if (req.url === '/v3/api-docs') {
      if (!req.headers.authorization) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, SPEC);
    }
    if (req.url.startsWith('/v3/api-docs') || req.url === '/swagger-resources') return json(res, 404, {});
    return json(res, 401, { error: 'unauthorized' });
  });
  t.after(g.close);

  const blind = await probe(g.base);
  assert.equal(blind.json.ran, false, 'with no bearer the gated spec is unreachable — a void, not a pass');

  const seeing = await probe(g.base, { CW_BEARER_A: 'tok-a' });
  assert.equal(seeing.json.summary.ran, true);
  assert.equal(seeing.json.summary.specAt, '/v3/api-docs');
  assert.equal(seeing.json.summary.pathSource, 'openapi');
});

test('operator-named paths are used when no spec answers, and are recorded as the source', async (t) => {
  const g = await serve(noSpec((req, res) => json(res, 401, { error: 'unauthorized' })));
  t.after(g.close);
  const r = await probe(g.base, { CW_BOLA_PATHS: '/api/things/1,/api/orders/1' });
  assert.equal(r.json.summary.ran, true);
  assert.equal(r.json.summary.specAt, null);
  assert.equal(r.json.summary.pathSource, 'CW_BOLA_PATHS', 'provenance of the path list is auditable');
  assert.equal(r.json.summary.endpointsProbed, 2);
});

// ── unauthenticated exposure: the positive case and its false-positive twin ────────────────────────

test('an object endpoint served with NO auth and a real body is flagged unauth-exposure', async (t) => {
  const g = await serve(withSpec((req, res) => json(res, 200, { id: 1, secret: 'THE-OBJECT' })));
  t.after(g.close);
  const r = await probe(g.base);
  const f = r.json.findings.filter((x) => x.type === 'unauth-exposure');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'high');
  assert.equal(f[0].path, '/api/things/1', 'the {id} placeholder is substituted with a probe id');
  assert.match(r.json.summary.verdict, /POTENTIAL BOLA\/IDOR/);
});

test('200 + an EMPTY COLLECTION with no auth is NOT exposure — the backend disclosed nothing', async (t) => {
  // a filtering backend answers 200 + [] — body-length scoring called that a high finding
  for (const empty of [[], {}, null]) {
    const g = await serve(withSpec((req, res) => json(res, 200, empty)));
    const r = await probe(g.base);
    g.close();
    assert.equal(r.json.summary.ran, true, 'it really did probe — this is a clean run, not a void');
    assert.deepEqual(r.json.findings, [], `200 + ${JSON.stringify(empty)} must disclose nothing`);
    assert.match(r.json.summary.verdict, /no unauth exposure/);
  }
});

// ── header-trust: the unauthenticated forged-tenant slice ──────────────────────────────────────────

test('a response that differs by the forged X-Tenant-Id alone is header-trust', async (t) => {
  const g = await serve(withSpec((req, res) => {
    const t2 = req.headers['x-tenant-id'];
    if (!t2) return json(res, 401, { error: 'unauthorized' });
    // the gateway ACTS on a client-supplied tenant header: different tenant, different data
    return json(res, 200, t2 === TA ? { id: 1, owner: 'A' } : { id: 1, owner: 'B', extra: 'more bytes here' });
  }));
  t.after(g.close);
  const r = await probe(g.base, { CW_TENANT_A: TA, CW_TENANT_B: TB });
  const f = r.json.findings.filter((x) => x.type === 'header-trust');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'high');
  assert.match(f[0].detail, /differs by tenant header only/);
});

test('an unauthenticated 401 that becomes 2xx once X-Tenant-Id is supplied is header-trust', async (t) => {
  const g = await serve(withSpec((req, res) => {
    if (!req.headers['x-tenant-id']) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { id: 1, owner: 'same-for-both' }); // identical bodies ⇒ the length test cannot fire
  }));
  t.after(g.close);
  const r = await probe(g.base, { CW_TENANT_A: TA, CW_TENANT_B: TB });
  const f = r.json.findings.filter((x) => x.type === 'header-trust');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /becomes 2xx once X-Tenant-Id is supplied/);
});

test('a gateway that ignores the forged header entirely produces no header-trust finding', async (t) => {
  const g = await serve(withSpec((req, res) => json(res, 401, { error: 'unauthorized' })));
  t.after(g.close);
  const r = await probe(g.base, { CW_TENANT_A: TA, CW_TENANT_B: TB });
  assert.deepEqual(r.json.findings, []);
  assert.match(r.json.summary.verdict, /no unauth exposure/);
  assert.match(r.json.summary.mode, /unauthenticated \(forged-header\)/);
});

// ── the authenticated cross-tenant matrix ──────────────────────────────────────────────────────────

// tokens are bound to tenants here; `bind` decides what a MISMATCHED pair receives, which is the
// single knob that separates a vulnerable gateway from a correct one.
const tenantApi = (onMismatch) => withSpec((req, res) => {
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  const want = req.headers['x-tenant-id'];
  if (!auth) return json(res, 401, { error: 'unauthorized' });
  const owns = { 'tok-a': TA, 'tok-b': TB }[auth];
  if (owns === want) return json(res, 200, { id: 1, tenant: want, secret: 'THE-OBJECT' });
  return onMismatch(res, want);
});

test('a gateway that lets one tenant read another is flagged cross-tenant-read, both directions', async (t) => {
  // vulnerable: the token is authenticated but the tenant binding is never enforced
  const g = await serve(withSpec((req, res) => {
    if (!req.headers.authorization) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { id: 1, tenant: req.headers['x-tenant-id'], secret: 'THE-OBJECT' });
  }));
  t.after(g.close);
  const r = await probe(g.base, { CW_BEARER_A: 'tok-a', CW_BEARER_B: 'tok-b', CW_TENANT_A: TA, CW_TENANT_B: TB });
  const f = r.json.findings.filter((x) => x.type === 'cross-tenant-read');
  assert.equal(f.length, 2, 'A->B and B->A are separate breaks and both must be reported');
  assert.deepEqual(f.map((x) => x.direction).sort(), ['A->B', 'B->A']);
  assert.ok(f.every((x) => x.severity === 'critical'));
  assert.equal(r.json.summary.mode, 'authenticated cross-tenant');
});

test('a gateway that REFUSES the cross read is clean, and says the matrix actually ran', async (t) => {
  const g = await serve(tenantApi((res) => json(res, 403, { error: 'forbidden' })));
  t.after(g.close);
  const r = await probe(g.base, { CW_BEARER_A: 'tok-a', CW_BEARER_B: 'tok-b', CW_TENANT_A: TA, CW_TENANT_B: TB });
  assert.deepEqual(r.json.findings, []);
  assert.match(r.json.summary.verdict, /no cross-tenant leak/);
  assert.ok(r.json.summary.endpointsProbed > 0, 'a clean verdict is only meaningful if something was probed');
});

test('a gateway that FILTERS the cross read (200 + []) is equally clean — no fabricated critical', async (t) => {
  // the authenticated twin of the unauth empty-collection case
  const g = await serve(tenantApi((res) => json(res, 200, [])));
  t.after(g.close);
  const r = await probe(g.base, { CW_BEARER_A: 'tok-a', CW_BEARER_B: 'tok-b', CW_TENANT_A: TA, CW_TENANT_B: TB });
  assert.deepEqual(r.json.findings, [], 'an empty result set is a refusal, not a disclosure');
  assert.match(r.json.summary.verdict, /no cross-tenant leak/);
});

test('when the OWNER itself sees nothing, a peer reaching the path is not evidence of a leak', async (t) => {
  // 200 + [] for everyone — nobody owns anything here, so a peer's "success" proves nothing
  const g = await serve(withSpec((req, res) => {
    if (!req.headers.authorization) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, []);
  }));
  t.after(g.close);
  const r = await probe(g.base, { CW_BEARER_A: 'tok-a', CW_BEARER_B: 'tok-b', CW_TENANT_A: TA, CW_TENANT_B: TB });
  assert.deepEqual(r.json.findings, []);
});

test('two IDENTICAL tokens cannot fabricate a cross-tenant finding — the matrix did not run', async (t) => {
  // one identity wearing both hats makes every cross request same-tenant — refuse, never report clean
  const g = await serve(withSpec((req, res) => {
    if (!req.headers.authorization) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { id: 1, tenant: req.headers['x-tenant-id'], secret: 'THE-OBJECT' });
  }));
  t.after(g.close);
  const r = await probe(g.base, { CW_BEARER_A: 'same-tok', CW_BEARER_B: 'same-tok', CW_TENANT_A: TA, CW_TENANT_B: TB });
  assert.equal(r.json.findings.filter((x) => x.type === 'cross-tenant-read').length, 0);
  assert.match(r.json.summary.mode, /IDENTICAL/);
  assert.match(r.json.summary.verdict, /DID NOT MEANINGFULLY RUN/);
  assert.match(r.json.summary.verdict, /set two DISTINCT tenant tokens/, 'it must say how to make the matrix real');
});

// ── the evidence contract the rollup depends on ────────────────────────────────────────────────────

test('the emitted document keeps the shape the sweep rollup ingests', async (t) => {
  const g = await serve(withSpec((req, res) => json(res, 200, { id: 1, secret: 'THE-OBJECT' })));
  t.after(g.close);
  const r = await probe(g.base);
  assert.equal(r.json.tool, 'authz-bola', 'the rollup keys off tool');
  assert.ok(Array.isArray(r.json.findings) && Array.isArray(r.json.tested));
  assert.ok(r.json.findings.every((f) => f.type && f.severity && f.path));
  assert.equal(r.json.summary.findings, r.json.findings.length, 'the count cannot drift from the rows');
  assert.deepEqual(Object.keys(r.json.summary.bySeverity), ['critical', 'high', 'medium']);
  assert.equal(r.json.summary.endpointsProbed, r.json.tested.length);
  assert.ok(typeof r.json.summary.verdict === 'string' && r.json.summary.verdict.length > 0);
  // stdout is a single clean JSON document — the sweep pipes it
  assert.equal(r.out.trimEnd().split('\n').at(-1), '}');
});

test('CONTROL: the clean-path assertions above are ones the RETIRED predicate got wrong', () => {
  // the no-finding assertions above must be discriminating: the retired body-length predicate
  // fires on every one of these payloads, so those tests genuinely fail against the old code
  const retired = (r) => r.status >= 200 && r.status < 300 && r.len > 0;
  for (const body of ['[]', '{}', 'null', '  ']) {
    const res = { status: 200, len: body.length, text: body };
    assert.equal(retired(res), true, `the retired length test scored ${JSON.stringify(body)} as a disclosure`);
    assert.equal(disclosesObject(res), false, `the current predicate must not — ${JSON.stringify(body)} hands over nothing`);
  }
  // the control's control: a real payload must still disclose under BOTH
  const real = { status: 200, len: 24, text: '[{"id":1,"s":"SECRET"}]' };
  assert.equal(retired(real), true);
  assert.equal(disclosesObject(real), true);
});

test('a target that is not listening is a void, not a crash and not a clean pass', async () => {
  // 127.0.0.1:1 refuses immediately — the run must still emit valid JSON on exit 0
  const r = await probe('http://127.0.0.1:1', { CW_BOLA_PATHS: '/api/things/1' });
  assert.equal(r.code, 0);
  assert.ok(r.json, `stdout must stay parseable JSON; got: ${r.out.slice(0, 200)}`);
  assert.deepEqual(r.json.findings, [], 'an unreachable target discloses nothing');
});
