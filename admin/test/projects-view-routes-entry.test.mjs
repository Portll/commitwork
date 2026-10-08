// POST /api/projects/add and POST /api/projects/semgrep-pro, invoked through their HTTP handlers
// against a temp registry (CW_REGISTRY, read at call time). projects-view-route.test.mjs drives the
// pure addProject() and only proves each handler 401s; this file covers what the handlers add on
// top: the body-parser refusal, the status each refusal maps to, the identity they pass down, and
// the registry bytes on disk after each call — unchanged after every refusal, valid after a write.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/projects-view.mjs';
import { loadRegistry, SEMGREP_PRO_MAX } from '../../monitor/registry.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'cw-pv-entry-'));
const REG = join(ROOT, 'projects.json');
const saved = process.env.CW_REGISTRY;
const KIDS = Array.from({ length: SEMGREP_PRO_MAX + 1 }, (_, i) => `svc-${String(i + 1).padStart(2, '0')}`);

const repo = (...segs) => { const p = join(ROOT, ...segs); mkdirSync(join(p, '.git'), { recursive: true }); return p; };

before(() => {
  repo('repos', 'declared-repo');
  repo('repos', 'newrepo');
  repo('repos', 'other-new');
  mkdirSync(join(ROOT, 'repos', 'plain'), { recursive: true });
  for (const k of KIDS) mkdirSync(join(ROOT, 'fleet', k), { recursive: true });
  writeFileSync(REG, JSON.stringify({
    reportsRoot: join(ROOT, 'reports'), defaultManifest: 'security-baseline', roots: [],
    areas: [{ slug: 'a1', label: 'Area One', out: 'a1', members: ['declared-repo'] }],
    projects: [
      { name: 'declared-repo', area: 'a1', path: join(ROOT, 'repos', 'declared-repo'), manifest: 'security-baseline' },
      { name: 'fleetgroup', area: 'a1', path: join(ROOT, 'fleet'), manifest: 'security-baseline', expand: 'children' },
    ],
  }, null, 2) + '\n');
  process.env.CW_REGISTRY = REG;
});
after(() => {
  if (saved === undefined) delete process.env.CW_REGISTRY; else process.env.CW_REGISTRY = saved;
  rmSync(ROOT, { recursive: true, force: true });
});

const ADD = routes.find((r) => r.method === 'POST' && r.path === '/api/projects/add');
const PRO = routes.find((r) => r.method === 'POST' && r.path === '/api/projects/semgrep-pro');
const call = (route, { body = {}, bodyErr = null, loopback = false, session = null } = {}) => new Promise((resolve) => {
  route.handle({
    req: {}, isLoopbackReq: loopback, adminSession: () => session,
    readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
    send: (code, payload) => resolve({ code, payload }),
  });
});
const bytes = () => readFileSync(REG, 'utf8');
const doc = () => JSON.parse(bytes());

test('both writes refuse a remote caller with no session, and the registry does not move', async () => {
  const before = bytes();
  for (const route of [ADD, PRO]) {
    for (const session of [null, { provider: 'password' }]) {
      const r = await call(route, { session, body: { name: 'newrepo', path: join(ROOT, 'repos', 'newrepo'), area: 'a1', repos: ['svc-01'] } });
      assert.equal(r.code, 401, route.path);
      assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
    }
  }
  assert.equal(bytes(), before);
});

test('the body parser\'s refusal is a 400 with its reason on both routes', async () => {
  for (const route of [ADD, PRO]) {
    const r = await call(route, { loopback: true, bodyErr: 'body is not valid JSON' });
    assert.equal(r.code, 400, route.path);
    assert.deepEqual(r.payload, { ok: false, error: 'body is not valid JSON' });
  }
});

test('add: each refusal keeps its own status, carries no `code` field, and writes nothing', async () => {
  const before = bytes();
  const cases = [
    [{ name: 'bad name!', path: join(ROOT, 'repos', 'newrepo'), area: 'a1' }, 400, /name must match/],
    [{ name: 'plain', path: join(ROOT, 'repos', 'plain'), area: 'a1' }, 400, /not a git repository/],
    [{ name: 'newrepo', path: join(ROOT, 'repos', 'newrepo'), area: 'fresh' }, 400, /pass createArea:true/],
    [{ name: 'declared-repo', path: join(ROOT, 'repos', 'newrepo'), area: 'a1' }, 409, /already exists/],
    [{ name: 'x', path: join(ROOT, 'repos', 'declared-repo'), area: 'a1' }, 409, /overlaps the explicit project 'declared-repo'/],
  ];
  for (const [body, code, re] of cases) {
    const r = await call(ADD, { loopback: true, body });
    assert.equal(r.code, code, JSON.stringify(body));
    assert.equal(r.payload.ok, false);
    assert.match(r.payload.error, re);
    assert.equal('code' in r.payload, false, 'the status travels as the status, not inside the body');
  }
  const unknownArea = await call(ADD, { loopback: true, body: { name: 'newrepo', path: join(ROOT, 'repos', 'newrepo'), area: 'fresh' } });
  assert.deepEqual(unknownArea.payload.areas, ['a1'], 'the refusal offers the areas that exist');
  assert.equal(bytes(), before);
});

