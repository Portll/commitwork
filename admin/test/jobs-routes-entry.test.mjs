// The job-starting routes of admin/routes/jobs.mjs, through their handlers, WITHOUT starting a real
// job:
//
//   POST /api/scan         — every validation refusal, then the start path against an INJECTED
//                            runner (CW_SWEEP_CMD, the job engine's declared override seam). The
//                            runner is a temp script that records what it was handed and exits 0.
//   POST /api/bola/run     — the 400 / 409 refusals, and a READY area stopped at the job slot.
//   POST /api/stpa/run     — stopped at the job slot.
//   POST /api/health/all, /api/health/deadcode, /api/health/gates, /api/health/provenance,
//   POST /api/health/toolchain — the no-project refusal, and stopped at the job slot.
//
// Belt and braces, because these routes spawn: the engine is initialised with a TEMP checkout root,
// so any spawn this file failed to prevent would run `node <tmp>/monitor/<x>.mjs`, which does not
// exist, rather than a real sweep, health check, BOLA probe or STPA run. Every "stopped at the job
// slot" call asserts the slot is occupied before it is made. Job logs and persisted health runs go
// to temp paths (CW_JOB_LOG_DIR, CW_HEALTH_RUNS_STORE).
//
// CW_SECRETS_FILE is set before the route module loads: bola readiness reads the secrets ref table
// through lib/secrets.mjs, which captures that variable at import.
//
// Auth and CSRF for these routes are enforced by serve.mjs's global gates, not by the handlers —
// route-auth.test.mjs pins the dispatch order and bola-route.test.mjs the CSRF 403 — so neither is
// re-asserted here.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const TMP = mkdtempSync(join(tmpdir(), 'cw-jobs-entry-'));
const FAKE_CW = join(TMP, 'cw');                 // the engine's checkout root: holds no monitor/ scripts
const REG_PATH = join(TMP, 'projects.json');
const RUNNER = join(TMP, 'runner.mjs');
const RUNNER_OUT = join(TMP, 'runner-calls.jsonl');
const KEYS = ['CW_SECRETS_FILE', 'CW_REGISTRY', 'CW_BOLA_MANIFEST_DIR', 'CW_JOB_LOG_DIR', 'CW_HEALTH_RUNS_STORE', 'CW_SWEEP_CMD',
  'CW_SWEEP_LIVE_LOG', 'CW_MONITOR_OUT', 'CWFX_RUNNER_OUT', 'CWFX_BOLA_PASS_A', 'CWFX_BOLA_PASS_B'];
const saved = {};
for (const k of KEYS) saved[k] = process.env[k];

mkdirSync(FAKE_CW, { recursive: true });
mkdirSync(join(TMP, 'bola'), { recursive: true });
mkdirSync(join(TMP, 'src', 'fixrepo'), { recursive: true });
const REG = {
  reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
  areas: [
    { slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'],
      bola: { manifest: 'synthetic-bola', base: 'http://127.0.0.1:9' } },
    { slug: 'plain', label: 'Plain', out: 'plain' },
  ],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src', 'fixrepo'), manifest: 'security-baseline' }],
};
writeFileSync(REG_PATH, JSON.stringify(REG));
const credential = (passwordEnv) => ({ type: 'keycloak', realm: 'fixture', client: 'fixture-web', username: 'x@example.test', passwordEnv });
writeFileSync(join(TMP, 'bola', 'synthetic-bola.json'), JSON.stringify({
  repo: 'synthetic target',
  actors: [
    { name: 'anon', role: 'anon' },
    { name: 'userA', role: 'user', tenant: 'tenantA', credential: credential('CWFX_BOLA_PASS_A') },
    { name: 'userB', role: 'user', tenant: 'tenantB', credential: credential('CWFX_BOLA_PASS_B') },
  ],
  objects: { model: 'seed', types: [{ name: 'thing', create: { path: '/api/things', body: {} }, idPath: 'id', getPath: '/api/things/{id}' }] },
}));
writeFileSync(RUNNER, [
  "import { appendFileSync } from 'node:fs';",
  'const e = process.env;',
  'appendFileSync(e.CWFX_RUNNER_OUT, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(),',
  '  project: e.CW_SWEEP_PROJECT, check: e.CW_SWEEP_CHECK, repo: e.CW_SWEEP_REPO }) + String.fromCharCode(10));',
  "console.log('[sweep] 1 repos');",
  "console.log('[sweep] done');",
].join('\n'));

