// lib/launchlist-waiver.mjs and the launchlist `workflows` check over fixture repositories, with the
// annotation store pointed at a temporary file through CW_ANNOTATIONS.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitChildEnv } from '../../bin/lib/git-env.mjs';
import { CHECKS } from '../launchlist-checks.mjs';
import {
  RUNNER_CONTROLS, WAIVER_PREFIX, basisGaps, loadScannerAnnotations, selfHostedJobs, waiverFor,
} from '../launchlist-waiver.mjs';

// Inside a hook git exports GIT_DIR, and every `git -C <tmp>` here would act on the hooked repository.
process.env = gitChildEnv();
process.env.CW_NOW = '2026-10-23T00:00:00.000Z';
const NOW = process.env.CW_NOW;
const TMP = mkdtempSync(join(tmpdir(), 'cw-waiver-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const FILE = '.github/workflows/ci.yml';
const BASIS = `${WAIVER_PREFIX} ${RUNNER_CONTROLS.join(' ')}; opted in for the probe`;
const workflow = (on, runsOn = '[self-hosted, commitwork]') =>
  `on: ${on}\npermissions:\n  contents: read\njobs:\n  scan:\n    runs-on: ${runsOn}\n    steps:\n      - run: echo hi\n`;
const accept = (over = {}) => ({
  category: 'actionsGaps', repo: 'probe', rule: 'self-hosted-runner', file: FILE, job: 'scan',
  action: 'accept', reason: BASIS, who: 'operator@example.test',
  at: '2026-10-22T00:00:00.000Z', expires: '2027-04-22T00:00:00.000Z', ...over,
});

let n = 0;
function repoWith(text) {
  const dir = join(TMP, `repo-${++n}`);
  mkdirSync(join(dir, dirname(FILE)), { recursive: true });
  writeFileSync(join(dir, FILE), text);
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  g('-c', 'user.email=t@example.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '-A');
  g('-c', 'user.email=t@example.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture');
  return dir;
}

function storeWith(records) {
  const p = join(TMP, `annotations-${++n}.json`);
  writeFileSync(p, JSON.stringify({ annotations: [], scannerAnnotations: records }));
  return p;
}

async function check(text, records) {
  process.env.CW_ANNOTATIONS = storeWith(records);
  return CHECKS.workflows({ project: 'probe', repo: repoWith(text), cfg: {} });
}

test('a self-hosted commitwork job with a valid accept is a warn row naming date, who and basis', async () => {
  const r = await check(workflow('push'), [accept()]);
  assert.equal(r.status, 'warn');
  assert.match(r.summary, /1 self-hosted job\(s\) waived/);
  assert.deepEqual(r.evidence, [`${FILE}: self-hosted runner, job scan waived: accepted 2026-10-22 by operator@example.test: ${BASIS}`]);
});

test('no annotation leaves the self-hosted job a hard fail', async () => {
  const r = await check(workflow('push'), []);
  assert.equal(r.status, 'fail');
  assert.match(r.evidence[0], /job scan \(no accept annotation in force/);
});

test('an accept on a different finding, job or repository does not waive', async () => {
  for (const other of [{ rule: 'permissions-absent' }, { job: 'build' }, { file: '.github/workflows/other.yml' }, { repo: 'another' }]) {
    const r = await check(workflow('push'), [accept(other)]);
    assert.equal(r.status, 'fail', JSON.stringify(other));
  }
});

test('a basis without the prefix is refused, even naming every control', async () => {
  const r = await check(workflow('push'), [accept({ reason: RUNNER_CONTROLS.join(' ') })]);
  assert.equal(r.status, 'fail');
  assert.match(r.evidence[0], /basis does not start with 'commitwork-runner:'/);
});

test('pull_request_target fails whatever the annotations say', async () => {
  const r = await check(workflow('pull_request_target'), [accept()]);
  assert.equal(r.status, 'fail');
  assert.ok(r.evidence.includes(`${FILE}: pull_request_target`));
});

test('a self-hosted job whose runs-on does not name commitwork is not waivable', async () => {
  for (const runsOn of ['self-hosted', '[self-hosted, lmstudio]', '${{ matrix.r }}\n    strategy:\n      matrix:\n        r: [self-hosted, commitwork]']) {
    const r = await check(workflow('push', runsOn), [accept()]);
    assert.equal(r.status, 'fail', runsOn);
    assert.match(r.evidence[0], /does not name commitwork literally/);
  }
});

test('a label list on its own lines, which the raw rule misses, fails unwaived and is waivable', async () => {
  const text = workflow('push', '\n      - self-hosted\n      - commitwork');
  assert.equal((await check(text, [])).status, 'fail');
  assert.equal((await check(text, [accept()])).status, 'warn');
});

test('a raw-rule hit with no parsed self-hosted job stays hard', async () => {
  const r = await check(`${workflow('push', 'ubuntu-latest')}# runs-on: self-hosted\n`, [accept()]);
  assert.equal(r.status, 'fail');
  assert.match(r.evidence[0], /no job names the label/);
});

test('basisGaps names each control the basis leaves out', () => {
  assert.equal(basisGaps(BASIS), '');
  assert.equal(basisGaps(`${WAIVER_PREFIX} no-docker-socket, slot-network.`), 'basis does not name jit-only, one-job-per-slot, admission, job-started-hook');
  assert.match(basisGaps(''), /does not start with/);
});

test('waiverFor refuses fleet scope, an expired or future accept, and another action', () => {
  const id = { repo: 'probe', file: FILE, job: 'scan' };
  const fleet = accept({ scope: 'fleet' });
  delete fleet.repo;
  assert.match(waiverFor([fleet], id, NOW).why, /fleet-scoped/);
  assert.equal(waiverFor([accept({ expires: '2026-10-22T12:00:00.000Z' })], id, NOW).waived, false);
  assert.equal(waiverFor([accept({ at: '2026-10-24T00:00:00.000Z' })], id, NOW).waived, false);
  assert.equal(waiverFor([accept({ action: 'wont-fix' })], id, NOW).waived, false);
  assert.equal(waiverFor([accept({ who: '' })], id, NOW).waived, false);
});

test('a refused accept does not hide a later valid one', () => {
  const v = waiverFor([accept({ reason: 'opted in' }), accept()], { repo: 'probe', file: FILE, job: 'scan' }, NOW);
  assert.equal(v.waived, true);
});

test('an unreadable store fails closed; an absent one is empty', async () => {
  const bad = join(TMP, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.ok(loadScannerAnnotations(bad).error);
  for (const shape of ['[]', 'null', '{"scannerAnnotations":{}}']) {
    writeFileSync(join(TMP, 'shape.json'), shape);
    assert.ok(loadScannerAnnotations(join(TMP, 'shape.json')).error, shape);
  }
  assert.deepEqual(loadScannerAnnotations(join(TMP, 'absent.json')), { records: [] });
  process.env.CW_ANNOTATIONS = bad;
  const r = await CHECKS.workflows({ project: 'probe', repo: repoWith(workflow('push')), cfg: {} });
  assert.equal(r.status, 'fail');
  assert.match(r.evidence[0], /annotation store unreadable/);
});

test('selfHostedJobs uses actions-gaps identity: one entry per job, null when the file does not parse', () => {
  assert.deepEqual(selfHostedJobs(FILE, workflow('push')), [{ job: 'scan', commitwork: true }]);
  assert.equal(selfHostedJobs(FILE, 'jobs:\n  a:\n    b: 1\n   c: 2\n'), null);
});
