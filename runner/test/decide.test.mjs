import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../decide.mjs';
import { parseRunnerName } from '../reconcile.mjs';
import { NOW, PRIVATE, PUBLIC, exampleConfig, fixture, makeJob, makeRun, repoSnapshot, withBuild } from './lib/fixtures.mjs';

const config = exampleConfig();
const ALL = ['slot-1', 'slot-2'];
const kinds = (actions) => actions.map((a) => a.kind);
const of = (actions, kind) => actions.filter((a) => a.kind === kind);
const codes = (actions) => of(actions, 'record').map((a) => a.decision.code);
const job = (id, at, over = {}) => makeJob({ id, created_at: at, ...over });
// Both declared repos must be in a snapshot: an absent one is recorded as runs-unmeasured.
const QUIET = { meta: fixture('repo-private.json'), policy: null, queuedRuns: [], workflowTexts: {}, actionTexts: {}, runners: [] };
const tick = (snapshot, freeSlots = ALL, now = NOW) => decide({ config, snapshot: { [PRIVATE]: QUIET, [PUBLIC]: QUIET, ...snapshot }, freeSlots, now });

test('capacity: never more mints than free slots, oldest queued job first', () => {
  const run = makeRun();
  const jobs = [job(3, '2026-10-22T09:03:00Z'), job(1, '2026-10-22T09:01:00Z'), job(2, '2026-10-22T09:02:00Z')];
  const actions = tick({ [PRIVATE]: repoSnapshot({ run, jobs }) }, ['slot-2', 'slot-1']);
  const mints = of(actions, 'mint');
  assert.deepEqual(mints.map((m) => [m.jobId, m.slotId]), [[1, 'slot-1'], [2, 'slot-2']], 'slots in declared order');
  assert.deepEqual(mints[0].labels, config.labels);
  assert.deepEqual(parseRunnerName(mints[0].name), { slotId: 'slot-1', jobId: 1, mintedSec: NOW / 1000 });
  const waiting = of(actions, 'record').find((r) => r.decision.jobId === 3).decision;
  assert.deepEqual([waiting.admit, waiting.code], [true, 'capacity-wait']);
  assert.equal(of(tick({ [PRIVATE]: repoSnapshot({ run, jobs }) }, []), 'mint').length, 0);
  assert.equal(of(tick({ [PRIVATE]: repoSnapshot({ run, jobs }) }, ['slot-9']), 'mint').length, 0, 'an undeclared slot id is not capacity');
});

test('capacity is shared across repos, oldest first', () => {
  const pub = repoSnapshot({ run: makeRun({ repo: PUBLIC, id: 2 }), jobs: [job(20, '2026-10-22T09:00:30Z')],
    meta: fixture('repo-public.json') });
  pub.policy = { approval_policy: 'all_external_contributors' };
  const priv = repoSnapshot({ jobs: [job(10, '2026-10-22T09:01:00Z')] });
  const mints = of(tick({ [PRIVATE]: priv, [PUBLIC]: pub }, ['slot-1']), 'mint');
  assert.deepEqual(mints.map((m) => [m.repo, m.jobId]), [[PUBLIC, 20]]);
});

test('stale delete: only dispatcher-named, idle runners past staleRunnerSec', () => {
  const runners = fixture('runners.json').runners;
  const actions = tick({ [PRIVATE]: repoSnapshot({ jobs: [], runners }) }, ALL);
  assert.deepEqual(of(actions, 'delete'), [{ kind: 'delete', repo: PRIVATE, runnerId: 23, name: 'cw-slot-1-399444400-1792659000' }]);
});

test('a fresh idle runner covers the oldest admitted job instead of a second mint', () => {
  const runners = fixture('runners.json').runners;
  const jobs = [job(1, '2026-10-22T09:01:00Z'), job(2, '2026-10-22T09:02:00Z')];
  const actions = tick({ [PRIVATE]: repoSnapshot({ jobs, runners }) }, ALL);
  assert.deepEqual(of(actions, 'mint').map((m) => m.jobId), [2]);
  assert.ok(codes(actions).includes('runner-pending'));
});

