// GET /api/scanners/provenance and GET/POST /api/scanners/repos through their handlers.
//
// Provenance runs on a synthetic lane manifest (CW_BASELINE_MANIFEST), tuning model
// (CW_PERF_PROFILES), sibling manifests (CW_MANIFESTS_DIR) and install catalogue
// (CW_INSTALL_CATALOG), with PATH narrowed to a temp bin directory holding one fixture tool. The
// manifest declares no images, so `docker image inspect` is never spawned; the only process started
// is the fixture tool's own `--version`, and no action argv is ever executed — the route only lists
// it. The per-repository table writes a temp settings store (CW_SETTINGS) and resolves repositories
// from a temp registry (CW_REGISTRY).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes, _resetRepoCache } from '../routes/scanners.mjs';
import { resetProfileCache } from '../../monitor/perf-tuning.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-scanners-entry-'));
const BIN = join(TMP, 'bin');
const SETTINGS = join(TMP, 'settings.json');
const REG = join(TMP, 'projects.json');
const NOW = '2026-09-24T00:00:00.000Z';
const KEYS = ['CW_BASELINE_MANIFEST', 'CW_PERF_PROFILES', 'CW_MANIFESTS_DIR', 'CW_INSTALL_CATALOG', 'CW_SCANNER_ACTIONS_DIR',
  'CW_REGISTRY', 'CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_NOW', 'CW_SCAN_DEPTH', 'CW_SCAN_INTENSITY', 'CW_REPO_TUNING', 'PATH'];
const saved = {};

const LANE = {
  checks: [{
    id: 'fixlane', description: 'synthetic lane for the provenance route', groups: ['fixture'],
    requires: { tools: ['cwfixtool', 'cwfixabsent'] },
    local: ['cwfixtool scan --json .', 'npx --yes fixpkg@1.2.3 --json'],
  }],
  images: [],
};

before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  mkdirSync(BIN, { recursive: true });
  writeFileSync(join(BIN, 'cwfixtool'), '#!/bin/sh\necho "cwfixtool 9.8.7"\n');
  chmodSync(join(BIN, 'cwfixtool'), 0o755);
  // present on PATH so an install action can be OFFERED; the route never runs it
  writeFileSync(join(BIN, 'brew'), '#!/bin/sh\nexit 97\n');
  chmodSync(join(BIN, 'brew'), 0o755);
  writeFileSync(join(TMP, 'sb.json'), JSON.stringify(LANE));
  writeFileSync(join(TMP, 'perf.json'), JSON.stringify({ scanners: {} }));
  mkdirSync(join(TMP, 'manifests'), { recursive: true });
  writeFileSync(join(TMP, 'manifests', 'runtime.json'), JSON.stringify({ checks: [{ id: 'fixruntime', description: 'synthetic runtime lane', local: ['true'] }] }));
  writeFileSync(join(TMP, 'catalog.json'), JSON.stringify({ tools: { cwfixabsent: { brew: 'cwfixabsent', why: 'synthetic catalogue entry', url: 'https://example.invalid/cwfixabsent' } } }));
  writeFileSync(REG, JSON.stringify({
    reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
    areas: [{ slug: 'a1', label: 'Area One', out: 'a1', primary: true }],
    projects: [
      { name: 'repo-a', area: 'a1', path: join(TMP, 'src', 'repo-a'), manifest: 'security-baseline' },
      { name: 'repo-b', area: 'a1', path: join(TMP, 'src', 'repo-b'), manifest: 'security-baseline' },
    ],
  }));
  Object.assign(process.env, {
    CW_BASELINE_MANIFEST: join(TMP, 'sb.json'), CW_PERF_PROFILES: join(TMP, 'perf.json'),
    CW_MANIFESTS_DIR: join(TMP, 'manifests'), CW_INSTALL_CATALOG: join(TMP, 'catalog.json'),
    CW_SCANNER_ACTIONS_DIR: join(TMP, 'actions'), CW_REGISTRY: REG, CW_SETTINGS: SETTINGS, CW_NOW: NOW,
    PATH: BIN,
  });
  for (const k of ['CW_SETTINGS_STORE', 'CW_SCAN_DEPTH', 'CW_SCAN_INTENSITY', 'CW_REPO_TUNING']) delete process.env[k];
  resetProfileCache();
  _resetRepoCache();
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetProfileCache();
  _resetRepoCache();
  rmSync(TMP, { recursive: true, force: true });
});

