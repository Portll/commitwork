// The palette indexes the registries the rail already reads, so it cannot list a view the panel
// lacks or miss one it has. The scope of a view that the rail does not list is cross-checked
// against navigation.js, and a registry that cannot be read is a 500, never an empty palette.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN, MANIFEST_DIR } from '../lib/core.mjs';
import { readMenuViews, readChecks, buildPaletteIndex, searchPalette, ACTIONS, KIND_ORDER } from '../lib/palette-index.mjs';
import { routesWith } from '../routes/palette.mjs';

const MENUS = join(ADMIN, 'menus');
const MAP = join(MANIFEST_DIR, 'security-baseline.map.json');

describe('the index reads the real registries', () => {
  const views = readMenuViews(MENUS);
  const checks = readChecks(MAP);

  test('every .vtab in view-menu.html is a view, with the rail label decoded', () => {
    const ids = views.map((v) => v.id);
    for (const must of ['fleet', 'overview', 'allfindings', 'issues', 'verdicts', 'settings', 'held']) assert.ok(ids.includes(must), must);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    assert.equal(views.find((v) => v.id === 'verdicts').railLabel, 'Decisions & reviews');
    assert.ok(views.length >= 40);
  });

  test('rail blocks give scope: All projects → fleet, Manage → manage, the rest → project', () => {
    const scope = Object.fromEntries(views.map((v) => [v.id, v.scope]));
    assert.equal(scope.fleet, 'fleet');
    assert.equal(scope.rollups, 'fleet');
    assert.equal(scope.settings, 'manage');
    assert.equal(scope.held, 'manage');
    assert.equal(scope.overview, 'project');
    assert.equal(scope.allfindings, 'project');
  });

  test('views the rail does not list carry the scope navigation.js declares (second witness)', () => {
    const src = readFileSync(join(MENUS, 'navigation.js'), 'utf8');
    const m = src.match(/const VIEW_SCOPE=Object\.freeze\(\{([\s\S]*?)\}\)/);
    assert.ok(m, 'VIEW_SCOPE declaration found in navigation.js');
    const declared = Object.fromEntries([...m[1].matchAll(/(\w+):'(\w+)'/g)].map((x) => [x[1], x[2]]));
    assert.ok(Object.keys(declared).length >= 10, 'VIEW_SCOPE parsed');
    for (const v of views) {
      const want = declared[v.id] === 'fleet' && v.scope === 'manage' ? 'manage' : (declared[v.id] || 'project');
      if (v.scope === 'manage') continue;        // manage is the rail's refinement of fleet
      assert.equal(v.scope, want, `${v.id}: index says ${v.scope}, navigation.js says ${declared[v.id] || 'project'}`);
    }
  });

  test('rail-only routes with no tab button are views too', () => {
    const byId = Object.fromEntries(views.map((v) => [v.id, v]));
    for (const id of ['rollups', 'projects', 'remfleet', 'settings', 'perf']) assert.ok(byId[id], id);
    assert.equal(byId.rollups.label, 'Rollups');
    assert.equal(byId.rollups.scope, 'fleet');
    assert.equal(byId.perf.scope, 'manage');
  });

  test('every action path is declared by a route module (text witness, like route-inventory)', () => {
    const src = readdirSync(join(ADMIN, 'routes')).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(join(ADMIN, 'routes', f), 'utf8')).join('\n');
    for (const a of ACTIONS) {
      const literal = src.includes(`path: '${a.path}'`);
      const templated = src.includes(`path: \`${a.path.replace(/\/[^/]+$/, '/')}\${`);
      assert.ok(literal || templated, `${a.id}: ${a.method} ${a.path} is not declared by any admin/routes module`);
    }
  });

  test('every manifest check is indexed with a one-line hint', () => {
    assert.ok(checks.length >= 50);
    const idx = buildPaletteIndex({ checks });
    const secrets = idx.find((e) => e.kind === 'check' && e.id === 'secrets');
    assert.ok(secrets, 'secrets check indexed');
    assert.ok(secrets.hint.length > 0 && !secrets.hint.includes('('));
  });
});

describe('search', () => {
  const entries = buildPaletteIndex({ views: readMenuViews(MENUS), checks: readChecks(MAP), projects: ['zeta-service', 'alpha-service'] });

  test('an empty query lists everything in kind order, bounded', () => {
    const r = searchPalette(entries, '', { limit: 10 });
    assert.equal(r.length, 10);
    assert.deepEqual([...new Set(r.map((e) => e.kind))], ['view']);
    const all = searchPalette(entries, '', { limit: 10_000 });
    const kinds = all.map((e) => KIND_ORDER.indexOf(e.kind));
    assert.deepEqual(kinds, [...kinds].sort((a, b) => a - b));
  });

  test('label prefix beats keyword beats substring, and every term must match', () => {
    assert.equal(searchPalette(entries, 'work')[0].id, 'issues');
    assert.equal(searchPalette(entries, 'all find')[0].id, 'allfindings');
    assert.equal(searchPalette(entries, 'decisions')[0].id, 'verdicts');
    assert.equal(searchPalette(entries, 'alpha')[0].kind, 'project');
    assert.equal(searchPalette(entries, 'restart')[0].id, 'restart-panel');
    assert.deepEqual(searchPalette(entries, 'zzqx-nothing'), []);
    assert.deepEqual(searchPalette(entries, 'work zzqx'), []);
  });

  test('projects are listed sorted and actions keep their operator flag', () => {
    const projects = entries.filter((e) => e.kind === 'project').map((e) => e.id);
    assert.deepEqual(projects, ['alpha-service', 'zeta-service']);
    const restart = entries.find((e) => e.id === 'restart-panel');
    assert.equal(restart.operatorOnly, true);
    assert.equal(entries.find((e) => e.id === 'run-checks').operatorOnly, false);
    assert.equal(ACTIONS.length, entries.filter((e) => e.kind === 'action').length);
  });

  test('the same input ranks the same way twice', () => {
    assert.equal(JSON.stringify(searchPalette(entries, 'sec')), JSON.stringify(searchPalette(entries, 'sec')));
  });
});