Object.assign(process.env, {
  CW_SECRETS_FILE: join(TMP, 'secrets.json'),   // absent: an empty ref table
  CW_REGISTRY: REG_PATH,
  CW_BOLA_MANIFEST_DIR: join(TMP, 'bola'),
  CW_JOB_LOG_DIR: join(TMP, 'logs'),
  CW_HEALTH_RUNS_STORE: join(TMP, 'health-runs.json'),
  CW_SWEEP_CMD: `"${process.execPath}" "${RUNNER}"`,
  CWFX_RUNNER_OUT: RUNNER_OUT,
});
for (const k of ['CW_SWEEP_LIVE_LOG', 'CW_MONITOR_OUT', 'CWFX_BOLA_PASS_A', 'CWFX_BOLA_PASS_B']) delete process.env[k];

const { SECRETS_FILE } = await import('../../lib/secrets.mjs');
assert.equal(SECRETS_FILE, join(TMP, 'secrets.json'), 'lib/secrets.mjs did not pick up the fixture table');
const { routes, initJobRoutes } = await import('../routes/jobs.mjs');
const { initJobs, jobs } = await import('../lib/jobs.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
const { primaryArea, SCANNER_CHECKS } = await Promise.all([import('../../monitor/registry.mjs'), import('../../monitor/scanner-checks.mjs')])
  .then(([r, s]) => ({ primaryArea: r.primaryArea, SCANNER_CHECKS: s.SCANNER_CHECKS }));

let registryFails = false;
const registry = () => { if (registryFails) throw new Error('registry fixture unreadable'); return REG; };
initJobs({ CW: FAKE_CW, registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
initJobRoutes({ registry, registryStale: () => null });

after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  for (const j of Object.values(jobs)) { if (j && j.proc && j.running) { try { j.proc.kill('SIGKILL'); } catch { /* gone */ } } }
  rmSync(TMP, { recursive: true, force: true });
});

const route = (path) => routes.find((r) => r.method === 'POST' && r.path === path);
const call = (path, query = {}) => new Promise((resolve) => {
  const qs = new URLSearchParams(query).toString();
  route(path).handle({
    req: { url: `${path}${qs ? `?${qs}` : ''}`, headers: {} }, query: new URLSearchParams(query),
    send: (code, payload) => resolve({ code, payload }),
  });
});
/** Occupy a job slot so trigger() refuses before it can spawn — and prove it is occupied. */
const occupy = (kind) => { jobs[kind] = { kind, running: true, lines: [], seq: 0, lanes: {} }; assert.equal(jobs[kind].running, true); };
const release = (kind) => { delete jobs[kind]; };
const runnerCalls = () => (existsSync(RUNNER_OUT) ? readFileSync(RUNNER_OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const settle = async (kind) => {
  for (let i = 0; i < 200 && jobs[kind] && jobs[kind].running; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(jobs[kind].running, false, `${kind} did not finish`);
};

describe('POST /api/scan', () => {
  test('a request naming neither a scanner nor a repo is refused', async () => {
    const r = await call('/api/scan', { project: 'fixarea' });
    assert.equal(r.code, 400);
    assert.deepEqual(r.payload, { started: false, reason: 'name a scanner, a repo, or both' });
  });

  test('a scanner outside the closed map is refused — prototype keys included — and the known set is listed', async () => {
    for (const scanner of ['nope', '__proto__', 'constructor', 'secrets-gitleaks']) {
      const r = await call('/api/scan', { project: 'fixarea', scanner });
      assert.equal(r.code, 400, scanner);
      assert.equal(r.payload.started, false);
      assert.equal(r.payload.reason, `unknown scanner ${JSON.stringify(scanner)}`);
      assert.deepEqual(r.payload.known, Object.keys(SCANNER_CHECKS));
    }
  });

  test('a repo discovery does not resolve is refused; an unreadable registry is a 503', async () => {
    const r = await call('/api/scan', { project: 'fixarea', repo: 'ghost-repo' });
    assert.equal(r.code, 400);
    assert.deepEqual(r.payload, { started: false, reason: 'unknown repo "ghost-repo"' });
    registryFails = true;
    try {
      const u = await call('/api/scan', { project: 'fixarea', repo: 'fixrepo' });
      assert.equal(u.code, 503);
      assert.deepEqual(u.payload, { started: false, reason: 'repo list unavailable — registry unreadable' });
    } finally { registryFails = false; }
  });

  test('a valid request with no project selected starts nothing', async () => {
    const r = await call('/api/scan', { scanner: 'secrets' });
    assert.equal(r.code, 200);
    assert.equal(r.payload.started, false);
    assert.match(r.payload.reason, /no project selected/);
    assert.equal(jobs.sweep, undefined);
  });

  test('a valid request while a sweep holds the slot starts nothing', async () => {
    occupy('sweep');
    try {
      const r = await call('/api/scan', { project: 'fixarea', scanner: 'secrets', repo: 'fixrepo' });
      assert.equal(r.code, 200);
      assert.deepEqual(r.payload, { started: false, reason: 'already running' });
    } finally { release('sweep'); }
    assert.deepEqual(runnerCalls(), []);
  });

  test('a valid request starts the runner with the CANONICAL check id and discovery\'s repo name', async () => {
    const r = await call('/api/scan', { project: 'fixarea', scanner: 'secrets', repo: 'fixrepo' });
    assert.equal(r.code, 200);
    assert.deepEqual(r.payload, { started: true });
    await settle('sweep');
    const [rec] = runnerCalls();
    assert.deepEqual(rec, { argv: [], cwd: realpathSync(FAKE_CW), project: 'fixarea', check: SCANNER_CHECKS.secrets, repo: 'fixrepo' },
      'the selection travels in env, never appended to the override\'s argv; the job runs in the engine\'s checkout root');
    assert.equal(rec.check, 'secrets-gitleaks', 'the category was mapped to its check id, not passed through');
    const j = jobs.sweep;
    assert.equal(j.label, 'scanner secrets · repo fixrepo');
    assert.equal(j.project, 'fixarea');
    assert.equal(j.repo, 'fixrepo');
    assert.equal(j.exitCode, 0);
    assert.equal(j.phase, 'done');
    assert.equal(j.total, 1);
    assert.ok(j.lines.some((l) => l.includes('CW_SWEEP_CMD override in effect')), 'the override announces itself in the console');
    assert.ok(readFileSync(join(TMP, 'logs', 'sweep-latest.log'), 'utf8').includes('[sweep] done'), 'the job log went where CW_JOB_LOG_DIR points');
  });

  test('a runtime scanner starts with a note that a skipped run is not a clean one', async () => {
    const r = await call('/api/scan', { project: 'fixarea', scanner: 'tlsHeaders' });
    assert.equal(r.code, 200);
    assert.equal(r.payload.started, true);
    assert.match(r.payload.note, /^runtime scanner — records itself as skipped unless a live URL is configured/);
    await settle('sweep');
    const rec = runnerCalls().at(-1);
    assert.deepEqual([rec.check, rec.repo], [SCANNER_CHECKS.tlsHeaders, '']);
    assert.equal(jobs.sweep.label, 'scanner tlsHeaders');
  });
});

describe('POST /api/bola/run', () => {
  test('an area with no bola block — or no area at all — is a 400 naming the configured areas', async () => {
    for (const project of ['plain', 'no-such-area', '']) {
      const r = await call('/api/bola/run', project ? { project } : {});
      assert.equal(r.code, 400, project);
      assert.equal(r.payload.started, false);
      assert.match(r.payload.reason, /declares no bola block — configured areas: fixarea$/);
    }
  });

  test('a declared area whose credentials are not set is a 409 naming each missing secret', async () => {
    const r = await call('/api/bola/run', { project: 'fixarea' });
    assert.equal(r.code, 409);
    assert.equal(r.payload.started, false);
    assert.equal(r.payload.reason, 'credentials not configured: 2 secret(s) not yet stored: CWFX_BOLA_PASS_A, CWFX_BOLA_PASS_B — run `node bin/secrets.mjs set <NAME>` for each');
  });

  test('a READY area passes every check and reaches the job slot — held here, so nothing runs', async () => {
    process.env.CWFX_BOLA_PASS_A = randomBytes(12).toString('hex');
    process.env.CWFX_BOLA_PASS_B = randomBytes(12).toString('hex');
    occupy('bola');
    try {
      const r = await call('/api/bola/run', { project: 'Fix Area' });   // a label resolves to its slug
      assert.equal(r.code, 200);
      assert.deepEqual(r.payload, { started: false, reason: 'already running' });
    } finally {
      release('bola');
      delete process.env.CWFX_BOLA_PASS_A; delete process.env.CWFX_BOLA_PASS_B;
    }
  });
});

describe('POST /api/stpa/run', () => {
  test('reaches the job slot — held here, so nothing runs', async () => {
    occupy('stpa');
    try {
      const r = await call('/api/stpa/run', { project: 'fixarea' });
      assert.equal(r.code, 200);
      assert.deepEqual(r.payload, { started: false, reason: 'already running' });
    } finally { release('stpa'); }
  });
});

describe('POST /api/health/*', () => {
  const PATHS = { all: '/api/health/all', deadcode: '/api/health/deadcode', gates: '/api/health/gates', provenance: '/api/health/provenance', toolchain: '/api/health/toolchain' };

  test('each health trigger refuses to run with no project selected', async () => {
    for (const [kind, path] of Object.entries(PATHS)) {
      assert.equal(jobs[`health-${kind}`], undefined, `${kind}: a fresh engine has no persisted run`);
      const r = await call(path);
      assert.equal(r.code, 200, path);
      assert.deepEqual(r.payload, { started: false, reason: 'no project selected — choose a project first; these runs are per project' });
      assert.equal(jobs[`health-${kind}`], undefined, `${kind}: a refused trigger records no job`);
    }
  });

  test('each health trigger with a project reaches its own job slot — held here, so nothing runs', async () => {
    for (const [kind, path] of Object.entries(PATHS)) {
      occupy(`health-${kind}`);
      try {
        const r = await call(path, { project: 'fixarea' });
        assert.equal(r.code, 200, path);
        assert.deepEqual(r.payload, { started: false, reason: 'already running' });
      } finally { release(`health-${kind}`); }
    }
    assert.equal(existsSync(join(TMP, 'health-runs.json')), false, 'nothing was persisted for a run that never started');
  });

  test('exactly these five health kinds are routed', () => {
    const health = routes.filter((r) => r.path.startsWith('/api/health/')).map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(health, Object.values(PATHS).map((p) => `POST ${p}`).sort());
  });
});

test('every job-starting route is POST-only in the dispatch table', () => {
  for (const p of ['/api/scan', '/api/bola/run', '/api/stpa/run', '/api/health/all', '/api/health/deadcode', '/api/health/gates', '/api/health/provenance', '/api/health/toolchain']) {
    assert.deepEqual(routes.filter((r) => r.path === p).map((r) => r.method), ['POST'], p);
  }
});
