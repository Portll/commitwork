// Tests for the generic BOLA runner (bin/bola-run.mjs). The integration tests stand up real
// in-process HTTP APIs (a deliberate object-level hole beside a correctly-guarded endpoint) and
// drive the real attacker matrix — the matrix→vuln-class mapping is proven end to end, not mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  run, classify, validateManifest, pluck, subjectOf, autodiscover, RECIPES,
  disclosesObject, secretNames, resolveActors, resolveManifestPath,
} from '../bola-run.mjs';
import { readFileSync } from 'node:fs';

// ── pure units ──────────────────────────────────────────────────────────────────
test('pluck reads dotted / indexed paths and never throws', () => {
  assert.equal(pluck({ id: 7 }, 'id'), 7);
  assert.equal(pluck({ data: [{ id: 'x' }] }, 'data.0.id'), 'x');
  assert.equal(pluck({ a: { b: 2 } }, 'a.b'), 2);
  assert.equal(pluck(null, 'a.b'), null); // absent (callers treat null/undefined alike via == null)
  assert.equal(pluck({}, 'nope.deep'), undefined);
});

test('subjectOf prefers a JWT sub, falls back to raw material, null for anon', () => {
  const jwt = 'Bearer ' + ['x', Buffer.from(JSON.stringify({ sub: 'u-1' })).toString('base64url'), 'sig'].join('.');
  assert.equal(subjectOf(jwt), 'sub:u-1');
  assert.equal(subjectOf('opaque-key'), 'raw:opaque-key');
  assert.equal(subjectOf(null), null);
});

test('classify maps each attacker/owner cell to the right vuln class', () => {
  const body = JSON.stringify({ id: 1, secret: 'THE-OBJECT' });
  const got = { status: 200, len: body.length, text: body };
  const denied = { status: 403, len: 0, text: '' };
  const U = (name, tenant = 't1') => ({ name, role: 'user', tenant, subject: 'sub:' + name });
  const AD = (name, tenant = 't1') => ({ name, role: 'admin', tenant, subject: 'sub:' + name });
  const anon = { name: 'anon', role: 'anon', tenant: 'default', subject: null };

  assert.equal(classify(U('a'), U('a'), true, got), null, 'baseline (owner reads own) is never a finding');
  assert.equal(classify(U('a'), U('b'), true, denied), null, 'a proper 403 is the desired outcome');
  assert.equal(classify(U('a'), anon, true, got).type, 'broken-auth');
  assert.equal(classify(U('a'), U('b'), true, got).type, 'bola', 'peer user reads another user = horizontal BOLA');
  assert.equal(classify(AD('adm'), U('u'), true, got).type, 'bfla', 'user reads an admin-owned object = vertical BFLA');
  assert.equal(classify(U('a', 't1'), U('b', 't2'), true, got).type, 'cross-tenant', 'across the tenant boundary = isolation break');

  // fail-closed: an owner that cannot read its own object voids the cell instead of passing it clean
  const v = classify(U('a'), U('b'), false, got);
  assert.ok(v.void && /baseline failed/.test(v.void));
  // two actors that resolve to the SAME identity void the pair rather than fabricating a finding
  const same = classify({ ...U('a'), subject: 'sub:same' }, { ...U('b'), subject: 'sub:same' }, true, got);
  assert.ok(same.void && /SAME identity/.test(same.void));
});

// Operator manifests are private records; the shipped example is the public worked example the seed
// prompt points at, so it must be a manifest the runner accepts and resolves by name.
test('the shipped example manifest validates and resolves as bundled', () => {
  const path = new URL('../../manifests/bola/example.json', import.meta.url);
  assert.deepEqual(validateManifest(JSON.parse(readFileSync(path, 'utf8'))).errors, []);
  const r = resolveManifestPath('example');
  assert.equal(r.source, 'bundled');
  assert.match(r.path, /manifests[\\/]bola[\\/]example\.json$/);
});

test('validateManifest demands actors and something to probe', () => {
  assert.match(validateManifest({}).errors.join(), /actors\[\] .* is required/);
  assert.match(validateManifest({ actors: [{ name: 'a' }] }).errors.join(), /nothing to probe/);
  assert.match(validateManifest({ actors: [{ name: 'a', role: 'wizard' }], discovery: {} }).errors.join(), /role must be anon\|user\|admin/);
  assert.match(validateManifest({ actors: [{ name: 'a', credential: { type: 'ldap' } }], discovery: {} }).errors.join(), /unknown/);
  assert.equal(validateManifest({ actors: [{ name: 'a', role: 'anon' }], discovery: { paths: ['/x'] } }).errors.length, 0);
});

