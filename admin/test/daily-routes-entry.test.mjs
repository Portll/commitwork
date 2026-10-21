// admin/routes/daily.mjs — GET /api/daily through its handler: project and batch validation, the
// area directory reportsFor() resolves, and the 500 a torn report becomes.
//
// daily-route.test.mjs tests dailyView() against a directory it names itself; only the 403 went
// through the handler. Here the directory comes from the registry, as it does in the panel: a temp
// registry (CW_REGISTRY) declares a single-repo area whose reportsRoot is under TMP.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-daily-entry-'));
const REPORTS = join(TMP, 'reports');
mkdirSync(join(TMP, 'solo'), { recursive: true });
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'solo', area: 'solo', path: join(TMP, 'solo'), manifest: 'security-baseline' }],
  areas: [{ slug: 'solo', label: 'solo', out: 'solo', primary: true, members: ['solo'] }],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.HOME = TMP;

const core = await import('../lib/core.mjs');
const { initJobs } = await import('../lib/jobs.mjs');
const { primaryArea } = await import('../../monitor/registry.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
initJobs({ CW: TMP, registry: core.registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
const { routes } = await import('../routes/daily.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const DAILY = join(REPORTS, 'solo', 'daily');
const route = routes.find((r) => r.method === 'GET' && r.path === '/api/daily');

// `'loopback' in opts`, not a default parameter: a default would turn an explicit undefined into true.
function call(query, opts = {}) {
  const loopback = 'loopback' in opts ? opts.loopback : true;
  let out = null;
  route.handle({ req: { url: `/api/daily?${query}` }, send: (status, body) => { out = { status, body }; }, isLoopbackReq: loopback });
  assert.ok(out, 'the handler answered nothing');
  return out;
}

const suggestion = (id, repo) => ({ id, repo, findingIds: ['aaaaaaaaaaaaaaaa'], priority: 'p1', title: `fix ${id}`, why: 'w',
  where: [{ file: 'src/a.js', line: 3 }], change: 'c', verify: { lane: 'sast', expect: 'e' }, effort: 'S', confidence: 'high' });
const report = (batch, suggestions) => ({
  schema: 'commitwork.daily-report/1', area: 'solo', batch, previousBatch: null, digestId: 'a'.repeat(64), generatedAt: '2026-10-02T01:00:00Z',
  summary: { new: 1, persisting: 0, fixed: 0, carried: 0, omitted: 0, voidLanes: 0, gapDays: null, baselineRepos: ['solo'] },
  coverage: [{ repo: 'solo', lane: 'sbom-syft', state: 'failed' }],
  run: { model: 'm', cli: 'c', attempts: 1, costUsd: 0.25, durationMs: 1, skillSha256: null, authority: 'a' },
  headline: 'one thing to fix', suggestions, notActioned: [],
});
const put = (name, value) => writeFileSync(join(DAILY, name), typeof value === 'string' ? value : JSON.stringify(value));

beforeEach(() => rmSync(join(REPORTS, 'solo'), { recursive: true, force: true }));

describe('GET /api/daily — refusals', () => {
  test('only a strictly-true loopback flag is the operator port; truthy is not enough', () => {
    for (const loopback of [false, undefined, 'true', 1]) {
      const res = call('project=solo', { loopback });
      assert.equal(res.status, 403, String(loopback));
      assert.equal(res.body.localOnly, true);
    }
  });

  test('a project the registry does not know is a 400, and so is no project at all', () => {
    assert.deepEqual(call('project=not-declared'), { status: 400, body: { error: 'unknown project' } });
    assert.deepEqual(call(''), { status: 400, body: { error: 'unknown project' } });
  });

  test('a batch that is not a sweep id is a 400 before any file is named from it', () => {
    for (const batch of ['../ledger', 'sweep-2026', 'sweep-20261002000000.todos', 'ledger']) {
      const res = call(`project=solo&batch=${encodeURIComponent(batch)}`);
      assert.equal(res.status, 400, batch);
      assert.match(res.body.error, /batch must look like sweep-YYYYMMDDHHMMSS/);
    }
  });
});

describe('GET /api/daily — reading the area the registry resolves', () => {
  test('an area with no daily directory is "no-reports", never ok with nothing in it', () => {
    const res = call('project=solo');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { state: 'no-reports', project: 'solo', batches: [] });
  });

  test('the newest batch is served, with its suggestion, ledger todo and run cost', () => {
    mkdirSync(DAILY, { recursive: true });
    put('sweep-20261001000000.json', report('sweep-20261001000000', []));
    put('sweep-20261002000000.json', report('sweep-20261002000000', [suggestion('S1', 'solo')]));
    put('ledger.json', { findings: { aaaaaaaaaaaaaaaa: { todoId: 'todo-1' } } });
    const res = call('project=solo');
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'ok');
    assert.equal(res.body.batch, 'sweep-20261002000000');
    assert.deepEqual(res.body.batches, ['sweep-20261002000000', 'sweep-20261001000000']);
    assert.deepEqual(res.body.suggestions.map((s) => [s.id, s.todos]), [['S1', ['todo-1']]]);
    assert.deepEqual(res.body.run, { model: 'm', costUsd: 0.25, attempts: 1 });
    assert.equal(res.body.todos, null, 'no todos file is null, not zero created');
  });

  test('a named batch is served when it exists, and "no-report-for-batch" when it does not', () => {
    mkdirSync(DAILY, { recursive: true });
    put('sweep-20261001000000.json', report('sweep-20261001000000', [suggestion('OLD', 'solo')]));
    put('sweep-20261002000000.json', report('sweep-20261002000000', [suggestion('NEW', 'solo')]));
    const older = call('project=solo&batch=sweep-20261001000000');
    assert.equal(older.body.state, 'ok');
    assert.deepEqual(older.body.suggestions.map((s) => s.id), ['OLD']);
    const absent = call('project=solo&batch=sweep-20250101000000');
    assert.equal(absent.status, 200);
    assert.equal(absent.body.state, 'no-report-for-batch');
    assert.equal(absent.body.batch, 'sweep-20250101000000');
  });

  test('a report that does not parse is a 500 with the reason, not an empty list', () => {
    mkdirSync(DAILY, { recursive: true });
    put('sweep-20261002000000.json', '{ "schema": "commitwork.daily-report/1", ');
    const res = call('project=solo');
    assert.equal(res.status, 500);
    assert.match(res.body.error, /JSON/);
  });

  test('a report missing required fields is "unreadable" with the validator\'s reason', () => {
    mkdirSync(DAILY, { recursive: true });
    put('sweep-20261002000000.json', { schema: 'commitwork.daily-report/1' });
    const res = call('project=solo');
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'unreadable');
    assert.match(res.body.error, /required/);
  });
});