const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const call = (method, path, { query = {}, body = {}, bodyErr = null, loopback = true, session = null } = {}) => new Promise((resolve) => {
  route(method, path).handle({
    req: {}, isLoopbackReq: loopback, adminSession: () => session, query: new URLSearchParams(query),
    readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
    send: (code, payload) => resolve({ code, payload }),
  });
});
const SESSION = { user: 'op@example.test', provider: 'password' };

describe('GET /api/scanners/provenance', () => {
  test('a remote caller with no session is refused 401', async () => {
    for (const session of [null, { provider: 'password' }]) {
      const r = await call('GET', '/api/scanners/provenance', { loopback: false, session, query: { id: 'fixlane' } });
      assert.equal(r.code, 401);
      assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
    }
  });

  test('an id no manifest declares is a 404 naming it, not an empty lane', async () => {
    for (const id of ['no-such-lane', '__proto__', '']) {
      const r = await call('GET', '/api/scanners/provenance', { query: { id } });
      assert.equal(r.code, 404, id);
      assert.equal(r.payload.ok, false);
      assert.equal(r.payload.error, `no scanner ${JSON.stringify(id)}`);
    }
  });

  // which() reads POSIX exec bits and the fixture tool is a shell script — neither exists on Windows
  test('each tool reports where it came from, its version, and only the actions that apply',
    { skip: process.platform === 'win32' ? 'the fixture tool is a POSIX shell script found by exec bits' : false }, async () => {
    const r = await call('GET', '/api/scanners/provenance', { query: { id: 'fixlane' } });
    assert.equal(r.code, 200, JSON.stringify(r.payload));
    const p = r.payload;
    assert.equal(p.ok, true);
    assert.equal(p.id, 'fixlane');
    assert.equal(p.catalogError, null);
    assert.equal(p.canAct, true, 'the operator port may act');
    assert.deepEqual(p.tools.map((t) => t.tool), ['cwfixtool', 'cwfixabsent']);

    const [present, absent] = p.tools;
    assert.equal(present.present, true);
    assert.equal(present.path, join(BIN, 'cwfixtool'));
    assert.equal(present.realPath, realpathSync(join(BIN, 'cwfixtool')));
    assert.equal(present.manager, 'manual');
    assert.deepEqual(present.version, { state: 'present', version: '9.8.7', versionState: 'stated' });
    assert.deepEqual(present.actions, [], 'a hand-installed binary offers no package-manager verb');
    assert.match(present.noActionsWhy, /installed by hand, so it is removed by hand/);
    assert.equal(present.catalog, null);

    assert.equal(absent.present, false);
    assert.equal(absent.path, null);
    assert.deepEqual(absent.version, { state: 'unavailable', reason: 'cwfixabsent is not on PATH' });
    assert.deepEqual(absent.catalog, { why: 'synthetic catalogue entry', url: 'https://example.invalid/cwfixabsent', managers: ['brew'], postInstall: null, requiresAccount: null });
    assert.deepEqual(absent.actions, [{ verb: 'install', manager: 'brew', argv: ['brew', 'install', 'cwfixabsent'] }]);

    assert.deepEqual(p.images, []);
    assert.equal(p.npx.length, 1);
    assert.equal(p.npx[0].spec, 'fixpkg@1.2.3');
    assert.equal(p.npx[0].manager, 'npx');
  });

  test('a signed-in session sees the same provenance but may not act on it', async () => {
    const r = await call('GET', '/api/scanners/provenance', { loopback: false, session: SESSION, query: { id: 'fixlane' } });
    assert.equal(r.code, 200);
    assert.equal(r.payload.canAct, false);
    assert.equal(r.payload.tools.length, 2);
  });

  test('a lane from a sibling manifest resolves too', async () => {
    const r = await call('GET', '/api/scanners/provenance', { query: { id: 'fixruntime' } });
    assert.equal(r.code, 200);
    assert.deepEqual({ tools: r.payload.tools, images: r.payload.images, npx: r.payload.npx }, { tools: [], images: [], npx: [] });
  });

  test('an unreadable install catalogue is named, and no install verb is invented without it', async () => {
    process.env.CW_INSTALL_CATALOG = join(TMP, 'missing-catalog.json');
    try {
      const r = await call('GET', '/api/scanners/provenance', { query: { id: 'fixlane' } });
      assert.equal(r.code, 200);
      assert.match(r.payload.catalogError, /missing-catalog\.json: ENOENT/);
      const absent = r.payload.tools.find((t) => t.tool === 'cwfixabsent');
      assert.equal(absent.catalog, null);
      assert.deepEqual(absent.actions, []);
    } finally { process.env.CW_INSTALL_CATALOG = join(TMP, 'catalog.json'); }
  });

  test('an unreadable lane manifest is a 503, never an empty catalogue', async () => {
    writeFileSync(join(TMP, 'sb-torn.json'), '{ "checks": [ ');
    process.env.CW_BASELINE_MANIFEST = join(TMP, 'sb-torn.json');
    try {
      const r = await call('GET', '/api/scanners/provenance', { query: { id: 'fixlane' } });
      assert.equal(r.code, 503);
      assert.match(r.payload.error, /^the lane manifest could not be read \(.*sb-torn\.json is not valid JSON/);
    } finally { process.env.CW_BASELINE_MANIFEST = join(TMP, 'sb.json'); }
  });
});

describe('GET and POST /api/scanners/repos', () => {
  const store = () => JSON.parse(readFileSync(SETTINGS, 'utf8'));

  test('both refuse a remote caller with no session, and nothing is written', async () => {
    for (const method of ['GET', 'POST']) {
      const r = await call(method, '/api/scanners/repos', { loopback: false, session: null, body: { repoTuning: { 'repo-a': { depth: 2 } } } });
      assert.equal(r.code, 401, method);
      assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
    }
    assert.equal(existsSync(SETTINGS), false);
  });

  test('GET lists every resolved repository at the fleet values when nothing is overridden', async () => {
    const r = await call('GET', '/api/scanners/repos');
    assert.equal(r.code, 200);
    const p = r.payload;
    assert.equal(p.ok, true);
    assert.equal(p.reposError, null);
    assert.equal(p.fleet.depth.value, 5);
    assert.equal(p.fleet.intensity.value, 3);
    assert.deepEqual(p.repos.map((x) => [x.name, x.area, x.depth.value, x.intensity.value, x.overridden]),
      [['repo-a', 'a1', 5, 3, false], ['repo-b', 'a1', 5, 3, false]]);
    assert.deepEqual(p.table.value, {});
    assert.deepEqual(p.orphans, []);
  });

  test('POST refuses a missing table, a name no sweep resolves, and an out-of-range level — writing nothing', async () => {
    const cases = [
      [{}, 400, /repoTuning is required/],
      [{ repoTuning: { ghost: { depth: 2 } } }, 400, /not a repository the sweep resolves: ghost/],
      [{ repoTuning: { 'repo-a': { depth: 9 } } }, 400, /repo-a\.depth: must be an integer 1-5/],
      [{ repoTuning: { 'repo-a': { colour: 'red' } } }, 400, /unknown field "colour"/],
    ];
    for (const [body, code, re] of cases) {
      const r = await call('POST', '/api/scanners/repos', { session: SESSION, loopback: false, body });
      assert.equal(r.code, code, JSON.stringify(body));
      assert.equal(r.payload.ok, false);
      assert.match(r.payload.error, re);
    }
    const bad = await call('POST', '/api/scanners/repos', { bodyErr: 'body is not valid JSON' });
    assert.equal(bad.code, 400);
    assert.deepEqual(bad.payload, { ok: false, error: 'body is not valid JSON' });
    assert.equal(existsSync(SETTINGS), false, 'no refusal created the store');
  });

  test('POST writes one repository\'s override, stamped with the session identity, and GET reflects it', async () => {
    const r = await call('POST', '/api/scanners/repos', { session: SESSION, loopback: false, body: { repoTuning: { 'repo-a': { depth: 2 } } } });
    assert.equal(r.code, 200, JSON.stringify(r.payload));
    assert.equal(r.payload.by, 'op@example.test (password)');
    assert.deepEqual(r.payload.written, { repoTuning: { 'repo-a': { depth: 2 } } });
    const a = r.payload.repos.find((x) => x.name === 'repo-a');
    assert.equal(a.overridden, true);
    assert.equal(a.depth.value, 2);
    assert.match(a.depth.source, /^repository/);
    assert.equal(a.intensity.value, 3, 'a field the override leaves out follows the fleet');
    assert.equal(r.payload.repos.find((x) => x.name === 'repo-b').overridden, false);

    const s = store();
    assert.deepEqual(s.settings.repoTuning, { value: { 'repo-a': { depth: 2 } }, at: NOW, by: 'op@example.test (password)' });
    const g = await call('GET', '/api/scanners/repos');
    assert.deepEqual(g.payload.table.value, { 'repo-a': { depth: 2 } });
  });

  test('POST of an empty table clears every override', async () => {
    const r = await call('POST', '/api/scanners/repos', { body: { repoTuning: {} } });
    assert.equal(r.code, 200);
    assert.equal(r.payload.by, 'operator@loopback');
    assert.ok(r.payload.repos.every((x) => !x.overridden));
    assert.equal(store().settings.repoTuning.value, null);
  });

  test('an env shadow refuses the write (409) rather than answer 200 for a change nobody would see', async () => {
    const before = readFileSync(SETTINGS, 'utf8');
    process.env.CW_REPO_TUNING = JSON.stringify({ 'repo-b': { depth: 1 } });
    try {
      const r = await call('POST', '/api/scanners/repos', { body: { repoTuning: { 'repo-a': { depth: 4 } } } });
      assert.equal(r.code, 409);
      assert.match(r.payload.error, /shadowed by CW_REPO_TUNING/);
    } finally { delete process.env.CW_REPO_TUNING; }
    assert.equal(readFileSync(SETTINGS, 'utf8'), before);
  });

  test('an unreadable registry: GET names the failure, POST refuses to write a name it cannot check', async () => {
    const before = readFileSync(SETTINGS, 'utf8');
    process.env.CW_REGISTRY = join(TMP, 'no-such-registry.json');
    _resetRepoCache();
    try {
      const g = await call('GET', '/api/scanners/repos');
      assert.equal(g.code, 200);
      assert.match(g.payload.reposError, /the repository list could not be resolved .* overrides are shown, and none can be added/);
      assert.deepEqual(g.payload.repos, []);
      const p = await call('POST', '/api/scanners/repos', { body: { repoTuning: { 'repo-a': { depth: 4 } } } });
      assert.equal(p.code, 503);
      assert.match(p.payload.error, /nothing was written, because a name cannot be checked/);
    } finally { process.env.CW_REGISTRY = REG; _resetRepoCache(); }
    assert.equal(readFileSync(SETTINGS, 'utf8'), before);
  });

  test('an unparseable settings store is never written over', async () => {
    writeFileSync(SETTINGS, '{ "settings": ');
    const r = await call('POST', '/api/scanners/repos', { body: { repoTuning: { 'repo-a': { depth: 4 } } } });
    assert.equal(r.code, 503);
    assert.match(r.payload.error, /refusing to write: unparseable JSON in the settings store/);
    assert.equal(readFileSync(SETTINGS, 'utf8'), '{ "settings": ');
  });
});

test('provenance is GET-only; repos is GET and POST and nothing else', () => {
  const methods = (p) => routes.filter((r) => r.path === p).map((r) => r.method).sort();
  assert.deepEqual(methods('/api/scanners/provenance'), ['GET']);
  assert.deepEqual(methods('/api/scanners/repos'), ['GET', 'POST']);
});
