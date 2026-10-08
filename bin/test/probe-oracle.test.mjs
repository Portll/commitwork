// Tests for bin/lib/probe-oracle.mjs — the cross-cutting oracle discipline for the off-box probe
// lane (WORKLIST §A). Two halves: (1) pure unit tests of each of the four rules, and (2) SPAWN tests
// that drive the real bin/authz-bola.mjs CLI against purpose-built fake gateways, so the wiring is a
// second witness — the effect is asserted end-to-end, not just that the helper exists.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  positiveControl, plantCanary, responseContainsCanary, judgeCanaryLeak,
  probeClass, authorizeProbeClass, isFleetOwned, parseSecurityTxt, verifyConsent,
} from '../lib/probe-oracle.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'authz-bola.mjs');
const TA = 'tenant-aaaa';
const TB = 'tenant-bbbb';

// ── Rule 1 · positive control ──────────────────────────────────────────────────────────────────────
describe('positive control gates every negative verdict', () => {
  test('a 2xx authorized baseline is a positive control', () => {
    for (const s of [200, 201, 204, 299]) assert.equal(positiveControl({ status: s }).state, 'ok');
  });
  test('a blocked baseline (401/403) is a VOID, never clean — explicit uncertainty', () => {
    for (const s of [401, 403, 500, 0]) {
      const r = positiveControl({ status: s });
      assert.equal(r.state, 'void', `HTTP ${s} must not read as control-present`);
      assert.equal(r.code, 'no-positive-control');
      assert.equal(r.ok, false);
      assert.match(r.reason, /indistinguishable from an edge WAF/);
    }
  });
});

// ── Rule 2 · planted canary ──────────────────────────────────────────────────────────────────────────
describe('a leak is confirmed only by a planted canary', () => {
  test('plantCanary is deterministic under a seed (byte-identical re-runs) and unique otherwise', () => {
    assert.equal(plantCanary('tenantB/obj-1'), plantCanary('tenantB/obj-1'));
    assert.notEqual(plantCanary('tenantB/obj-1'), plantCanary('tenantB/obj-2'));
    assert.notEqual(plantCanary(), plantCanary(), 'seedless canaries must not be guessable/repeat');
    assert.match(plantCanary('x'), /^cw-canary-[0-9a-f]{24}$/);
  });
  test('responseContainsCanary is a substring oracle, not a status/length test', () => {
    const c = plantCanary('b');
    assert.equal(responseContainsCanary({ status: 200, text: `{"secret":"${c}"}` }, c), true);
    assert.equal(responseContainsCanary({ status: 200, text: '{"id":2}' }, c), false, 'a 2xx alone is not a leak');
    assert.equal(responseContainsCanary({ status: 200, text: '' }, c), false);
    assert.equal(responseContainsCanary({ status: 200, text: '{}' }, null), false, 'no canary planted ⇒ never a leak');
  });
  test('judgeCanaryLeak: canary present ⇒ leak, absent ⇒ clean, no positive control ⇒ void', () => {
    const c = plantCanary('b');
    assert.equal(judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: { text: `x${c}y` }, canary: c }).state, 'leak');
    assert.equal(judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: { text: '{"mine":1}' }, canary: c }).state, 'clean');
    // decoy: a hostile target returns a B-shaped body WITHOUT the marker — not a leak
    assert.equal(judgeCanaryLeak({ baseline: { status: 200 }, attackerResp: { text: '{"owner":"B","decoy":true}' }, canary: c }).state, 'clean');
    // no positive control: even a canary-bearing response is a VOID, never a leak or a pass
    const v = judgeCanaryLeak({ baseline: { status: 401 }, attackerResp: { text: c }, canary: c });
    assert.equal(v.state, 'void');
    assert.equal(v.code, 'no-positive-control');
  });
});

// ── Rule 3 · read/write split ──────────────────────────────────────────────────────────────────────
describe('write-class probes are deferred behind destructive-probe authorization', () => {
  test('read-class lanes are authorized to ship now', () => {
    for (const lane of ['unauth-exposure', 'cross-tenant-read', 'bola', 'bfla', 'enumeration']) {
      const r = authorizeProbeClass(lane);
      assert.equal(r.state, 'ok');
      assert.equal(r.cls, 'read');
    }
  });
  test('write-class (state-replay, mass-assignment) is REFUSED without authorization', () => {
    for (const lane of ['state-replay', 'mass-assignment']) {
      assert.equal(probeClass(lane), 'write');
      const r = authorizeProbeClass(lane);
      assert.equal(r.state, 'void', `${lane} mutates the target — it must not run unconsented`);
      assert.equal(r.code, 'write-class-unauthorized');
    }
  });
  test('write-class needs BOTH a destructive-probe authorization AND a dry-run — either alone is refused', () => {
    assert.equal(authorizeProbeClass('state-replay', { destructiveAuthorized: true }).code, 'write-class-unauthorized');
    assert.equal(authorizeProbeClass('state-replay', { dryRun: true }).code, 'write-class-unauthorized');
    const ok = authorizeProbeClass('state-replay', { destructiveAuthorized: true, dryRun: true });
    assert.equal(ok.state, 'ok');
    assert.equal(ok.dryRun, true, 'even when authorized it ships as a DRY RUN, not a real mutation');
  });
  test('an unclassified lane fails closed (never silently run)', () => {
    assert.equal(authorizeProbeClass('some-new-lane').code, 'unclassified-lane');
  });
});

