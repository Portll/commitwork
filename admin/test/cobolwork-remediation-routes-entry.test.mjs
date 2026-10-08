// admin/routes/cobolwork-remediation.mjs — the read routes and the three state-changing POSTs that
// never start a model or the scanner: stop, verify (up to its refusal) and clear.
//
// POST /api/cobolwork/remediate and /remediate/apply are deliberately absent: the first starts a
// local model and the scanner, the second commits to a repository. verify is driven only to the
// refusals that precede verifyApplied(), which is the point where the cobolwork gate would run.
// Every store is a temp fixture (CW_REGISTRY points at a registry whose reportsRoot is under TMP).
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-cobolrem-entry-'));
const REPORTS = join(TMP, 'reports');
mkdirSync(join(TMP, 'src'), { recursive: true });
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'] }],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.CW_VERDICT_DIR = join(TMP, 'verdicts');
process.env.CW_NOW = '2026-10-01T00:00:00.000Z';
process.env.HOME = TMP;

const core = await import('../lib/core.mjs');
const { initJobs, knownProjects } = await import('../lib/jobs.mjs');
const { primaryArea } = await import('../../monitor/registry.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
initJobs({ CW: TMP, registry: core.registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
const { routes } = await import('../routes/cobolwork-remediation.mjs');
const { jobIdFor } = await import('../../lib/cobolwork-remediation.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const DIR = join(REPORTS, 'fixarea', 'cobolwork-remediation');
const FP = 'ab'.repeat(16);
const ID = jobIdFor('fixrepo', FP);
const route = (method, path) => routes.find((r) => r.method === method && r.path === path);

function plant(id, job) {
  mkdirSync(DIR, { recursive: true });
  const p = join(DIR, `${id}.json`);
  writeFileSync(p, typeof job === 'string' ? job : JSON.stringify(job, null, 2));
  return p;
}
const job = (over = {}) => ({
  schema: 'commitwork/cobolwork-remediation-job.v1', id: ID, repo: 'fixrepo', project: 'fixarea', fingerprint: FP,
  maxAttempts: 3, remote: false, state: 'lodged', updatedAt: '2026-09-30T00:00:00.000Z', events: [], attempts: [],
  final: null, review: null, applied: null, verifications: [], error: null, ...over,
});

const OPERATOR = { user: 'op@example.test', provider: 'local' };
/** Invoke a handler with the dispatcher's ctx shape; resolves on the first send(). */
function call(method, path, { query = '', body = {}, readErr = null, loopback = false, session = null } = {}) {
  const r = route(method, path);
  assert.ok(r, `${method} ${path} is not a registered route`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} ${path} never answered`)), 5000);
    const ctx = {
      req: { url: `${path}?${query}`, headers: {} },
      query: new URLSearchParams(query),
      send: (status, payload) => { clearTimeout(timer); resolve({ status, body: payload }); },
      readJsonBody: (_req, cb) => (readErr ? cb(null, readErr) : cb(body, null)),
      isLoopbackReq: loopback,
      adminSession: () => session,
      knownProjects,
    };
    Promise.resolve(r.handle(ctx)).catch(reject);
  });
}

beforeEach(() => rmSync(DIR, { recursive: true, force: true }));

describe('GET /api/cobolwork/remediation', () => {
  test('no job store yet is an empty list, stated ok', async () => {
    const res = await call('GET', '/api/cobolwork/remediation', { query: 'project=fixarea' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, jobs: [] });
  });

  test('lists every job newest first; a running job with no pipeline in this process reads as orphaned', async () => {
    const other = 'c'.repeat(16);
    plant(ID, job({ updatedAt: '2026-09-29T00:00:00.000Z', finding: { rule: 'COBOL-SQL-1', sev: 'high', path: 'src/PAY.cbl', line: 12, extra: 'not projected' } }));
    plant(other, job({ id: other, state: 'running', updatedAt: '2026-09-30T00:00:00.000Z', events: Array.from({ length: 20 }, (_, i) => ({ at: 't', msg: `e${i}` })) }));
    writeFileSync(join(DIR, 'not-a-job.json'), '{}');
    const res = await call('GET', '/api/cobolwork/remediation', { query: 'project=fixarea' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.jobs.map((j) => [j.id, j.state]), [[other, 'orphaned'], [ID, 'lodged']]);
    assert.deepEqual(res.body.jobs[1].finding, { rule: 'COBOL-SQL-1', sev: 'high', path: 'src/PAY.cbl', line: 12 });
    assert.equal(res.body.jobs[0].events.length, 14, 'the list carries the event tail, not the whole narration');
    assert.equal(res.body.jobs[0].events.at(-1).msg, 'e19');
  });

  test('a job file that does not parse is listed as unreadable, never dropped', async () => {
    plant(ID, '{ torn');
    const res = await call('GET', '/api/cobolwork/remediation', { query: 'project=fixarea' });
    assert.equal(res.body.ok, true);
    assert.equal(res.body.jobs.length, 1);
    assert.equal(res.body.jobs[0].state, 'unreadable');
    assert.match(res.body.jobs[0].error, /does not parse/);
  });

  test('a store that cannot be read is ok:false with the reason, never an empty list', async () => {
    mkdirSync(join(REPORTS, 'fixarea'), { recursive: true });
    writeFileSync(DIR, 'a file where the job directory should be');
    const res = await call('GET', '/api/cobolwork/remediation', { query: 'project=fixarea' });
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /job store unreadable/);
    rmSync(DIR, { force: true });
  });
});

describe('GET /api/cobolwork/remediation/job', () => {
  test('an id that is not 16 hex is refused before any read', async () => {
    const res = await call('GET', '/api/cobolwork/remediation/job', { query: 'project=fixarea&id=../../etc' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /16-hex job id/);
  });

  test('an unknown id is a 404', async () => {
    const res = await call('GET', '/api/cobolwork/remediation/job', { query: `project=fixarea&id=${'d'.repeat(16)}` });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no such job');
  });

  test('the full record comes back, with an orphaned run named as such', async () => {
    plant(ID, job({ state: 'running', attempts: [{ n: 1 }] }));
    const res = await call('GET', '/api/cobolwork/remediation/job', { query: `project=fixarea&id=${ID}` });
    assert.equal(res.status, 200);
    assert.equal(res.body.job.state, 'orphaned');
    assert.equal(res.body.job.fingerprint, FP);
    assert.deepEqual(res.body.job.attempts, [{ n: 1 }]);
  });

  test('a torn job file is a 500, not an absent job', async () => {
    plant(ID, '{ torn');
    const res = await call('GET', '/api/cobolwork/remediation/job', { query: `project=fixarea&id=${ID}` });
    assert.equal(res.status, 500);
    assert.match(res.body.error, /does not parse/);
  });
});

describe('POST /api/cobolwork/remediate/stop', () => {
  test('without a session and off the operator port it is refused', async () => {
    const res = await call('POST', '/api/cobolwork/remediate/stop', { body: { id: ID } });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /stops processes/);
  });

  test('a body the reader could not parse is a 400 carrying the reader\'s reason', async () => {
    const res = await call('POST', '/api/cobolwork/remediate/stop', { readErr: 'body is not valid JSON', session: OPERATOR });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'body is not valid JSON');
  });

  test('a malformed id is a 400', async () => {
    const res = await call('POST', '/api/cobolwork/remediate/stop', { body: { id: 'XYZ' }, session: OPERATOR });
    assert.equal(res.status, 400);
  });

  test('stopping a job nothing is running for is a 409, on the operator port too', async () => {
    plant(ID, job({ state: 'running' }));
    const res = await call('POST', '/api/cobolwork/remediate/stop', { body: { id: ID }, loopback: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'nothing is running for this job');
  });
});

describe('POST /api/cobolwork/remediate/verify', () => {
  test('without a session and off the operator port it is refused', async () => {
    plant(ID, job({ state: 'applied', applied: { commit: 'f'.repeat(40) } }));
    const res = await call('POST', '/api/cobolwork/remediate/verify', { body: { project: 'fixarea', id: ID } });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /runs the scanner/);
  });

  test('a malformed id is a 400 and an unknown one a 404', async () => {
    const bad = await call('POST', '/api/cobolwork/remediate/verify', { body: { project: 'fixarea', id: 'nope' }, session: OPERATOR });
    assert.equal(bad.status, 400);
    const missing = await call('POST', '/api/cobolwork/remediate/verify', { body: { project: 'fixarea', id: ID }, session: OPERATOR });
    assert.equal(missing.status, 404);
  });

  test('a job whose repository is not declared on this machine is a 409 naming it', async () => {
    plant(ID, job({ repo: 'ghost-repo', state: 'applied' }));
    const res = await call('POST', '/api/cobolwork/remediate/verify', { body: { project: 'fixarea', id: ID }, session: OPERATOR });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /ghost-repo is not resolvable/);
  });

  test('only an applied draft is verified: a lodged one is a 409 and its record is untouched', async () => {
    const p = plant(ID, job({ state: 'lodged' }));
    const before = readFileSync(p, 'utf8');
    const res = await call('POST', '/api/cobolwork/remediate/verify', { body: { project: 'fixarea', id: ID }, session: OPERATOR });
    assert.equal(res.status, 409);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /the job is lodged; only an applied draft is verified/);
    assert.equal(readFileSync(p, 'utf8'), before);
  });
});

describe('POST /api/cobolwork/remediation/clear', () => {
  test('without a session and off the operator port it is refused and the record stays', async () => {
    const p = plant(ID, job());
    const res = await call('POST', '/api/cobolwork/remediation/clear', { body: { project: 'fixarea', id: ID } });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /deletes records/);
    assert.equal(existsSync(p), true);
  });

  test('a malformed id is a 400 and an unknown one a 404', async () => {
    assert.equal((await call('POST', '/api/cobolwork/remediation/clear', { body: { project: 'fixarea', id: 1 }, session: OPERATOR })).status, 400);
    assert.equal((await call('POST', '/api/cobolwork/remediation/clear', { body: { project: 'fixarea', id: ID }, session: OPERATOR })).status, 404);
  });

  test('a torn record is a 500 and is NOT deleted: an unreadable job is not a finished one', async () => {
    const p = plant(ID, '{ torn');
    const res = await call('POST', '/api/cobolwork/remediation/clear', { body: { project: 'fixarea', id: ID }, session: OPERATOR });
    assert.equal(res.status, 500);
    assert.equal(existsSync(p), true);
  });

  test('a finished job with no draft ref is removed from the store', async () => {
    const p = plant(ID, job({ state: 'failed', error: 'drafter unreachable' }));
    const res = await call('POST', '/api/cobolwork/remediation/clear', { body: { project: 'fixarea', id: ID }, loopback: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(existsSync(p), false);
    const list = await call('GET', '/api/cobolwork/remediation', { query: 'project=fixarea' });
    assert.deepEqual(list.body.jobs, []);
  });
});
