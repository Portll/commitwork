import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GithubError } from '../github.mjs';
import { gather, gatherRepo, poll } from '../poll.mjs';
import { NOW, PRIVATE, PUBLIC, exampleConfig, fixture, makeJob, makeRun, withStep } from './lib/fixtures.mjs';

const LOCAL = withStep('- uses: ./.github/actions/setup');
const notFound = (where) => { throw new GithubError(404, 'Not Found', where); };

// A client with only the read methods: a tick that tried to act would throw.
function fakeGh(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...args) => { calls.push([name, ...args]); return fn(...args); };
  const gh = {
    repoMeta: rec('repoMeta', (repo) => fixture(repo === PUBLIC ? 'repo-public.json' : 'repo-private.json')),
    forkApproval: rec('forkApproval', () => ({ approval_policy: 'all_external_contributors' })),
    runs: rec('runs', (repo, status) => (status === 'queued' ? [makeRun({ repo })] : [])),
    runJobs: rec('runJobs', () => [makeJob()]),
    fileAt: rec('fileAt', (repo, path) => (path.endsWith('ci.yml') ? LOCAL
      : path.endsWith('action.yml') ? notFound(path) : 'runs:\n  using: node20\n  main: i.js\n')),
    runners: rec('runners', () => []),
  };
  for (const [name, fn] of Object.entries(over)) gh[name] = rec(name, fn);
  gh.calls = calls;
  return gh;
}
const called = (gh, name) => gh.calls.filter((c) => c[0] === name);

test('the fork-PR policy is read for a public repo only', async () => {
  const gh = fakeGh();
  const snap = await gather(gh, exampleConfig());
  assert.deepEqual(called(gh, 'forkApproval').map((c) => c[1]), [PUBLIC]);
  assert.equal(snap[PRIVATE].policy, null);
  assert.equal(snap[PUBLIC].policy.approval_policy, 'all_external_contributors');
});

test('queued and in_progress runs are both listed, once each', async () => {
  const run = makeRun();
  const gh = fakeGh({ runs: () => [run] });
  const snap = await gatherRepo(gh, PRIVATE);
  assert.deepEqual(called(gh, 'runs').map((c) => c[2]), ['queued', 'in_progress']);
  assert.equal(snap.queuedRuns.length, 1);
  assert.equal(called(gh, 'runJobs').length, 1);
});

test('a local action is fetched at the head sha, action.yaml after a 404 on action.yml', async () => {
  const gh = fakeGh();
  const snap = await gatherRepo(gh, PRIVATE);
  const sha = makeRun().head_sha;
  assert.deepEqual(called(gh, 'fileAt').map((c) => c[2]), ['.github/workflows/ci.yml', '.github/actions/setup/action.yml', '.github/actions/setup/action.yaml']);
  assert.ok(called(gh, 'fileAt').every((c) => c[3] === sha));
  assert.match(snap.actionTexts[`.github/actions/setup@${sha}`], /node20/);
});

test('a run with no addressed job costs no workflow read', async () => {
  const gh = fakeGh({ runJobs: () => [makeJob({ labels: ['ubuntu-latest'] })] });
  const snap = await gatherRepo(gh, PRIVATE);
  assert.equal(called(gh, 'fileAt').length, 0);
  assert.deepEqual(snap.workflowTexts, {});
});

test('a GithubError lands in the snapshot as { error }; any other error propagates', async () => {
  const snap = await gatherRepo(fakeGh({ runners: () => { throw new GithubError(502, 'Bad Gateway', 'runners'); } }), PRIVATE);
  assert.deepEqual(snap.runners, { error: { status: 502, reason: 'Bad Gateway' } });
  const listed = await gatherRepo(fakeGh({ runs: () => { throw new GithubError(403, 'Forbidden', 'runs'); } }), PRIVATE);
  assert.deepEqual(listed.queuedRuns, { error: { status: 403, reason: 'Forbidden' } });
  await assert.rejects(gatherRepo(fakeGh({ runners: () => { throw new TypeError('a defect'); } }), PRIVATE), TypeError);
});

test('poll returns the actions and executes none', async () => {
  const config = exampleConfig({ repos: [{ repo: PRIVATE }] });
  const gh = fakeGh();
  const { snapshot, actions } = await poll({ gh, config, freeSlots: ['slot-1'], now: NOW });
  assert.ok(snapshot[PRIVATE]);
  assert.deepEqual(actions.map((a) => a.kind), ['record', 'mint']);
  assert.deepEqual(new Set(gh.calls.map((c) => c[0])), new Set(['repoMeta', 'runs', 'runJobs', 'fileAt', 'runners']));
});

test('poll honours CW_NOW, read at call time', async (t) => {
  const prior = process.env.CW_NOW;
  t.after(() => { if (prior === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prior; });
  process.env.CW_NOW = '2026-10-22T09:10:00Z';
  const { actions } = await poll({ gh: fakeGh(), config: exampleConfig({ repos: [{ repo: PRIVATE }] }), freeSlots: ['slot-1'] });
  assert.equal(actions.find((a) => a.kind === 'mint').name, `cw-slot-1-399444496-${NOW / 1000}`);
});