test('unmintable actor records a full-sentence void, never a silent drop', async () => {
  delete process.env.CW_MISSING_TOKEN_ENV;
  const r = await RECIPES['static-bearer']({ tokenEnv: 'CW_MISSING_TOKEN_ENV' }).catch((e) => e);
  assert.ok(r instanceof Error);
  assert.match(r.message, /CW_MISSING_TOKEN_ENV is unset/);
});

test('disclosesObject: an empty COLLECTION is not a disclosure, but any real payload is', () => {
  // a filtering REST layer answers a denied read with 200 + [] — not a disclosure
  assert.equal(disclosesObject({ status: 200, len: 2, text: '[]' }), false, 'PostgREST-style empty result');
  assert.equal(disclosesObject({ status: 200, len: 2, text: '{}' }), false);
  assert.equal(disclosesObject({ status: 200, len: 4, text: 'null' }), false);
  assert.equal(disclosesObject({ status: 200, len: 3, text: ' \n ' }), false);
  assert.equal(disclosesObject({ status: 200, len: 0, text: '' }), false);
  assert.equal(disclosesObject({ status: 403, len: 99, text: '{"error":"forbidden"}' }), false, 'non-2xx is never a disclosure');
  assert.equal(disclosesObject({ status: 0, len: 0 }), false, 'a transport failure has no body at all');

  assert.equal(disclosesObject({ status: 200, len: 9, text: '[{"id":1}]' }), true, 'one row IS the object');
  assert.equal(disclosesObject({ status: 200, len: 9, text: '{"id":1}' }), true);
  assert.equal(disclosesObject({ status: 200, len: 20, text: '<html>secret</html>' }), true, 'non-JSON but non-empty is still a body');
  // deliberately conservative: a WRAPPED empty collection still counts — erring toward reporting
  assert.equal(disclosesObject({ status: 200, len: 22, text: '{"data":[],"count":0}' }), true);
});

test('validateManifest enforces the per-recipe credential fields the schema documents', () => {
  const withCred = (credential) => validateManifest({ actors: [{ name: 'a', credential }], discovery: { paths: ['/x'] } }).errors.join('\n');

  // no password env can never mint — a manifest error, not a mid-probe void
  assert.match(withCred({ type: 'keycloak', realm: 'r', client: 'c', username: 'u' }), /credential\.passwordEnv is required/);
  assert.match(withCred({ type: 'supabase', apikeyEnv: 'K' }), /credential\.url is required/);
  assert.match(withCred({ type: 'supabase', apikeyEnv: 'K' }), /credential\.passwordEnv is required/);
  assert.match(withCred({ type: 'login-post', capture: { mode: 'cookie' } }), /credential\.url is required/);

  // a typo'd field would otherwise surface as the baffling "env undefined is unset"
  assert.match(withCred({ type: 'keycloak', passwordEnv: 'P', passwrodEnv: 'P' }), /passwrodEnv is not a field of type "keycloak"/);

  assert.equal(withCred({ type: 'none' }), '');
  assert.equal(withCred({ type: 'static-bearer', tokenEnv: 'T' }), '');
  assert.equal(withCred({ type: 'keycloak', realm: 'r', client: 'c', username: 'u', passwordEnv: 'P' }), '');
});

test('validateManifest accepts custom name:value headers and rejects malformed ones', () => {
  const withHeaders = (headers) => validateManifest({ actors: [{ name: 'a', headers }], discovery: { paths: ['/x'] } }).errors.join('\n');
  assert.equal(withHeaders({ 'X-Tenant-Id': 'tenantA' }), '');
  assert.equal(withHeaders({ 'X-Key': '${ENV:SOME_KEY}' }), '');
  assert.match(withHeaders({ 'X-Tenant-Id': 42 }), /must be a string/);
  assert.match(withHeaders({ 'Bad Header': 'v' }), /is not a valid HTTP header name/);
  assert.match(withHeaders('nope'), /headers must be an object/);
});

