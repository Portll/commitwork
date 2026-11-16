// admin/routes/panel-state.mjs — GET /api/config, /api/services and /api/exposure, as handlers.
//
// /api/config and /api/services serve what serve.mjs binds at boot through initPanelStateRoutes;
// the tests hold the binding to its contract (refuse before init, read configState per request).
//
// /api/exposure resolves deployment state from the cloudflared config, then probes DNS and origins
// for every hostname in it. Its config path is monitor/deploy-state.mjs's defaultConfigPath(), read
// per request: CW_CLOUDFLARED_CONFIG, else ~/.cloudflared/config.yml. The variable is cleared and
// HOME moved to TMP before anything is imported, and the first test proves both held. Tests that
// drive hostnames stub DNS to no record and point every origin at 127.0.0.1:1, so no probe leaves
// the host.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dnsPromises from 'node:dns/promises';

const TMP = mkdtempSync(join(tmpdir(), 'cw-panelstate-entry-'));
const REPORTS = join(TMP, 'reports');
mkdirSync(join(TMP, 'src'), { recursive: true });
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'] }],
}));
// Two areas, each declaring one hostname, so a scoped view can be told apart from the unmapped row.
const SCOPED_REGISTRY = join(TMP, 'projects-deploy.json');
writeFileSync(SCOPED_REGISTRY, JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [
    { name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' },
    { name: 'otherrepo', area: 'otherarea', path: join(TMP, 'src'), manifest: 'security-baseline' },
  ],
  areas: [
    { slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'],
      deploy: { hostnames: ['fix.declared.test'], service: 'http://127.0.0.1:1', public: true, requiresAuth: false } },
    { slug: 'otherarea', label: 'Other Area', out: 'otherarea', members: ['otherrepo'],
      deploy: { hostnames: ['other.declared.test'], service: 'http://127.0.0.1:1', public: true, requiresAuth: false } },
  ],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.HOME = TMP;
delete process.env.CW_CLOUDFLARED_CONFIG;

const core = await import('../lib/core.mjs');
const { initJobs } = await import('../lib/jobs.mjs');
const { primaryArea, loadRegistry } = await import('../../monitor/registry.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
initJobs({ CW: TMP, registry: core.registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
const { routes, initPanelStateRoutes } = await import('../routes/panel-state.mjs');

const SCOPED = loadRegistry({ path: SCOPED_REGISTRY, quiet: true });

after(() => rmSync(TMP, { recursive: true, force: true }));

const CFG = join(TMP, '.cloudflared', 'config.yml');
const route = (path) => routes.find((r) => r.method === 'GET' && r.path === path);

/** Resolves on send(); the exposure handler answers asynchronously. */
function call(path, query = '') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`GET ${path} never answered`)), 5000);
    route(path).handle({ req: { url: `${path}${query ? `?${query}` : ''}`, headers: {} }, query: new URLSearchParams(query),
      send: (status, body) => { clearTimeout(timer); resolve({ status, body }); } });
  });
}

// The order matters: the binding is module state, and the first describe runs before init.
describe('before initPanelStateRoutes', () => {
  test('GET /api/config refuses to answer from an unbound read model rather than inventing one', () => {
    assert.throws(() => route('/api/config').handle({ send: () => assert.fail('must not answer') }),
      /used before initPanelStateRoutes/);
  });
});

let config = { theme: 'auto', manifests: ['security-baseline'] };
let registryFn = () => core.registry();
const SERVICES = { panel: { port: 7878 }, docsite: { port: 8788 } };

describe('after initPanelStateRoutes', () => {
  test('init binds the read models', () => {
    initPanelStateRoutes({ registry: () => registryFn(), configState: () => config, SERVICES });
  });

  test('GET /api/config serves configState() as it is at REQUEST time, not as it was at boot', async () => {
    const first = await call('/api/config');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { theme: 'auto', manifests: ['security-baseline'] });
    config = { theme: 'dark', manifests: [] };
    const second = await call('/api/config');
    assert.deepEqual(second.body, { theme: 'dark', manifests: [] });
  });

  test('GET /api/services serves the bound services map', async () => {
    const res = await call('/api/services');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { panel: { port: 7878 }, docsite: { port: 8788 } });
  });
});

