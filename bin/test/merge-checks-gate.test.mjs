// A job may merge a pull request only when every other check on the commit has passed
// (bin/merge-checks-gate.mjs), and the Dependabot merge job in ci.yml asks it before merging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeChecks, readCheckRuns, settle } from '../merge-checks-gate.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'Merge a Dependabot update the policy allows';
const SHA = 'a'.repeat(40);
const run = (name, status, conclusion = null, runId = '7') => ({ name, status, conclusion, details_url: `https://github.com/o/r/actions/runs/${runId}/job/1` });
const own = run(SELF, 'in_progress', null, '99');
const self = { selfName: SELF, selfRunId: '99' };

test('a commit is clear only when every other check passed and at least one succeeded', () => {
  assert.equal(judgeChecks([own, run('tests', 'completed', 'success'), run('docs', 'completed', 'skipped'), run('CodeQL', 'completed', 'neutral')], self).verdict, 'clear');
  const red = judgeChecks([own, run('tests', 'completed', 'success'), run('The action with the fast group\'s scanners installed', 'completed', 'failure')], self);
  assert.equal(red.verdict, 'blocked');
  assert.deepEqual(red.failed, ["The action with the fast group's scanners installed (failure)"]);
  for (const conclusion of ['cancelled', 'timed_out', 'action_required', 'stale', 'startup_failure', null]) {
    assert.equal(judgeChecks([own, run('tests', 'completed', 'success'), run('x', 'completed', conclusion)], self).verdict, 'blocked', String(conclusion));
  }
  assert.equal(judgeChecks([own, run('tests', 'completed', 'success'), run('analyze', 'queued')], self).verdict, 'pending');
  assert.equal(judgeChecks([own, run('analyze', 'in_progress'), run('x', 'completed', 'failure')], self).verdict, 'blocked', 'a failure answers without waiting for the rest');
  assert.equal(judgeChecks([own], self).verdict, 'empty');
  assert.equal(judgeChecks([own, run('docs', 'completed', 'skipped')], self).verdict, 'empty', 'a commit where nothing ran is not a passing commit');
});

test('only the calling job is left out: the same name in another workflow run still counts', () => {
  const elsewhere = run(SELF, 'in_progress', null, '100');
  assert.equal(judgeChecks([own, elsewhere, run('tests', 'completed', 'success')], self).verdict, 'pending');
  assert.equal(judgeChecks([own, run('tests', 'completed', 'success')], {}).verdict, 'pending', 'with no caller named, its own running check holds the merge');
});

test('the check runs are read across pages and a refused read throws', async () => {
  const pages = { 1: Array.from({ length: 100 }, (_, i) => run(`c${i}`, 'completed', 'success')), 2: [run('last', 'completed', 'failure')] };
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    assert.equal(init.headers.authorization, 'Bearer t');
    return { ok: true, json: async () => ({ total_count: 101, check_runs: pages[new URL(url).searchParams.get('page')] }) };
  };
  const runs = await readCheckRuns({ api: 'https://api.example', repo: 'o/r', sha: SHA, token: 't', fetchImpl });
  assert.equal(runs.length, 101);
  assert.deepEqual(seen, [1, 2].map((p) => `https://api.example/repos/o/r/commits/${SHA}/check-runs?per_page=100&page=${p}`));
  await assert.rejects(readCheckRuns({ api: 'https://api.example', repo: 'o/r', sha: SHA, token: 't', fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
  await assert.rejects(readCheckRuns({ api: 'https://api.example', repo: 'o/r', sha: SHA, token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({ message: 'no' }) }) }), /check_runs/);
});

