// node --test admin/test/ — the Projects tab's route: the designated-folder walk joined against
// the registry, and the add-project write path.
//
// Everything runs on fixtures: a mkdtemp folder tree stands in for ~/Repositories, and a fixture
// registry file reached via CW_REGISTRY (read at CALL time by the module under test, which is the
// property one test here exists to prove). The load-bearing assertions are the FAIL-CLOSED ones —
// an absent or unreadable root must render as its own state, never as an empty (clean-looking)
// tree — and the write gate: no byte reaches the registry file unless the modified document passes
// the same two validators loadRegistry() applies, because the panel refuses to boot on a registry
// it cannot load.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectsTree, addProject, setSemgrepPro, designatedRoots, routes } from '../routes/projects-view.mjs';
import { EXAMPLE_REGISTRY_PATH } from '../../monitor/registry.mjs';

let ROOT;       // the fixture "Repositories" folder
let REGFILE;    // the fixture registry the env override points at

const mkrepo = (...segs) => { const p = join(ROOT, ...segs); mkdirSync(join(p, '.git'), { recursive: true }); return p; };

function baseReg() {
  return {
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    exclude: ['banished'],
    areas: [
      { slug: 'a1', label: 'Area One', out: 'a1', members: ['declared-repo'] },
    ],
    projects: [
      { name: 'declared-repo', area: 'a1', path: join(ROOT, 'OrgA', 'declared-repo'), manifest: 'security-baseline' },
      { name: 'faraway', area: 'faraway', path: join(tmpdir(), 'cw-projects-view-nowhere', 'faraway'), manifest: 'security-baseline' },
    ],
    roots: [{ path: ROOT, maxDepth: 2 }],
  };
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'cw-pjtree-'));
  // OrgA/{declared-repo, wildling}, top-level loner + banished + plainfolder (no .git anywhere)
  mkrepo('OrgA', 'declared-repo');
  mkrepo('OrgA', 'wildling');
  mkrepo('loner');
  mkrepo('banished');
  mkdirSync(join(ROOT, 'OrgA', 'notrepo'), { recursive: true });
  REGFILE = join(ROOT, 'registry.json');   // inside ROOT is fine: dotfiles/files are not walked
  writeFileSync(REGFILE, JSON.stringify(baseReg(), null, 2) + '\n');
  process.env.CW_REGISTRY = REGFILE;
  delete process.env.CW_PROJECTS_ROOT;
});

afterEach(() => {
  delete process.env.CW_REGISTRY;
  delete process.env.CW_PROJECTS_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
});

const flat = (t) => [
  ...t.roots.flatMap((r) => (r.groups || []).flatMap((g) => g.nodes)),
  ...(t.outside || []),
];
const byName = (t, n) => flat(t).find((x) => x.name === n);

test('the tree mirrors the folder structure and joins every state', () => {
  const t = projectsTree({ reg: baseReg(), selfRoot: '/nonexistent-self' });
  assert.equal(t.ok, true);
  assert.equal(t.roots.length, 1);
  assert.equal(t.roots[0].state, 'walked');

  const declared = byName(t, 'declared-repo');
  assert.equal(declared.status, 'registered');
  assert.equal(declared.areaLabel, 'Area One');
  assert.equal(declared.rel, 'OrgA/declared-repo', 'folder structure must survive into the payload');

  assert.equal(byName(t, 'wildling').status, 'discovered', 'a git repo under an org folder is picked up by the roots walk');
  assert.equal(byName(t, 'loner').status, 'discovered', 'a git repo directly under the root is picked up');
  assert.equal(byName(t, 'banished').status, 'excluded', 'an excluded name renders as excluded — it must never vanish');
  assert.equal(byName(t, 'notrepo').status, 'not-a-repo', 'a folder without .git is its own state, not absent');

  // the dangling explicit entry still appears — a declaration whose path is missing is a finding
  const far = byName(t, 'faraway');
  assert.equal(far.status, 'dangling');
  assert.ok(far.reason);

  const c = t.counts;
  assert.equal(c.registered, 1);
  assert.equal(c.discovered, 2);
  assert.equal(c.excluded, 1);
});

test('an absent designated folder is a displayed state, never an empty tree', () => {
  const reg = baseReg();
  reg.roots = [{ path: join(tmpdir(), 'cw-pjtree-does-not-exist'), maxDepth: 2 }];
  const t = projectsTree({ reg, selfRoot: '/nonexistent-self' });
  assert.equal(t.ok, true, 'one bad root fails THAT root, not the payload');
  assert.equal(t.roots[0].state, 'absent');
  assert.ok(t.roots[0].reason);
  assert.equal((t.roots[0].groups || []).length, 0);
});

