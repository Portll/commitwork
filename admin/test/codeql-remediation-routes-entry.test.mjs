// admin/routes/codeql-remediation.mjs — the two read routes, invoked as handlers over a temp job store.
//
// codeql-remediation.test.mjs drives the pipeline through a spawned panel; neither GET was invoked
// directly. The list is a PROJECTION — orphan state derived at read time, stage verdicts reduced to
// their heart — and both reads fail closed on a torn file (the detail read with a 500, as cobolwork's
// does). The job store is reportsFor(project)/codeql-remediation under a temp reportsRoot
// (CW_REGISTRY). Nothing here starts an engine.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-cqrem-entry-'));
const REPORTS = join(TMP, 'reports');
mkdirSync(join(TMP, 'src'), { recursive: true });
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'] }],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.HOME = TMP;

const core = await import('../lib/core.mjs');
const { initJobs, knownProjects } = await import('../lib/jobs.mjs');
const { primaryArea } = await import('../../monitor/registry.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
initJobs({ CW: TMP, registry: core.registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
const { routes, jobIdFor, findingKey } = await import('../routes/codeql-remediation.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const DIR = join(REPORTS, 'fixarea', 'codeql-remediation');
const route = (path) => routes.find((r) => r.method === 'GET' && r.path === path);

function call(path, query) {
  const r = route(path);
  assert.ok(r, `GET ${path} is not a registered route`);
  let out = null;
  r.handle({ query: new URLSearchParams(query), send: (status, body) => { out = { status, body }; }, knownProjects,
    isLoopbackReq: false, adminSession: () => null, req: { url: `${path}?${query}`, headers: {} } });
  assert.ok(out, `GET ${path} answered nothing`);
  return out;
}

const FINDING = { service: 'fixrepo', sarif: 'codeql.sarif', ruleId: 'js/sql-injection', file: 'src/db.js', severity: 'error', line: 40 };
const ID = jobIdFor(FINDING);
const plant = (id, doc) => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${id}.json`), typeof doc === 'string' ? doc : JSON.stringify(doc));
};
const lodged = (over = {}) => ({
  id: ID, key: findingKey(FINDING), state: 'lodged', updatedAt: '2026-09-30T00:00:00.000Z', lodgedAt: '2026-09-30T00:00:00.000Z',
  finding: { ...FINDING, snippet: 'source text that must not ride the list' },
  agreement: { agree: true, basis: 'both engines classified real' },
  remediation: { executable: true, diff: '--- a\n+++ b\n' },
  stages: {
    local: { status: 'done', queuedAt: 'q', startedAt: 's', verdict: { classification: 'real', confidence: 'high', diff: '--- a\n', investigation: 'long prose' } },
    opus: { status: 'done', verdict: { classification: 'real', confidence: 'medium', diff: '   ' } },
  },
  events: Array.from({ length: 30 }, (_, i) => ({ at: 't', msg: `m${i}` })),
  ...over,
});

beforeEach(() => rmSync(DIR, { recursive: true, force: true }));

describe('GET /api/codeql/remediation', () => {
  test('an area with no job store is an empty, ok list', () => {
    const res = call('/api/codeql/remediation', 'project=fixarea');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, jobs: [] });
  });

  test('a lodged job is projected: finding fields whitelisted, stage verdicts reduced, events tailed', () => {
    plant(ID, lodged());
    const res = call('/api/codeql/remediation', 'project=fixarea');
    assert.equal(res.status, 200);
    const [j] = res.body.jobs;
    assert.equal(j.id, ID);
    assert.equal(j.state, 'lodged');
    assert.equal(j.executable, true);
    assert.deepEqual(j.finding, { service: 'fixrepo', ruleId: 'js/sql-injection', file: 'src/db.js', sarif: 'codeql.sarif', severity: 'error', line: 40 });
    assert.deepEqual(j.stages.local, { status: 'done', queuedAt: 'q', startedAt: 's', classification: 'real', confidence: 'high', diff: true });
    assert.equal(j.stages.opus.diff, false, 'a whitespace-only diff is no diff');
    assert.equal(j.events.length, 14);
    assert.equal(j.events.at(-1).msg, 'm29');
    assert.equal(JSON.stringify(res.body).includes('source text that must not ride the list'), false);
  });

  test('queued and running jobs with no pipeline in this process read as orphaned; newest first', () => {
    const a = 'a'.repeat(16), b = 'b'.repeat(16);
    plant(a, { id: a, state: 'queued', updatedAt: '2026-09-28T00:00:00.000Z' });
    plant(b, { id: b, state: 'running', updatedAt: '2026-09-29T00:00:00.000Z' });
    plant(ID, lodged());
    const res = call('/api/codeql/remediation', 'project=fixarea');
    assert.deepEqual(res.body.jobs.map((j) => [j.id, j.state]), [[ID, 'lodged'], [b, 'orphaned'], [a, 'orphaned']]);
  });

  test('a torn job file is listed as unreadable with the reason, never dropped from the list', () => {
    plant(ID, '{"id": "trunc');
    const res = call('/api/codeql/remediation', 'project=fixarea');
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.jobs, [{ id: ID, state: 'unreadable', error: 'job file did not parse — this is not an absent job' }]);
  });

  test('a store path that cannot be listed is ok:false, never an empty list', () => {
    mkdirSync(join(REPORTS, 'fixarea'), { recursive: true });
    writeFileSync(DIR, 'not a directory');
    const res = call('/api/codeql/remediation', 'project=fixarea');
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /job store unreadable/);
    assert.deepEqual(res.body.jobs, []);
    rmSync(DIR, { force: true });
  });
});

describe('GET /api/codeql/remediation/job', () => {
  test('an id that is not 16 hex is a 400 and never becomes a path', () => {
    for (const id of ['', '../../../etc/pas', 'ABCDEFABCDEFABCD', `${ID}0`]) {
      const res = call('/api/codeql/remediation/job', `project=fixarea&id=${encodeURIComponent(id)}`);
      assert.equal(res.status, 400, `id ${JSON.stringify(id)}`);
      assert.match(res.body.error, /16-hex job id/);
    }
  });

  test('an id with no record is a 404 "no such job"', () => {
    const res = call('/api/codeql/remediation/job', `project=fixarea&id=${'e'.repeat(16)}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no such job');
  });

  test('a torn record is a 500 that says it did not parse, distinct from an absent one', () => {
    plant(ID, '{ torn');
    const res = call('/api/codeql/remediation/job', `project=fixarea&id=${ID}`);
    assert.equal(res.status, 500, 'a record that exists and will not parse is a fault here, never a 404');
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'job file did not parse — this is not an absent job');
    assert.match(res.body.why, /JSON/, 'the parser\'s own reason travels with the refusal');
  });

  test('a record that parses to no job object is a 500 too, never an absent job', () => {
    for (const body of ['null', '"a string"', '7']) {
      plant(ID, body);
      const res = call('/api/codeql/remediation/job', `project=fixarea&id=${ID}`);
      assert.equal(res.status, 500, `body ${body}`);
      assert.equal(res.body.ok, false);
    }
  });

  test('the full record comes back unprojected, for the detail view', () => {
    plant(ID, lodged());
    const res = call('/api/codeql/remediation/job', `project=Fix%20Area&id=${ID}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.job.stages.local.verdict.investigation, 'long prose');
    assert.equal(res.body.job.remediation.diff, '--- a\n+++ b\n');
    assert.equal(res.body.job.events.length, 30);
  });
});