test('a running check is waited for, and the deadline ends the wait as pending', async () => {
  const answers = [[own, run('analyze', 'in_progress')], [own, run('analyze', 'in_progress')], [own, run('analyze', 'completed', 'success')]];
  let clock = 0;
  const slept = [];
  const opts = { self, everySec: 30, sleep: async (ms) => { slept.push(ms); clock += ms; }, now: () => clock, log: () => {} };
  assert.equal((await settle({ ...opts, read: async () => answers.shift(), waitSec: 900 })).verdict, 'clear');
  assert.deepEqual(slept, [30000, 30000]);
  clock = 0;
  const stuck = await settle({ ...opts, read: async () => [own, run('analyze', 'in_progress')], waitSec: 60 });
  assert.equal(stuck.verdict, 'pending');
  assert.deepEqual(stuck.pending, ['analyze (in_progress)']);
});

test('the command exits by verdict, fails closed on a bad read, and writes its verdict for the workflow', async () => {
  let answer = { status: 200, runs: [] };
  const server = createServer((req, res) => {
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ total_count: answer.runs.length, check_runs: answer.runs }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', HEAD_SHA: SHA, GH_TOKEN: 't', GITHUB_RUN_ID: '99', SELF_CHECK_NAME: SELF };
  const gate = (env, args = ['--wait', '0']) => new Promise((done) => {
    const child = spawn(process.execPath, [join(CW, 'bin', 'merge-checks-gate.mjs'), ...args], { cwd: CW, env: { PATH: process.env.PATH, ...base, ...env }, stdio: 'ignore' });
    child.on('close', done);
  });
  try {
    answer = { status: 200, runs: [own, run('tests', 'completed', 'success')] };
    assert.equal(await gate({}), 0);
    answer = { status: 200, runs: [own, run('tests', 'completed', 'success'), run('sast', 'completed', 'failure')] };
    assert.equal(await gate({}), 20);
    answer = { status: 200, runs: [own, run('tests', 'completed', 'success'), run('analyze', 'in_progress')] };
    assert.equal(await gate({}), 21);
    answer = { status: 200, runs: [own] };
    assert.equal(await gate({}), 22);
    answer = { status: 403, runs: [] };
    assert.equal(await gate({}), 23);
    answer = { status: 200, runs: [own, run('tests', 'completed', 'success')] };
    assert.equal(await gate({ HEAD_SHA: 'main' }), 23, 'a ref that is not a full commit id is not looked up');
    assert.equal(await gate({ GITHUB_RUN_ID: '' }), 23);
    assert.equal(await gate({}, ['--wait']), 2);
    assert.equal(await gate({}, ['--nope']), 2);
    const out = join(mkdtempSync(join(tmpdir(), 'cw-checks-')), 'gh-output');
    writeFileSync(out, '');
    assert.equal(await gate({ GITHUB_OUTPUT: out }, ['--wait', '0', '--github-output']), 0);
    answer = { status: 200, runs: [own, run('tests', 'completed', 'success'), run('sast', 'completed', 'failure')] };
    assert.equal(await gate({ GITHUB_OUTPUT: out }, ['--wait', '0', '--github-output']), 0);
    answer = { status: 500, runs: [] };
    assert.equal(await gate({ GITHUB_OUTPUT: out }, ['--wait', '0', '--github-output']), 0);
    assert.equal(readFileSync(out, 'utf8'), 'clear=true\nclear=false\nclear=false\n');
  } finally {
    server.close();
  }
});

test('the Dependabot merge job asks the gate under its own name and merges only the commit it judged', () => {
  const ci = readFileSync(join(CW, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = ci.slice(ci.indexOf('\n  dependabot-merge:'));
  assert.match(job, new RegExp(`\\n    name: ${SELF}\\n`));
  assert.match(job, new RegExp(`\\n          SELF_CHECK_NAME: ${SELF}\\n`));
  assert.match(job, /\n      checks: read\n/);
  assert.match(job, /\n {8}run: node bin\/merge-checks-gate\.mjs --wait \d+ --github-output\n/);
  const merge = job.slice(job.indexOf('\n      - name: Merge\n'));
  assert.match(merge, /\n {8}if: steps\.policy\.outputs\.allowed == 'true' && steps\.checks\.outputs\.clear == 'true'\n/);
  assert.match(merge, /--match-head-commit "\$HEAD_SHA"/);
  assert.match(merge, /\n {10}HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n/);
});