test('add: the operator port registers a repo, attributed to the operator, in a registry the loader accepts', async () => {
  const r = await call(ADD, { loopback: true, body: { name: 'newrepo', path: join(ROOT, 'repos', 'newrepo'), area: 'a1', note: 'synthetic fixture' } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.ok, true);
  assert.equal(r.payload.areaCreated, false);
  assert.equal(r.payload.alreadyDiscovered, false);
  const { entry } = r.payload;
  assert.deepEqual({ name: entry.name, area: entry.area, path: entry.path, manifest: entry.manifest },
    { name: 'newrepo', area: 'a1', path: join(ROOT, 'repos', 'newrepo'), manifest: 'security-baseline' });
  assert.match(entry.note, /^registered via the panel by operator@loopback, \d{4}-\d{2}-\d{2}T.* — synthetic fixture$/);

  const written = doc().projects.find((p) => p.name === 'newrepo');
  assert.deepEqual(written, entry, 'the registry holds exactly the entry the reply described');
  assert.doesNotThrow(() => loadRegistry({ path: REG, quiet: true }), 'the panel must still be able to boot on what was written');
});

test('add: a signed-in session on the published port may register too', async () => {
  const r = await call(ADD, { session: { user: 'op@example.test', provider: 'password' },
    body: { name: 'other-new', path: join(ROOT, 'repos', 'other-new'), area: 'a1' } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.ok(doc().projects.some((p) => p.name === 'other-new'));
});

test('semgrep-pro: bad shapes, unscanned names and an over-cap list are refused before any write', async () => {
  const before = bytes();
  const notArray = await call(PRO, { loopback: true, body: { repos: 'svc-01' } });
  assert.equal(notArray.code, 400);
  assert.match(notArray.payload.error, /repos must be an array/);

  const nonString = await call(PRO, { loopback: true, body: { repos: ['svc-01', 7] } });
  assert.equal(nonString.code, 400);
  assert.match(nonString.payload.error, /non-string entry/);

  // the GROUP is not a scanned repository — the children it expands to are
  const group = await call(PRO, { loopback: true, body: { repos: ['fleetgroup', 'svc-01'] } });
  assert.equal(group.code, 400);
  assert.deepEqual(group.payload.unknown, ['fleetgroup']);
  assert.match(group.payload.error, /do not name a repository this fleet scans: fleetgroup/);

  const over = await call(PRO, { loopback: true, body: { repos: KIDS } });
  assert.equal(over.code, 400);
  assert.match(over.payload.error, /would be invalid after this write/);
  assert.ok(over.payload.errors.some((e) => e.includes(`the licence allows ${SEMGREP_PRO_MAX}`)), JSON.stringify(over.payload.errors));
  assert.equal(bytes(), before, 'no refusal reached the registry');
});

test('a signed-in session is credited by its email, which sessions store as a plain string', async () => {
  const r = await call(PRO, { session: { provider: 'password', user: 'op@example.test' }, body: { repos: ['svc-01'] } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.who, 'op@example.test');
  const cleared = await call(PRO, { loopback: true, body: { repos: [] } });
  assert.equal(cleared.code, 200);
});

test('semgrep-pro: the whole intended set is written normalised, and an empty set removes the key', async () => {
  const r = await call(PRO, { loopback: true, body: { repos: ['svc-02', ' declared-repo ', 'svc-01', 'svc-02', ''] } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.deepEqual(r.payload, { ok: true, repos: ['declared-repo', 'svc-01', 'svc-02'], count: 3, who: 'operator@loopback' });
  assert.deepEqual(doc().semgrepPro, { repos: ['declared-repo', 'svc-01', 'svc-02'] });
  assert.doesNotThrow(() => loadRegistry({ path: REG, quiet: true }));

  const cleared = await call(PRO, { loopback: true, body: { repos: [] } });
  assert.equal(cleared.code, 200);
  assert.equal(cleared.payload.count, 0);
  assert.equal('semgrepPro' in doc(), false, 'an empty allocation is no key, not an empty array');
});

test('an unparseable registry is a 503 on both routes and its bytes survive', async () => {
  const torn = '{ "projects": [ ';
  writeFileSync(REG, torn);
  const a = await call(ADD, { loopback: true, body: { name: 'late', path: join(ROOT, 'repos', 'newrepo'), area: 'a1' } });
  assert.equal(a.code, 503);
  assert.match(a.payload.error, /refusing to write over what could not be parsed/);
  const p = await call(PRO, { loopback: true, body: { repos: ['svc-01'] } });
  assert.equal(p.code, 503);
  assert.match(p.payload.error, /refusing to write over what could not be checked/);
  assert.equal(bytes(), torn);
});

test('both writes are POST-only in the dispatch table', () => {
  for (const p of ['/api/projects/add', '/api/projects/semgrep-pro']) {
    assert.deepEqual(routes.filter((r) => r.path === p).map((r) => r.method), ['POST'], p);
  }
});