test('an unreadable designated folder reads as UNREADABLE, not as empty', (tc) => {
  if (process.getuid && process.getuid() === 0) return tc.skip('root ignores modes');
  const reg = baseReg();
  const locked = join(ROOT, 'locked-root');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  let t;
  try { t = projectsTree({ reg: { ...reg, roots: [{ path: locked, maxDepth: 2 }] }, selfRoot: '/nonexistent-self' }); }
  finally { chmodSync(locked, 0o755); }   // restore BEFORE afterEach's rmSync, or cleanup fails
  assert.equal(t.roots[0].state, 'unreadable');
  assert.match(t.roots[0].reason, /UNKNOWN, not empty/);
});

test('CW_PROJECTS_ROOT is read at call time and replaces the registry roots', () => {
  const other = mkdtempSync(join(tmpdir(), 'cw-pjtree-env-'));
  try {
    mkdirSync(join(other, 'envrepo', '.git'), { recursive: true });
    process.env.CW_PROJECTS_ROOT = other;   // set AFTER import — module-load reads would miss it
    const roots = designatedRoots(baseReg());
    assert.equal(roots.length, 1);
    assert.equal(roots[0].source, 'env:CW_PROJECTS_ROOT');
    const t = projectsTree({ reg: baseReg(), selfRoot: '/nonexistent-self' });
    assert.ok(byName(t, 'envrepo'), 'the override folder is the one walked');
    assert.equal(flat(t).some((n) => n.name === 'wildling'), false, 'the registry root is replaced, not merged');
  } finally { rmSync(other, { recursive: true, force: true }); }
});

test('the panel checkout itself renders as its own state, never as a coverage gap', () => {
  const reg = baseReg();
  const t = projectsTree({ reg, selfRoot: join(ROOT, 'loner') });
  assert.equal(byName(t, 'loner').status, 'self');
});

// ── the write path ──────────────────────────────────────────────────────────────────────────────