test('secretNames collects every *Env value, every ${ENV:…} placeholder, and the recipe defaults', () => {
  const names = secretNames({
    actors: [
      { name: 'anon', role: 'anon' },
      { name: 'a', credential: { type: 'supabase', url: 'https://x', passwordEnv: 'PASS_A' } },   // apikeyEnv omitted
      { name: 'b', credential: { type: 'keycloak', passwordEnv: 'PASS_B' } },                     // realm/client omitted
      { name: 'c', credential: { type: 'static-bearer' }, headers: { 'X-Key': '${ENV:HDR_KEY}' } },
    ],
    objects: { model: 'seed', types: [{ name: 't', create: { path: '/t', body: { k: '${ENV:BODY_TOK}' } }, idPath: 'id', getPath: '/t/{id}' }] },
  });
  // the documented defaults are included, so a name the operator never wrote is still looked up
  assert.deepEqual(names, ['BODY_TOK', 'CW_BEARER', 'HDR_KEY', 'KC_CLIENT', 'KC_REALM', 'PASS_A', 'PASS_B', 'SUPABASE_ANON_KEY']);
});

test('custom headers are merged over the recipe and reach every request', async () => {
  process.env.TOK_H = 'tok-h';
  const [actor] = await resolveActors([
    { name: 'a', role: 'user', tenant: 'tA', credential: { type: 'static-bearer', tokenEnv: 'TOK_H' }, headers: { 'X-Tenant-Id': 'tenantA' } },
  ]);
  assert.equal(actor.void, undefined);
  assert.equal(actor.headers['X-Tenant-Id'], 'tenantA');
  assert.equal(actor.headers.Authorization, 'Bearer tok-h', 'the recipe credential survives alongside the custom header');
  assert.equal(actor.subject, subjectOf('Bearer tok-h'));
});