test('a refused job cancels its run, and its admitted sibling is not minted', () => {
  const text = `${withBuild('    container: node:22')}  lint:\n    runs-on: [self-hosted, commitwork]\n    steps: [{ run: x }]\n`;
  const jobs = [job(1, '2026-10-22T09:01:00Z'), job(2, '2026-10-22T09:01:00Z', { name: 'lint' })];
  const actions = tick({ [PRIVATE]: repoSnapshot({ jobs, text }) }, ALL);
  assert.deepEqual(of(actions, 'cancel'), [{ kind: 'cancel', repo: PRIVATE, runId: 30433642, code: 'needs-container' }]);
  assert.deepEqual(codes(actions), ['needs-container', 'run-refused']);
  assert.equal(of(actions, 'mint').length, 0);
});

test('a refused repository records once and cancels its addressed runs; unmeasured cancels nothing', () => {
  const weak = repoSnapshot({ run: makeRun({ repo: PUBLIC }), meta: fixture('repo-public.json') });
  weak.policy = fixture('fork-approval.json');
  const actions = tick({ [PUBLIC]: weak }, ALL);
  assert.deepEqual(codes(actions), ['repo-approval-weak']);
  assert.deepEqual(of(actions, 'cancel').map((c) => c.code), ['repo-approval-weak']);
  weak.policy = { error: { status: 502, reason: 'Bad Gateway' } };
  const unmeasured = tick({ [PUBLIC]: weak }, ALL);
  assert.deepEqual([codes(unmeasured), of(unmeasured, 'cancel').length], [['repo-unmeasured'], 0]);
});

test('unreadable runs, jobs, runners or workflow wait: recorded, nothing cancelled or minted', () => {
  const err = { error: { status: 502, reason: 'Bad Gateway' } };
  const cases = [
    [{ ...repoSnapshot(), queuedRuns: err }, 'runs-unmeasured'],
    [{ ...repoSnapshot(), queuedRuns: [{ run: makeRun(), jobs: err }] }, 'jobs-unmeasured'],
    [{ ...repoSnapshot(), runners: err }, 'runners-unmeasured'],
    [repoSnapshot({ text: err }), 'workflow-unmeasured'],
  ];
  for (const [snap, code] of cases) {
    const actions = tick({ [PRIVATE]: snap }, ALL);
    assert.deepEqual(kinds(actions), ['record'], code);
    assert.equal(actions[0].decision.code, code);
  }
});

test('a run with no job addressed to this runner produces nothing', () => {
  const snap = repoSnapshot({ jobs: [makeJob({ labels: ['ubuntu-latest'] })] });
  assert.deepEqual(tick({ [PRIVATE]: snap }, ALL), []);
});

test('a declared repo missing from the snapshot is unmeasured, not empty', () => {
  const actions = decide({ config, snapshot: { [PRIVATE]: QUIET }, freeSlots: ALL, now: NOW });
  assert.deepEqual(actions.map((a) => [a.decision.repo, a.decision.code]), [[PUBLIC, 'runs-unmeasured']]);
});

test('order is records, cancels, deletes, mints, and the tick is deterministic', () => {
  const runners = fixture('runners.json').runners;
  const refusedRun = makeRun({ id: 9, event: 'workflow_run' });
  const snap = repoSnapshot({ jobs: [job(1, '2026-10-22T09:01:00Z'), job(2, '2026-10-22T09:02:00Z')], runners });
  snap.queuedRuns.push({ run: refusedRun, jobs: [job(5, '2026-10-22T09:00:00Z', { run_id: 9 })] });
  const input = () => ({ config, snapshot: { [PRIVATE]: structuredClone(snap), [PUBLIC]: QUIET }, freeSlots: ALL, now: NOW });
  const actions = decide(input());
  const rank = { record: 0, cancel: 1, delete: 2, mint: 3 };
  assert.deepEqual(kinds(actions).map((k) => rank[k]), kinds(actions).map((k) => rank[k]).sort());
  assert.deepEqual(new Set(kinds(actions)), new Set(['record', 'cancel', 'delete', 'mint']));
  assert.deepEqual(decide(input()), actions);
  assert.throws(() => decide({ ...input(), now: undefined }), TypeError);
});
