// GET /api/secrets through its handler: presence only. Each declared name comes back with its
// backend and whether it resolves, each name a bundled manifest demands but nobody declared comes
// back as undeclared, and no credential VALUE appears anywhere in the body.
//
// CW_SECRETS_FILE is set BEFORE lib/secrets.mjs is imported, on purpose: that module captures the
// variable at load (SECRETS_FILE), so importing first would aim status() at the operator's real ref
// table and probe its keychain refs. Every ref in the fixture is `file:`, never `keychain:`, so no
// `security` process is ever spawned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFESTS = join(HERE, '..', '..', 'manifests');
const TMP = mkdtempSync(join(tmpdir(), 'cw-secrets-route-'));
const TABLE = join(TMP, 'secrets.json');
const TOML = join(TMP, 'svc.toml');

const savedEnv = { CW_SECRETS_FILE: process.env.CW_SECRETS_FILE, CWFX_SHADOWED: process.env.CWFX_SHADOWED };
process.env.CW_SECRETS_FILE = TABLE;
const { SECRETS_FILE } = await import('../../lib/secrets.mjs');
const { routes } = await import('../routes/secrets.mjs');
// The guard the rest of the file stands on: if this ever fails, status() is reading a live table.
assert.equal(SECRETS_FILE, TABLE, 'lib/secrets.mjs did not pick up the fixture table — refusing to call status()');

after(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(TMP, { recursive: true, force: true });
});

// Credential-shaped values, built at run time so no literal secret sits in the tree.
const VALUE = ['cwfx', 'tok', randomBytes(16).toString('hex')].join('_');
const SHADOW_VALUE = ['cwfx', 'env', randomBytes(16).toString('hex')].join('_');
writeFileSync(TOML, `[service]\napi_key = "${VALUE}"\nempty_key = ""\n`);

const FIXTURE_TABLE = {
  version: 1,
  secrets: {
    CWFX_FILE_TOKEN: `file:${TOML}#api_key`,
    CWFX_EMPTY: `file:${TOML}#empty_key`,
    CWFX_NO_KEY: `file:${TOML}#absent_key`,
    CWFX_NO_FILE: `file:${join(TMP, 'gone.toml')}#api_key`,
    CWFX_SHADOWED: `file:${TOML}#api_key`,
  },
};

const route = routes.find((r) => r.method === 'GET' && r.path === '/api/secrets');
const call = ({ session = null, loopback = false } = {}) => new Promise((resolve) => {
  route.handle({ req: {}, isLoopbackReq: loopback, adminSession: () => session, send: (code, payload) => resolve({ code, payload }) });
});
const SESSION = { user: 'op@example.test', provider: 'password' };

/** The second witness for `undeclared`: the bundled manifests' own demands, read independently. */
function demanded() {
  const out = new Map();
  for (const f of readdirSync(MANIFESTS).filter((n) => n.endsWith('.json')).sort()) {
    let m; try { m = JSON.parse(readFileSync(join(MANIFESTS, f), 'utf8')); } catch { continue; }
    for (const c of m.checks || []) {
      for (const name of (c.requires && c.requires.secrets) || []) {
        if (!out.has(name)) out.set(name, []);
        out.get(name).push({ check: c.id, manifest: f.replace(/\.json$/, '') });
      }
    }
  }
  return out;
}

const noValueIn = (payload) => {
  const text = JSON.stringify(payload);
  for (const v of [VALUE, SHADOW_VALUE]) {
    assert.ok(!text.includes(v), 'a credential value reached the response body');
    // no fragment either — a truncated or "redacted" value still leaks most of the credential
    for (let i = 0; i + 12 <= v.length; i += 6) assert.ok(!text.includes(v.slice(i, i + 12)), `a 12-char fragment of a credential reached the body: offset ${i}`);
  }
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, x] of Object.entries(o)) { assert.notEqual(k, 'value', 'a row carries a value field'); walk(x); }
  };
  walk(payload);
};

test('GET /api/secrets refuses without a session — on the published port and on the operator port alike', async () => {
  writeFileSync(TABLE, JSON.stringify(FIXTURE_TABLE));
  for (const loopback of [false, true]) {
    const r = await call({ session: null, loopback });
    assert.equal(r.code, 401, `loopback=${loopback}`);
    assert.deepEqual(r.payload, { error: 'not signed in' });
  }
});

// FAIL CLOSED: the gate used to run only when the ctx carried an adminSession function, and it
// accepted any truthy session, so both of these answered 200 with the ref table.
test('GET /api/secrets refuses a ctx with no session function, and a session that names no user', async () => {
  writeFileSync(TABLE, JSON.stringify(FIXTURE_TABLE));
  const answer = (ctx) => new Promise((resolve) => route.handle({ req: {}, ...ctx, send: (code, payload) => resolve({ code, payload }) }));
  const cases = [
    ['no adminSession in the ctx', {}],
    ['adminSession is not a function', { adminSession: true }],
    ['a session with no user', { adminSession: () => ({ provider: 'github' }) }],
    ['a session whose user is null', { adminSession: () => ({ provider: 'github', user: null }) }],
    ['a session whose user is empty', { adminSession: () => ({ provider: 'password', user: '' }) }],
  ];
  for (const [what, ctx] of cases) {
    const r = await answer(ctx);
    assert.equal(r.code, 401, what);
    assert.deepEqual(r.payload, { error: 'not signed in' }, what);
  }
});

