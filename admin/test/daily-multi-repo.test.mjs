// GET /api/daily for an area with more than one repository.
//
// bin/daily-run.mjs writes one report per AREA, each suggestion tagged with its repo. The route used
// to read the folder the selected name resolved to and keep suggestions whose repo equalled that
// name: an area showed none of its suggestions, and a repository looked in a folder of its own that
// is never written. A synthetic two-repo area reproduced both before the fix.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-daily-multi-'));
const REPORTS = join(TMP, 'reports');
for (const r of ['one', 'two']) mkdirSync(join(TMP, r), { recursive: true });
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [
    { name: 'one', area: 'ar', path: join(TMP, 'one'), manifest: 'security-baseline' },
    { name: 'two', area: 'ar', path: join(TMP, 'two'), manifest: 'security-baseline' },
  ],
  areas: [{ slug: 'ar', label: 'Area R', out: 'ar', primary: true, members: ['one', 'two'] }],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.HOME = TMP;

const core = await import('../lib/core.mjs');
const { initJobs } = await import('../lib/jobs.mjs');
const { primaryArea } = await import('../../monitor/registry.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
initJobs({ CW: TMP, registry: core.registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
const { routes, dailyScope } = await import('../routes/daily.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const route = routes.find((r) => r.method === 'GET' && r.path === '/api/daily');
function call(project) {
  let out = null;
  route.handle({ req: { url: `/api/daily?project=${encodeURIComponent(project)}` }, send: (status, body) => { out = { status, body }; }, isLoopbackReq: true });
  return out;
}

const suggestion = (id, repo) => ({ id, repo, findingIds: ['aaaaaaaaaaaaaaaa'], priority: 'p1', title: `fix ${id}`, why: 'w',
  where: [{ file: 'src/a.js', line: 3 }], change: 'c', verify: { lane: 'sast', expect: 'e' }, effort: 'S', confidence: 'high' });
const DAILY = join(REPORTS, 'ar', 'daily');
mkdirSync(DAILY, { recursive: true });
writeFileSync(join(DAILY, 'sweep-20261002000000.json'), JSON.stringify({
  schema: 'commitwork.daily-report/1', area: 'ar', batch: 'sweep-20261002000000', previousBatch: null, digestId: 'a'.repeat(64),
  generatedAt: '2026-10-02T01:00:00Z',
  summary: { new: 2, persisting: 0, fixed: 0, carried: 0, omitted: 0, voidLanes: 0, gapDays: null, baselineRepos: ['one', 'two'] },
  coverage: [{ repo: 'one', lane: 'sbom-syft', state: 'failed' }, { repo: 'two', lane: 'sast', state: 'skipped' }],
  run: { model: 'm', cli: 'c', attempts: 1, costUsd: 0.25, durationMs: 1, skillSha256: null, authority: 'a' },
  headline: 'two things to fix', suggestions: [suggestion('S1', 'one'), suggestion('S2', 'two')], notActioned: [],
}));

test('the area, by label or by slug, serves every suggestion its report holds', () => {
  for (const project of ['Area R', 'ar']) {
    const res = call(project);
    assert.equal(res.status, 200, project);
    assert.equal(res.body.state, 'ok', project);
    assert.deepEqual(res.body.suggestions.map((s) => s.id), ['S1', 'S2'], project);
    assert.equal(res.body.coverage.length, 2, project);
  }
});

test('a repository reads its area\'s report, narrowed to its own rows', () => {
  for (const [project, id] of [['one', 'S1'], ['two', 'S2']]) {
    const res = call(project);
    assert.equal(res.body.state, 'ok', `${project}: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body.suggestions.map((s) => s.id), [id]);
    assert.deepEqual(res.body.coverage.map((c) => c.repo), [project]);
  }
});

test('dailyScope names the area and the narrowing', () => {
  const reg = core.registry();
  assert.deepEqual(dailyScope('Area R', reg), { area: 'ar', repo: null });
  assert.deepEqual(dailyScope('two', reg), { area: 'ar', repo: 'two' });
});