// ── integration: a real API with a real hole ───────────────────────────────────────
function fakeApi() {
  const things = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || '';
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const [, kind, id] = url.pathname.match(/^\/(vuln|safe)\/(\d+)$/) || [];
    if (req.method === 'POST' && (url.pathname === '/vuln' || url.pathname === '/safe')) {
      if (!auth) return send(401);
      const nid = ++n; things.set(nid, { owner: auth, kind: url.pathname.slice(1) });
      return send(201, { id: nid });
    }
    if (req.method === 'GET' && kind) {
      if (!auth) return send(401);                                   // both require auth to READ
      const t = things.get(Number(id));
      if (!t) return send(404);
      if (kind === 'vuln') return send(200, { id: Number(id), secret: 'THE-OBJECT' }); // BUG: no ownership check
      return t.owner === auth ? send(200, { id: Number(id), secret: 'THE-OBJECT' }) : send(403); // safe: owner-only
    }
    if (req.method === 'GET' && url.pathname === '/open') return send(200, { leak: 'no-auth-needed' }); // anon exposure
    return send(404);
  });
  return server;
}

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${server.address().port}`)));
}

test('end-to-end: seeds owned objects, drives the matrix, finds BOLA + BFLA + unauth-exposure and clears the guarded endpoint', async (t) => {
  const server = fakeApi();
  const base = await listen(server);
  t.after(() => server.close());

  process.env.TOK_A = 'tok-user-a';
  process.env.TOK_B = 'tok-user-b';
  process.env.TOK_ADMIN = 'tok-admin';

  const manifest = {
    base,
    actors: [
      { name: 'anon', role: 'anon' },
      { name: 'userA', role: 'user', tenant: 'default', credential: { type: 'static-bearer', tokenEnv: 'TOK_A' } },
      { name: 'userB', role: 'user', tenant: 'default', credential: { type: 'static-bearer', tokenEnv: 'TOK_B' } },
      { name: 'adminA', role: 'admin', tenant: 'default', credential: { type: 'static-bearer', tokenEnv: 'TOK_ADMIN' } },
    ],
    objects: {
      model: 'seed',
      owners: ['userA', 'userB', 'adminA'],
      types: [
        { name: 'vuln', create: { path: '/vuln', body: { t: 'x' } }, idPath: 'id', getPath: '/vuln/{id}' },
        { name: 'safe', create: { path: '/safe', body: { t: 'x' } }, idPath: 'id', getPath: '/safe/{id}' },
      ],
    },
    discovery: { paths: ['/open'] },
  };

  const out = await run(manifest);
  const types = new Set(out.findings.map((f) => f.type));

  assert.equal(out.summary.ran, true);
  assert.ok(types.has('bola'), 'userB reading userA/adminA vuln object should be flagged BOLA');
  assert.ok(types.has('bfla'), 'a user reading an admin-owned vuln object should be flagged BFLA');
  assert.ok(types.has('unauth-exposure'), '/open served with no auth should be flagged');
  // The correctly-guarded /safe object must NOT produce any finding.
  assert.ok(!out.findings.some((f) => f.objectType === 'safe'), 'the owner-only /safe endpoint must stay clean');
  // The output keeps the rollup contract: top-level findings[] with severities.
  assert.ok(Array.isArray(out.findings) && out.findings.every((f) => f.severity && f.path));
  assert.equal(out.summary.findings, out.findings.length);
});

// A PostgREST-shaped backend with CORRECT row-level security: a denied read is 200 + [], not 403.
function filteringApi() {
  const rows = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || '';
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname !== '/rest/v1/notes') return send(404, {});
    if (req.method === 'POST') { const id = ++n; rows.set(id, auth); return send(201, [{ id }]); }
    const id = Number((url.searchParams.get('id') || '').replace('eq.', ''));
    if (!auth) return send(200, []);                                  // RLS: anon matches no row
    return send(200, rows.get(id) === auth ? [{ id, body: 'mine' }] : []); // RLS: peers match no row
  });
  return server;
}

test('a filtering backend that answers denied reads with 200 + [] is CLEAN, not four findings', async (t) => {
  const server = filteringApi();
  const base = await listen(server);
  t.after(() => server.close());

  process.env.TOK_RLS_A = 'tok-rls-a';
  process.env.TOK_RLS_B = 'tok-rls-b';

  const out = await run({
    base,
    actors: [
      { name: 'anon', role: 'anon' },
      { name: 'userA', role: 'user', tenant: 'orgA', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_A' } },
      { name: 'userB', role: 'user', tenant: 'orgB', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_B' } },
    ],
    objects: {
      model: 'seed',
      types: [{ name: 'note', create: { path: '/rest/v1/notes', body: { body: 'probe' } }, idPath: '0.id', getPath: '/rest/v1/notes?id=eq.{id}' }],
    },
    discovery: { openapi: false, paths: [] },
  });

  assert.equal(out.summary.ran, true, 'it really did probe — this is a clean run, not a void');
  assert.equal(out.summary.ownedObjects, 2, 'both users seeded a row');
  assert.deepEqual(out.findings, [], 'correct row-level security must produce NO findings');
  // and the owner baseline still worked, so the clean result is meaningful rather than vacuous
  assert.equal(out.voids.length, 0, 'no baseline void — each owner could read its own row');
});

test('the same filtering backend WITHOUT row-level security is still caught', async (t) => {
  // the mirror: a predicate that fixed the false positive by going blind would fail here
  const rows = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || '';
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname !== '/rest/v1/notes') return send(404, {});
    if (req.method === 'POST') { const id = ++n; rows.set(id, auth); return send(201, [{ id }]); }
    const id = Number((url.searchParams.get('id') || '').replace('eq.', ''));
    if (!auth) return send(200, []);
    return send(200, rows.has(id) ? [{ id, body: 'mine' }] : []); // BUG: no ownership predicate
  });
  const base = await listen(server);
  t.after(() => server.close());

  process.env.TOK_RLS_A = 'tok-rls-a';
  process.env.TOK_RLS_B = 'tok-rls-b';

  const out = await run({
    base,
    actors: [
      { name: 'userA', role: 'user', tenant: 'orgA', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_A' } },
      { name: 'userB', role: 'user', tenant: 'orgB', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_B' } },
    ],
    objects: {
      model: 'seed',
      types: [{ name: 'note', create: { path: '/rest/v1/notes', body: { body: 'probe' } }, idPath: '0.id', getPath: '/rest/v1/notes?id=eq.{id}' }],
    },
    discovery: { openapi: false, paths: [] },
  });

  assert.ok(out.findings.length > 0, 'a missing ownership predicate must still be caught');
  assert.ok(out.findings.every((f) => f.type === 'cross-tenant'), 'orgA vs orgB makes every break a tenant-isolation break');
});

// The other shape of correct isolation: a scoped-view backend answers a peer with the peer's OWN
// row — 200, non-empty, different bytes — so the classifier must compare WHOSE body came back.
test("a scoped-view backend returning the caller's OWN non-empty row is CLEAN, not a leak", async (t) => {
  const own = new Map(); let n = 0;
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || '';
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname !== '/rest/v1/notes') return send(404, {});
    if (req.method === 'POST') { const id = ++n; own.set(auth, id); return send(201, [{ id }]); }
    if (!auth) return send(200, []);
    const mine = own.get(auth);                                     // the id in the URL is IGNORED —
    return send(200, mine ? [{ id: mine, body: `note-of-${auth}` }] : []); // always the caller's OWN row
  });
  const base = await listen(server);
  t.after(() => server.close());
  process.env.TOK_RLS_A = 'tok-rls-a'; process.env.TOK_RLS_B = 'tok-rls-b';

  const out = await run({
    base,
    actors: [
      { name: 'userA', role: 'user', tenant: 'orgA', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_A' } },
      { name: 'userB', role: 'user', tenant: 'orgB', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_B' } },
    ],
    objects: { model: 'seed', types: [{ name: 'note', create: { path: '/rest/v1/notes', body: { body: 'probe' } }, idPath: '0.id', getPath: '/rest/v1/notes?id=eq.{id}' }] },
    discovery: { openapi: false, paths: [] },
  });
  assert.equal(out.summary.ran, true);
  assert.equal(out.summary.ownedObjects, 2, 'both users seeded a row');
  assert.deepEqual(out.findings, [], "a peer receiving its OWN row (different bytes) is not a leak");
  assert.equal(out.voids.length, 0, 'bodies are distinguishable per owner, so the cell is decisive, not a void');
});

test('byte-identical bodies across owners are an INDETERMINATE void, never a critical', async (t) => {
  // shared/static resource: every caller sees the SAME bytes — a coverage void, never a critical
  let n = 0;
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || '';
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (url.pathname !== '/rest/v1/notes') return send(404, {});
    if (req.method === 'POST') { const id = ++n; return send(201, [{ id }]); }
    if (!auth) return send(200, []);
    return send(200, [{ id: 1, body: 'SHARED' }]);                  // identical bytes for everyone
  });
  const base = await listen(server);
  t.after(() => server.close());
  process.env.TOK_RLS_A = 'tok-rls-a'; process.env.TOK_RLS_B = 'tok-rls-b';

  const out = await run({
    base,
    actors: [
      { name: 'userA', role: 'user', tenant: 'orgA', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_A' } },
      { name: 'userB', role: 'user', tenant: 'orgB', credential: { type: 'static-bearer', tokenEnv: 'TOK_RLS_B' } },
    ],
    objects: { model: 'seed', types: [{ name: 'note', create: { path: '/rest/v1/notes', body: { body: 'probe' } }, idPath: '0.id', getPath: '/rest/v1/notes?id=eq.{id}' }] },
    discovery: { openapi: false, paths: [] },
  });
  assert.deepEqual(out.findings, [], 'indeterminate content must not be scored a critical');
  assert.ok(out.voids.some((v) => /BYTE-IDENTICAL/.test(v)), 'it is recorded as an indeterminate coverage void');
});

test('run streams progress through onProgress when supplied', async () => {
  const server = fakeApi();
  const base = await listen(server);
  try {
    process.env.TOK_A = 'tok-a'; process.env.TOK_B = 'tok-b';
    const lines = [];
    await run({
      base,
      actors: [
        { name: 'userA', role: 'user', tenant: 'default', credential: { type: 'static-bearer', tokenEnv: 'TOK_A' } },
        { name: 'userB', role: 'user', tenant: 'default', credential: { type: 'static-bearer', tokenEnv: 'TOK_B' } },
      ],
      objects: { model: 'seed', owners: ['userA', 'userB'], types: [{ name: 'vuln', create: { path: '/vuln', body: {} }, idPath: 'id', getPath: '/vuln/{id}' }] },
    }, { onProgress: (l) => lines.push(l) });
    assert.ok(lines.some((l) => /minted/.test(l)), 'reports minted actors');
    assert.ok(lines.some((l) => /owned object/.test(l)), 'reports the object count');
  } finally { server.close(); }
});

test('no target ⇒ a descriptive void, never a clean pass', async () => {
  const prev = process.env.CW_TARGET_URL; delete process.env.CW_TARGET_URL;
  const out = await run({ actors: [{ name: 'anon', role: 'anon' }], discovery: { paths: ['/x'] } }, {});
  if (prev !== undefined) process.env.CW_TARGET_URL = prev;
  assert.equal(out.ran, false);
  assert.equal(out.skipped, true);
  assert.match(out.reason, /no target/);
});

test('autodiscover falls back to explicit paths when no spec answers', async () => {
  const server = createServer((req, res) => { res.writeHead(404); res.end(); });
  const base = await listen(server);
  try {
    const d = await autodiscover(base, { paths: ['/things/{id}'] }, {});
    assert.equal(d.specAt, null);
    assert.deepEqual(d.paths, ['/things/1']);
    assert.ok(d.tried.length > 0, 'records which spec paths it tried (coverage is auditable)');
  } finally { server.close(); }
});