test('addProject appends a valid explicit entry atomically and reports discovery overlap', () => {
  const r = addProject({ name: 'wildling', path: join(ROOT, 'OrgA', 'wildling'), area: 'a1' }, { who: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.alreadyDiscovered, true, 'the roots walk already covered it, and the response must say so');
  const doc = JSON.parse(readFileSync(REGFILE, 'utf8'));
  const entry = doc.projects.find((p) => p.name === 'wildling');
  assert.equal(entry.area, 'a1');
  assert.equal(entry.manifest, 'security-baseline', 'manifest defaults from defaultManifest');
  assert.match(entry.note, /registered via the panel by test/);
  // the write must leave a registry the loader would accept
  const after = projectsTree({ reg: doc, selfRoot: '/nonexistent-self' });
  assert.equal(byName(after, 'wildling').status, 'registered');
});

test('a new area can be declared in the same write, but only deliberately', () => {
  const refused = addProject({ name: 'loner', path: join(ROOT, 'loner'), area: 'fresh-area' }, { who: 'test' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 400);
  assert.ok(Array.isArray(refused.areas), 'the refusal offers the known areas');

  const r = addProject({ name: 'loner', path: join(ROOT, 'loner'), area: 'fresh-area', createArea: true }, { who: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.areaCreated, true);
  const doc = JSON.parse(readFileSync(REGFILE, 'utf8'));
  assert.ok(doc.areas.some((a) => a.slug === 'fresh-area'));
});

test('own-name area needs no block — the registry rule, honoured here', () => {
  const r = addProject({ name: 'loner', path: join(ROOT, 'loner'), area: 'loner' }, { who: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.areaCreated, false);
});

test('every refusal path refuses without writing', () => {
  const before = readFileSync(REGFILE, 'utf8');
  const cases = [
    [{ name: 'bad name!', path: join(ROOT, 'loner'), area: 'a1' }, /name must match/],
    [{ name: 'x', path: join(ROOT, 'nope-does-not-exist'), area: 'a1' }, /does not exist/],
    [{ name: 'x', path: join(ROOT, 'OrgA', 'notrepo'), area: 'a1' }, /not a git repository/],
    [{ name: 'declared-repo', path: join(ROOT, 'loner'), area: 'a1' }, /already exists/],
    [{ name: 'x', path: join(ROOT, 'OrgA', 'declared-repo'), area: 'a1' }, /overlaps the explicit project/],
    [{ name: 'x', path: join(ROOT, 'loner'), area: 'NOT-A-SLUG' }, /area must match/],
  ];
  for (const [body, re] of cases) {
    const r = addProject(body, { who: 'test' });
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.match(r.error, re);
  }
  assert.equal(readFileSync(REGFILE, 'utf8'), before, 'a refusal must leave the registry byte-identical');
});

test('a non-repo directory can be registered only with force:true', () => {
  const r = addProject({ name: 'notrepo', path: join(ROOT, 'OrgA', 'notrepo'), area: 'a1', force: true }, { who: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('an unparseable registry is never written over', () => {
  writeFileSync(REGFILE, '{ this is not json');
  const r = addProject({ name: 'loner', path: join(ROOT, 'loner'), area: 'a1' }, { who: 'test' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 503);
  assert.equal(readFileSync(REGFILE, 'utf8'), '{ this is not json', 'the broken bytes must survive for a human to look at');
});

// ── HTTP surface ────────────────────────────────────────────────────────────────────────────────

test('every route is registered and every one refuses a remote caller with no session', () => {
  // The COUNT is asserted so a route added later cannot slip past the loop below without anyone
  // deciding it should be reachable. semgrep-pro joined on 2026-08-29: it writes the registry, so
  // it is exactly the kind of route that must not acquire a remote caller by being forgotten here.
  assert.equal(routes.length, 3);
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`).sort(),
    ['GET /api/projects/tree', 'POST /api/projects/add', 'POST /api/projects/semgrep-pro']);
  for (const r of routes) {
    const seen = [];
    r.handle({ send: (code, body) => seen.push({ code, body }), isLoopbackReq: false, adminSession: () => null, req: {} });
    assert.equal(seen[0].code, 401, `${r.method} ${r.path} must refuse without auth`);
  }
});

test('the loopback operator gets the tree without a session, matching the panel gate', () => {
  const seen = [];
  routes[0].handle({ send: (code, body) => seen.push({ code, body }), isLoopbackReq: true, adminSession: () => null, req: {} });
  assert.equal(seen[0].code, 200);
  assert.equal(seen[0].body.ok, true);
});

// A fresh clone has no registry, and registryPath() then resolves the shipped example for reads.
// The first add used to land in that tracked file.
test('the first add on a checkout with no registry creates the real one and leaves the example alone', () => {
  delete process.env.CW_REGISTRY;
  const exampleBefore = readFileSync(EXAMPLE_REGISTRY_PATH, 'utf8');
  const self = mkdtempSync(join(tmpdir(), 'cw-pj-fresh-'));
  try {
    const r = addProject({ name: 'loner', path: join(ROOT, 'loner'), area: 'local' }, { who: 'test', selfRoot: self });
    assert.equal(r.ok, true, JSON.stringify(r));
    const created = join(self, 'monitor', 'private', 'projects.json');
    assert.equal(r.registryCreated, created);
    const reg = JSON.parse(readFileSync(created, 'utf8'));
    assert.deepEqual(reg.projects.map((x) => x.name), ['loner']);
    assert.deepEqual(reg.areas.map((x) => x.slug), ['local']);
    if (process.platform !== 'win32') assert.equal(statSync(join(self, 'monitor', 'private')).mode & 0o777, 0o700);
    assert.equal(readFileSync(EXAMPLE_REGISTRY_PATH, 'utf8'), exampleBefore, 'the shipped example was written');
  } finally { rmSync(self, { recursive: true, force: true }); }
});

test('a writer aimed at the shipped example refuses, names init, and writes nothing', () => {
  process.env.CW_REGISTRY = EXAMPLE_REGISTRY_PATH;
  const before = readFileSync(EXAMPLE_REGISTRY_PATH, 'utf8');
  const add = addProject({ name: 'loner', path: join(ROOT, 'loner'), area: 'loner' }, { who: 'test' });
  assert.equal(add.ok, false);
  assert.equal(add.code, 409);
  assert.match(add.error, /commitwork init/);
  const pro = setSemgrepPro({ repos: [] }, { who: 'test' });
  assert.equal(pro.ok, false);
  assert.match(pro.error, /commitwork init/);
  assert.equal(readFileSync(EXAMPLE_REGISTRY_PATH, 'utf8'), before);
});

test('Semgrep Pro seats cannot be set before any registry exists', () => {
  delete process.env.CW_REGISTRY;
  const self = mkdtempSync(join(tmpdir(), 'cw-pj-nopro-'));
  try {
    const r = setSemgrepPro({ repos: ['loner'] }, { who: 'test', selfRoot: self });
    assert.equal(r.ok, false);
    assert.equal(r.code, 409);
    assert.match(r.error, /no registry yet/);
  } finally { rmSync(self, { recursive: true, force: true }); }
});