// A requires.secrets entry is an env var name: commitwork's requirement check and this route both
// look it up as one. Prose there is a name nothing can ever declare, so its check reads as blocked
// on every box (bola-run's "the manifest's named credentials, …" did exactly that).
test('every secret a bundled manifest demands is an env var name, never prose', async () => {
  const shape = /^[A-Za-z_][A-Za-z0-9_]*$/;
  for (const [name, by] of demanded()) assert.match(name, shape, `${JSON.stringify(name)} demanded by ${by.map((b) => `${b.manifest}:${b.check}`).join(', ')}`);
  writeFileSync(TABLE, JSON.stringify(FIXTURE_TABLE));
  const r = await call({ session: SESSION });
  for (const s of r.payload.secrets) assert.match(s.name, shape, `the route listed ${JSON.stringify(s.name)} as a secret`);
});

test('GET /api/secrets reports presence and resolvability per name, and never a value', async () => {
  writeFileSync(TABLE, JSON.stringify(FIXTURE_TABLE));
  process.env.CWFX_SHADOWED = SHADOW_VALUE;
  let r;
  try { r = await call({ session: SESSION }); } finally { delete process.env.CWFX_SHADOWED; }
  assert.equal(r.code, 200);
  const p = r.payload;
  assert.equal(p.storeError, null);
  assert.match(p.generated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(p.note, /^Presence only\./);

  const row = (n) => p.secrets.find((s) => s.name === n);
  assert.deepEqual(
    Object.fromEntries(['CWFX_FILE_TOKEN', 'CWFX_EMPTY', 'CWFX_NO_KEY', 'CWFX_NO_FILE', 'CWFX_SHADOWED']
      .map((n) => [n, [row(n).declared, row(n).backend, row(n).resolvable, row(n).reason ?? null, row(n).envOverride]])),
    {
      CWFX_FILE_TOKEN: [true, 'file', true, null, false],
      CWFX_EMPTY: [true, 'file', false, 'empty', false],
      CWFX_NO_KEY: [true, 'file', false, 'no-key', false],
      CWFX_NO_FILE: [true, 'file', false, 'not-found', false],
      CWFX_SHADOWED: [true, 'file', true, null, true],
    });
  assert.equal(row('CWFX_FILE_TOKEN').ref, FIXTURE_TABLE.secrets.CWFX_FILE_TOKEN, 'the REF is reported; it names a location, not a credential');
  assert.deepEqual(row('CWFX_FILE_TOKEN').blocks, [], 'no manifest demands a fixture name');

  // undeclared: every name a manifest demands that the table does not declare, with what it blocks
  const D = demanded();
  for (const n of FIXTURE_TABLE.secrets ? Object.keys(FIXTURE_TABLE.secrets) : []) assert.ok(!D.has(n), `fixture name ${n} collides with a manifest demand`);
  const undeclared = p.secrets.filter((s) => !s.declared);
  assert.deepEqual(undeclared.map((s) => s.name).sort(), [...D.keys()].sort());
  for (const s of undeclared) {
    assert.equal(s.reason, 'undeclared');
    assert.equal(s.resolvable, false);
    assert.equal(s.ref, null);
    assert.deepEqual(s.blocks, D.get(s.name));
  }

  assert.deepEqual(p.counts, {
    total: 5 + D.size, resolvable: 2, unresolvable: 3, undeclared: D.size, overridden: 1,
  });
  assert.deepEqual(p.blockedChecks, [...new Set([...D.values()].flat().map((b) => b.check))].sort());
  // declared rows first, then by name
  const order = p.secrets.map((s) => `${s.declared ? 0 : 1}:${s.name}`);
  assert.deepEqual(order, [...order].sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a.slice(2).localeCompare(b.slice(2)))));

  noValueIn(p);
});

test('an unparseable ref table is reported as a store error, never as an empty table', async () => {
  writeFileSync(TABLE, '{ "version": 1, "secrets": { "CWFX_FILE_TOKEN": ');
  const r = await call({ session: SESSION });
  assert.equal(r.code, 200);
  assert.match(r.payload.storeError, /not valid JSON.*refusing to treat it as empty/);
  assert.equal(r.payload.secrets.filter((s) => s.declared).length, 0);
  // an unread table is no evidence that anything is undeclared, or that any check is blocked
  const D = demanded();
  assert.deepEqual(r.payload.secrets.map((s) => [s.name, s.reason, s.declared]).sort(),
    [...D.keys()].map((n) => [n, 'undetermined', null]).sort());
  assert.equal(r.payload.counts.undeclared, null);
  assert.equal(r.payload.counts.undetermined, D.size);
  assert.equal(r.payload.blockedChecks, null);
  noValueIn(r.payload);
});

test('a ref the table cannot parse is a store error naming it, not a silently dropped row', async () => {
  writeFileSync(TABLE, JSON.stringify({ version: 1, secrets: { CWFX_FILE_TOKEN: `file:${TOML}#api_key`, CWFX_BAD: 'plaintext:oops' } }));
  const r = await call({ session: SESSION });
  assert.equal(r.code, 200);
  assert.match(r.payload.storeError, /CWFX_BAD has an unparseable ref/);
  assert.equal(r.payload.secrets.some((s) => s.name === 'CWFX_FILE_TOKEN'), false, 'one bad ref fails the table; nothing is half-served');
  noValueIn(r.payload);
});

test('the route is GET-only in the dispatch table — a POST to the path reaches no handler', () => {
  assert.deepEqual(routes.filter((r) => r.path === '/api/secrets').map((r) => r.method), ['GET']);
});