// ── Rule 4 · verified consent ──────────────────────────────────────────────────────────────────────
describe('consent is VERIFIED for non-fleet targets, self-asserted only for fleet-owned', () => {
  test('fleet ownership is a positive registry fact; a stranger/null area is non-fleet, fail closed', () => {
    assert.equal(isFleetOwned({ slug: 'memory-layer' }), true, 'a registered area with no thirdParty flag is fleet-owned');
    assert.equal(isFleetOwned({ slug: 'memory-layer', thirdParty: false }), true);
    assert.equal(isFleetOwned({ slug: 'client-a', thirdParty: true }), false);
    assert.equal(isFleetOwned(null), false, 'an unregistered stranger cannot self-consent');
  });
  test('a fleet-owned target authorises on self-asserted consent (no VDP needed)', () => {
    const r = verifyConsent({ area: { slug: 'memory-layer' }, target: 'http://127.0.0.1:8099' });
    assert.equal(r.state, 'ok');
    assert.equal(r.basis, 'fleet-owned');
  });
  test('a non-fleet target with NO published VDP is void — self-assertion does not reach a stranger', () => {
    const r = verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example' });
    assert.equal(r.state, 'void');
    assert.equal(r.code, 'consent-unverified');
  });
  test('parseSecurityTxt reads fields, repeats, comments, Expires/Scope/Contact/Canonical', () => {
    const p = parseSecurityTxt([
      '# a real VDP', 'Contact: mailto:security@victim.example', 'Contact: https://victim.example/report',
      'Expires: 2027-01-01T00:00:00Z', 'Scope: victim.example, *.api.victim.example', 'Canonical: https://victim.example/.well-known/security.txt',
    ].join('\n'));
    assert.equal(p.contact.length, 2);
    assert.deepEqual(p.scope, ['victim.example, *.api.victim.example']);
    assert.equal(p.canonical[0], 'https://victim.example/.well-known/security.txt');
    assert.ok(Number.isFinite(p.expires));
  });
  const vdp = ['Contact: mailto:sec@victim.example', 'Expires: 2027-01-01T00:00:00Z', 'Scope: victim.example, *.api.victim.example'].join('\n');
  test('IN-SCOPE target with a published VDP is authorised (verified-vdp)', () => {
    const r = verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example/orders/1', securityTxt: vdp });
    assert.equal(r.state, 'ok');
    assert.equal(r.basis, 'verified-vdp');
    // wildcard subdomain also in scope
    assert.equal(verifyConsent({ area: { thirdParty: true }, target: 'https://x.api.victim.example', securityTxt: vdp }).state, 'ok');
  });
  test('OUT-OF-SCOPE target is void even with a valid VDP for another host', () => {
    const r = verifyConsent({ area: { thirdParty: true }, target: 'https://other.example', securityTxt: vdp });
    assert.equal(r.state, 'void');
    assert.equal(r.code, 'consent-out-of-scope');
  });
  test('a VDP with no Contact is not an authorization to test', () => {
    const r = verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example', securityTxt: 'Scope: victim.example\nExpires: 2027-01-01T00:00:00Z' });
    assert.equal(r.code, 'consent-no-contact');
  });
  test('the proof binds to the probe origin — a cross-origin security.txt is void (rebreaker N1)', () => {
    const r = verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example', securityTxt: vdp, servedFrom: 'https://evil.example/.well-known/security.txt' });
    assert.equal(r.code, 'consent-cross-origin');
  });
  test('a scope-less VDP is carried only by the served-from-origin binding (RFC 9116)', () => {
    const bare = 'Contact: mailto:sec@victim.example\nExpires: 2027-01-01T00:00:00Z';
    assert.equal(verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example', securityTxt: bare }).code, 'consent-out-of-scope', 'no scope + no binding ⇒ not covered');
    assert.equal(verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example', securityTxt: bare, servedFrom: 'https://victim.example/.well-known/security.txt' }).state, 'ok', 'served from the exact origin governs that host');
  });
  test('consent carries a TTL and CW_NOW is read at CALL time (determinism)', () => {
    const orig = process.env.CW_NOW;
    try {
      process.env.CW_NOW = '2026-06-01T00:00:00Z'; // before expiry
      assert.equal(verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example', securityTxt: vdp }).state, 'ok');
      process.env.CW_NOW = '2028-01-01T00:00:00Z'; // after expiry — same inputs, later clock ⇒ void
      const expired = verifyConsent({ area: { thirdParty: true }, target: 'https://victim.example', securityTxt: vdp });
      assert.equal(expired.code, 'consent-expired', 'the env is read at call time, not module load');
    } finally { if (orig === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = orig; }
  });
});

// ── the wiring: authz-bola.mjs USES the positive-control + canary helpers ─────────────────────────────
function probe(base, extra = {}) {
  const env = { ...process.env };
  for (const k of ['CW_TARGET_URL', 'CW_BEARER_A', 'CW_BEARER_B', 'CW_TENANT_A', 'CW_TENANT_B', 'CW_BOLA_PATHS', 'CW_BOLA_CANARY_A', 'CW_BOLA_CANARY_B', 'CW_NOW']) delete env[k];
  Object.assign(env, extra);
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, base ? [SCRIPT, base] : [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', rej);
    p.on('close', () => { let json = null; try { json = JSON.parse(out); } catch { /* asserted by the test */ } res({ out, err, json }); });
  });
}
function serve(handler) {
  const server = createServer(handler);
  return new Promise((res) => server.listen(0, '127.0.0.1', () =>
    res({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
const sendJson = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const SPEC = { paths: { '/api/things/{id}': { get: {} } } };
const specGate = (rest) => (req, res) => {
  if (req.url === '/v3/api-docs') return sendJson(res, 200, SPEC);
  if (req.url.startsWith('/v3/api-docs') || req.url === '/swagger-resources') return sendJson(res, 404, {});
  return rest(req, res);
};
const AUTHED = { CW_BEARER_A: 'tok-a', CW_BEARER_B: 'tok-b', CW_TENANT_A: TA, CW_TENANT_B: TB };

describe('wiring · authz-bola.mjs applies the shared oracle at verdict time', () => {
  test('POSITIVE CONTROL: an AUTHED matrix whose authorized baseline is itself blocked ⇒ no-positive-control VOID, never "no leak"', async (t) => {
    // the object path 401s for EVERYONE, so even the legitimate A→A / B→B baseline fails — a clean
    // "no cross-tenant leak" here would be an edge WAF wearing authorization's clothes.
    const g = await serve(specGate((req, res) => sendJson(res, 401, { error: 'unauthorized' })));
    t.after(g.close);
    const r = await probe(g.base, AUTHED);
    assert.equal(r.json.summary.positiveControl, false, 'no endpoint had a 2xx authorized baseline');
    assert.match(r.json.summary.verdict, /^NOT RUN — no-positive-control/);
    assert.deepEqual(r.json.findings, [], 'a void is neither a finding nor a clean pass');
  });

  test('POSITIVE CONTROL present: a correct gateway (2xx baseline) still reads clean and records positiveControl:true', async (t) => {
    const g = await serve(specGate((req, res) => {
      const tok = (req.headers.authorization || '').replace('Bearer ', '');
      const owns = { 'tok-a': TA, 'tok-b': TB }[tok];
      if (!owns) return sendJson(res, 401, { error: 'unauthorized' });
      if (owns !== req.headers['x-tenant-id']) return sendJson(res, 403, { error: 'forbidden' }); // correct isolation
      return sendJson(res, 200, { id: 1, tenant: owns, secret: `own-${owns}` });
    }));
    t.after(g.close);
    const r = await probe(g.base, AUTHED);
    assert.equal(r.json.summary.positiveControl, true);
    assert.match(r.json.summary.verdict, /no cross-tenant leak/);
    assert.deepEqual(r.json.findings, []);
  });

  // A leak byte-identity CANNOT catch: the leaked body is stamped with the requester's token, so it is
  // never byte-identical to the owner's own read — but it still carries B's planted canary.
  const canaryC = plantCanary('tenant-bbbb/obj');
  const decoyLeakGate = specGate((req, res) => {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    if (!tok) return sendJson(res, 401, { error: 'unauthorized' });
    const asked = req.headers['x-tenant-id']; // LEAKY: serves whatever tenant the header names…
    const body = asked === TB
      ? { id: 2, owner: 'B', canary: canaryC, seenToken: tok } // …stamped with the caller's token
      : { id: 1, owner: 'A', seenToken: tok };
    return sendJson(res, 200, body);
  });

  test('CANARY present ⇒ leak: A reading B returns B\'s planted marker, confirmed by the canary oracle', async (t) => {
    const g = await serve(decoyLeakGate);
    t.after(g.close);
    const r = await probe(g.base, { ...AUTHED, CW_BOLA_CANARY_B: canaryC });
    const ab = r.json.findings.filter((f) => f.type === 'cross-tenant-read' && f.direction === 'A->B');
    assert.equal(ab.length, 1, 'the A→B cross-read must be confirmed');
    assert.equal(ab[0].severity, 'critical');
    assert.match(ab[0].detail, /PLANTED CANARY/);
    assert.match(ab[0].detail, /canary oracle/);
  });

  test('CANARY absent ⇒ this decoy-shaped leak reads clean: byte-identity alone misses it (the canary is load-bearing)', async (t) => {
    const g = await serve(decoyLeakGate);
    t.after(g.close);
    const r = await probe(g.base, AUTHED); // no CW_BOLA_CANARY_* set
    const ab = r.json.findings.filter((f) => f.type === 'cross-tenant-read' && f.direction === 'A->B');
    assert.equal(ab.length, 0, 'without the planted marker, the token-stamped leak is byte-different from B\'s own read and slips past content-matching — which is exactly why the canary exists');
  });
});