describe('GET /api/exposure — the paths that resolve no hostname', () => {
  test('PRECONDITION: the cloudflared config resolves under the moved HOME, not the operator\'s', async () => {
    const { defaultConfigPath } = await import('../../monitor/deploy-state.mjs');
    assert.equal(defaultConfigPath(), CFG, 'every exposure test below would read the real tunnel config');
  });

  // serve.mjs's boot check reads CW_CLOUDFLARED_CONFIG; a route that ignored it judged another file.
  test('CW_CLOUDFLARED_CONFIG is read per request, so the route reads the config the server checked', async () => {
    const alt = join(TMP, 'alt-tunnel', 'config.yml');
    process.env.CW_CLOUDFLARED_CONFIG = alt;
    try {
      const absent = await call('/api/exposure');
      assert.equal(absent.body.ok, false);
      assert.equal(absent.body.configPath, alt, 'the route read the HOME default instead of the override');
      assert.match(absent.body.error, /alt-tunnel[\\/]config\.yml: ENOENT/);
      mkdirSync(join(TMP, 'alt-tunnel'), { recursive: true });
      writeFileSync(alt, 'tunnel: fixture\ningress:\n  - service: http_status:404\n');
      const present = await call('/api/exposure');
      assert.equal(present.body.ok, true, JSON.stringify(present.body));
      assert.equal(present.body.configPath, alt);
    } finally { delete process.env.CW_CLOUDFLARED_CONFIG; }
    const back = await call('/api/exposure');
    assert.equal(back.body.configPath, CFG, 'unset again, the HOME default is back: nothing was captured');
  });

  test('a registry that cannot be read is ok:false with the reason and no rows, never an empty exposure', async () => {
    registryFn = () => { throw new Error('registry invalid (fixture)'); };
    try {
      const res = await call('/api/exposure');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, false);
      assert.match(res.body.error, /could not resolve deployment state: registry invalid \(fixture\)/);
      assert.deepEqual(res.body.rows, []);
      assert.equal(res.body.totals, undefined, 'no totals: a zero here would read as "nothing exposed"');
    } finally { registryFn = () => core.registry(); }
  });

  test('no cloudflared config is ok:false naming the path it looked at', async () => {
    rmSync(CFG, { force: true });
    const res = await call('/api/exposure');
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /config\.yml: ENOENT/);
    assert.equal(res.body.configPath, CFG);
    assert.deepEqual(res.body.rows, []);
  });

  test('a config routing nothing, for a registry declaring no deployment, is an empty exposure with the scope stated', async () => {
    mkdirSync(join(TMP, '.cloudflared'), { recursive: true });
    writeFileSync(CFG, 'tunnel: fixture\ningress:\n  # - hostname: commented.example.test\n  - service: http_status:404\n');
    const res = await call('/api/exposure', 'project=Fix%20Area');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.configPath, CFG);
    assert.deepEqual(res.body.rows, []);
    assert.equal(res.body.declaredCount, 0);
    assert.equal(res.body.routedCount, 0);
    assert.deepEqual(res.body.scope, { project: 'Fix Area', area: 'fixarea', hidden: 0, shownUndeclared: 0, hiddenDrifted: 0 });
    assert.deepEqual(res.body.totals, { published: 0, reachable: 0, withFindings: 0, uncertain: 0, clean: 0, unscanned: 0, drifted: 0 });
  });
});

describe('GET /api/exposure — project scope never hides an unmapped hostname', () => {
  // deploy-state resolves DNS on the default path; no record here keeps the lookups off the network.
  const realResolve4 = dnsPromises.resolve4;
  const realResolveCname = dnsPromises.resolveCname;
  before(() => {
    const noRecord = async () => { throw Object.assign(new Error('no record (fixture)'), { code: 'ENOTFOUND' }); };
    dnsPromises.resolve4 = noRecord;
    dnsPromises.resolveCname = noRecord;
  });
  after(() => {
    dnsPromises.resolve4 = realResolve4;
    dnsPromises.resolveCname = realResolveCname;
  });

  // One hostname declared by Fix Area, one declared by Other Area, one declared by no area.
  function writeScopedConfig() {
    mkdirSync(join(TMP, '.cloudflared'), { recursive: true });
    writeFileSync(CFG, 'tunnel: fixture\ningress:\n'
      + '  - hostname: fix.declared.test\n    service: http://127.0.0.1:1\n'
      + '  - hostname: nobody.declared.test\n    service: http://127.0.0.1:1\n'
      + '  - hostname: other.declared.test\n    service: http://127.0.0.1:1\n'
      + '  - service: http_status:404\n');
  }

  async function callScoped() {
    const previous = registryFn;
    registryFn = () => SCOPED;
    try { return await call('/api/exposure', 'project=Fix%20Area'); }
    finally { registryFn = previous; }
  }

  test('a routed hostname no area declares stays in the scoped rows and counts in totals and drift', async () => {
    writeScopedConfig();
    const res = await callScoped();
    assert.equal(res.body.ok, true, JSON.stringify(res.body));
    assert.deepEqual(res.body.rows.map((r) => r.hostname), ['fix.declared.test', 'nobody.declared.test']);
    assert.deepEqual(res.body.rows.find((r) => r.hostname === 'nobody.declared.test').area, null);
    assert.equal(res.body.rows.find((r) => r.hostname === 'nobody.declared.test').worst, 'unmapped');
    assert.equal(res.body.totals.published, 2, 'the unmapped row counts as published');
    assert.deepEqual(res.body.drift, ['fix.declared.test', 'nobody.declared.test']);
  });

  test('the shown unmapped row is reported as shownUndeclared and never as hidden', async () => {
    writeScopedConfig();
    const res = await callScoped();
    assert.equal(res.body.scope.shownUndeclared, 1);
    assert.equal(res.body.scope.hidden, 1, 'only the other area\'s row is hidden');
  });

  test('another area\'s hostname is still excluded and counted as hidden', async () => {
    writeScopedConfig();
    const res = await callScoped();
    assert.equal(res.body.rows.some((r) => r.hostname === 'other.declared.test'), false);
    assert.equal(res.body.scope.hidden, 1);
    assert.equal(res.body.scope.hiddenDrifted, 1);
    assert.equal(res.body.drift.includes('other.declared.test'), false);
  });

  test('without ?project= every row is shown and shownUndeclared is 0', async () => {
    writeScopedConfig();
    const previous = registryFn;
    registryFn = () => SCOPED;
    let res;
    try { res = await call('/api/exposure'); }
    finally { registryFn = previous; }
    assert.deepEqual(res.body.rows.map((r) => r.hostname), ['fix.declared.test', 'nobody.declared.test', 'other.declared.test']);
    assert.deepEqual(res.body.scope, { project: null, area: null, hidden: 0, shownUndeclared: 0, hiddenDrifted: 0 });
  });
});