describe('the route', () => {
  let TMP;
  before(() => { TMP = mkdtempSync(join(tmpdir(), 'cw-palette-')); mkdirSync(join(TMP, 'menus')); });
  after(() => rmSync(TMP, { recursive: true, force: true }));

  const SESSION = { user: 'op@example.test', provider: 'password' };
  const call = (route, { q = {}, session = SESSION, loopback = false } = {}) => new Promise((resolve) => {
    route.handle({
      req: { url: '/api/palette' }, isLoopbackReq: loopback, adminSession: () => session,
      query: new URLSearchParams(q), knownProjects: () => new Set(['beta', 'alpha']),
      send: (code, payload) => resolve({ code, payload }),
    });
  });
  const real = routesWith().find((r) => r.path === '/api/palette');

  test('no session and not loopback is 401', async () => {
    const r = await call(real, { session: null });
    assert.equal(r.code, 401);
  });

  test('a session gets the whole index with counts; loopback is marked operator', async () => {
    const r = await call(real);
    assert.equal(r.code, 200);
    assert.equal(r.payload.operator, false);
    assert.ok(r.payload.counts.view >= 40 && r.payload.counts.check >= 50);
    assert.equal(r.payload.counts.project, 2);
    assert.deepEqual(r.payload.entries.filter((e) => e.kind === 'project').map((e) => e.id), ['alpha', 'beta']);
    const op = await call(real, { session: null, loopback: true });
    assert.equal(op.payload.operator, true);
  });

  test('q returns ranked results instead of the index, with limit honoured', async () => {
    const r = await call(real, { q: { q: 'work', limit: '3' } });
    assert.equal(r.payload.entries, undefined);
    assert.ok(r.payload.results.length <= 3);
    assert.equal(r.payload.results[0].id, 'issues');
  });

  test('an unreadable registry is a 500 that names it, never an empty palette', async () => {
    const broken = routesWith({ menusDir: join(TMP, 'menus'), mapPath: MAP }).find((r) => r.path === '/api/palette');
    const r = await call(broken);
    assert.equal(r.code, 500);
    assert.match(r.payload.error, /view-menu\.html.*ENOENT/);
    writeFileSync(join(TMP, 'menus', 'view-menu.html'), '<nav id="views"></nav>');
    writeFileSync(join(TMP, 'menus', 'section-rail.html'), '<aside></aside>');
    const empty = await call(broken);
    assert.equal(empty.code, 500);
    assert.match(empty.payload.error, /no \.vtab entries/);
    const badMap = routesWith({ menusDir: MENUS, mapPath: join(TMP, 'nope.json') }).find((r) => r.path === '/api/palette');
    const m = await call(badMap);
    assert.equal(m.code, 500);
    assert.match(m.payload.error, /nope\.json/);
  });
});

describe('the palette flag', () => {
  test('off answers 404 naming the flag; the view the feed flag declares is still indexed', async () => {
    const real = routesWith().find((r) => r.path === '/api/palette');
    const call = (q = {}, session = { user: 'op@example.test' }) => new Promise((resolve) => {
      real.handle({ req: { url: '/api/palette' }, isLoopbackReq: false, adminSession: () => session, query: new URLSearchParams(q), knownProjects: () => new Set(), send: (code, payload) => resolve({ code, payload }) });
    });
    process.env.CW_FEATURE_PALETTE = 'off';
    try {
      const r = await call({}, null);
      assert.equal(r.code, 404);
      assert.equal(r.payload.flag, 'palette');
      assert.equal(r.payload.featureOff, true);
    } finally { delete process.env.CW_FEATURE_PALETTE; }
    const on = await call();
    assert.equal(on.code, 200);
    assert.ok(on.payload.entries.some((e) => e.kind === 'view' && e.id === 'feed'), 'the feed tab is a palette entry');
  });
});

test('an entity-escaped ampersand decodes once: &amp;lt; is the text &lt;, never a second <', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-palette-decode-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'view-menu.html'), '<button class="vtab" data-v="qa" title="R&amp;amp;D">Q&amp;lt;A</button>\n');
  writeFileSync(join(dir, 'section-rail.html'), '\n');
  const [v] = readMenuViews(dir);
  assert.equal(v.label, 'Q&lt;A');
  assert.equal(v.hint, 'R&amp;D');
});
