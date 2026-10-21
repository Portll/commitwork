// bin/actions-gaps.mjs over fixtures in a temp dir, reached through CW_ACTIONS_GAPS_ROOT.
// Both directions per rule: the dirty tree must fire exactly where planted, the clean look-alikes
// must not, and no script body may reach the report.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  scanActionsGaps, scanWorkflow, parseYaml, selfHostedForm, triggerNames, stepPullsTriggeringHead, RULE_CWE, RULE_SEV,
} from '../actions-gaps.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'actions-gaps.mjs');
const WF = '.github/workflows';

function tree(files) {
  const d = mkdtempSync(join(tmpdir(), 'cw-actgaps-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), body);
  }
  return d;
}

function run(root, extraEnv = {}, argv = []) {
  const env = { ...process.env, ...extraEnv };
  if (root !== undefined) env.CW_ACTIONS_GAPS_ROOT = root; else delete env.CW_ACTIONS_GAPS_ROOT;
  const r = spawnSync(process.execPath, [BIN, ...argv], { encoding: 'utf8', env });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* asserted by callers */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const SECRET_LINE = 'echo canary-script-body-must-not-travel';

const DIRTY = {
  [`${WF}/gaps.yml`]: `name: gaps
on:
  workflow_run:
    workflows: ["ci"]
    types: [completed]
  pull_request_target:
jobs:
  build:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.workflow_run.head_sha }}
      - run: ${SECRET_LINE}
  labelled:
    runs-on: [self-hosted, linux, x64]
    permissions:
      contents: read
    steps:
      - name: Fetch PR head
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: actions/download-artifact@v4
        with:
          run-id: \${{ github.event.workflow_run.id }}
  grouped:
    runs-on:
      group: my-runners
      labels: [self-hosted]
    steps:
      - run: |
          gh run download \${{ github.event.workflow_run.id }}
          ${SECRET_LINE}
  matrixed:
    strategy:
      matrix:
        os: [ubuntu-latest, self-hosted]
    runs-on: \${{ matrix.os }}
    steps:
      - run: true
  reusable:
    uses: ./.github/workflows/other.yml
`,
  [`${WF}/jobperm.yml`]: `name: jobperm
on: push
jobs:
  a:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - run: make | tee build.log
  b:
    runs-on:
      group: hosted-larger
    steps:
      - run: make
`,
  [`${WF}/broken.yml`]: 'name: broken\non: push\njobs:\n  x:\n      runs-on: ubuntu-latest\n   steps: []\n',
  [`${WF}/notes.txt`]: 'not a workflow\n',
};

const CLEAN = {
  [`${WF}/ci.yml`]: `name: ci
on: [push, pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - run: npm test
`,
  [`${WF}/label.yml`]: `name: label
on:
  pull_request_target:
    types: [opened]
jobs:
  label:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: actions/labeler@8558fd74291d67161a8a78ce36a881fa63b766a9
  comment:
    runs-on: \${{ matrix.os }}
    permissions: {}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - run: echo "self-hosted is mentioned in a script, which is not a runner label"
  dynamic:
    runs-on:
      group: larger-runners
      labels: [ubuntu-22.04-8core]
    permissions: {}
    steps:
      - run: true
`,
  [`${WF}/after.yml`]: `name: after
on:
  workflow_run:
    workflows: [ci]
    types: [completed]
permissions: {}
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - run: echo "\${{ github.event.workflow_run.conclusion }}"
`,
};

describe('the dirty tree fires every rule, exactly where planted', () => {
  const root = tree(DIRTY);
  const r = run(root);

  test('exit 0 and a well-formed rule-counts report; a broken file is declared, not skipped', () => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.tool, 'actions-gaps');
    assert.equal(r.json.summary.void, false);
    assert.equal(r.json.summary.filesScanned, 2);
    assert.equal(r.json.summary.filesExamined, 3, 'the .txt is not a workflow; broken.yml is examined and counted');
    assert.equal(r.json.summary.unparseable, 1);
    assert.equal(r.json.summary.unparseableFiles[0].path, `${WF}/broken.yml`);
    assert.equal(r.json.summary.jobsScanned, 7);
    assert.equal(r.json.summary.privilegedTriggerWorkflows, 1);
  });

  test('every rule in RULE_CWE fires at least once — no rule is left unexercised', () => {
    for (const rule of Object.keys(RULE_CWE)) assert.ok(r.json.summary.byRule[rule] > 0, `${rule} never fired on the dirty tree`);
    for (const f of r.json.findings) { assert.equal(f.sev, RULE_SEV[f.rule]); assert.equal(f.cwe, RULE_CWE[f.rule]); }
  });

  test('self-hosted-runner: the scalar, the list, the labels map and the matrix — and a plain runner group does not count', () => {
    const rows = r.json.findings.filter((f) => f.rule === 'self-hosted-runner');
    assert.deepEqual(rows.map((f) => [f.job, f.detail]), [
      ['build', 'runs-on names the self-hosted label (scalar)'],
      ['grouped', 'runs-on names the self-hosted label (labels)'],
      ['labelled', 'runs-on names the self-hosted label (list)'],
      ['matrixed', 'runs-on names the self-hosted label (matrix)'],
    ]);
    assert.equal(r.json.summary.runnerGroups, 1, 'jobperm.yml job b uses a runner group with no self-hosted label: counted, never published');
    assert.equal(r.json.summary.runsOnDynamic, 0, 'the matrix expression resolved to a label, so it is not an unknown');
  });

  test('workflow-run-trigger: one finding per job, naming the first step and counting the rest', () => {
    const rows = r.json.findings.filter((f) => f.rule === 'workflow-run-trigger');
    assert.deepEqual(rows.map((f) => [f.job, f.step]), [['build', 'step 1'], ['grouped', 'step 1'], ['labelled', 'Fetch PR head']]);
    assert.match(rows[0].detail, /^on pull_request_target \+ workflow_run: checks out the triggering head$/);
    assert.match(rows[1].detail, /fetches the triggering head in a run step/);
    assert.match(rows[2].detail, /checks out the triggering head; 1 more step\(s\) do the same/);
    assert.ok(!rows.some((f) => f.job === 'matrixed' || f.job === 'reusable'), 'jobs that never pull the triggering head stay quiet');
  });

  test('permissions-absent: every job with no block on it or above it, including a reusable call; a job with its own block is quiet', () => {
    const rows = r.json.findings.filter((f) => f.rule === 'permissions-absent');
    assert.deepEqual(rows.map((f) => `${f.path.replace(`${WF}/`, '')} ${f.job}`),
      ['gaps.yml build', 'gaps.yml grouped', 'gaps.yml matrixed', 'gaps.yml reusable', 'jobperm.yml b']);
    assert.match(rows.find((f) => f.job === 'reusable').detail, /^a reusable-workflow call /);
  });

  test('NO BODY LEAKS: a run script never reaches the report; only rule ids, paths, job and step names', () => {
    assert.ok(!r.stdout.includes(SECRET_LINE), 'a run: body reached the report');
    assert.ok(!r.stdout.includes('gh run download'), 'a run: body reached the report');
    assert.ok(!r.stdout.includes('actions/checkout@v4'), 'a uses: reference reached the report');
    assert.ok(!r.stdout.includes('head_sha'), 'an expression reached the report');
  });

  test('findings sort by (path, rule, job) and the report is byte-identical across runs', () => {
    const keys = r.json.findings.map((f) => `${f.path}\u0000${f.rule}\u0000${f.job}`);
    assert.deepEqual(keys, [...keys].sort());
    assert.equal(run(root).stdout, r.stdout);
  });

  test('line is display only: every finding carries one, but no identity rests on it', () => {
    for (const f of r.json.findings) assert.ok(Number.isInteger(f.line) && f.line > 0, `${f.rule} ${f.job} has no line`);
  });
});

describe('the clean look-alikes stay quiet', () => {
  const root = tree(CLEAN);
  const r = run(root);

  test('three workflows, five jobs, zero findings — with every surface present to be quiet about', () => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.summary.filesScanned, 3);
    assert.equal(r.json.summary.jobsScanned, 5);
    assert.equal(r.json.summary.privilegedTriggerWorkflows, 2, 'pull_request_target and workflow_run are both present, used safely');
    assert.equal(r.json.summary.runsOnDynamic, 0, 'a matrix that resolves to hosted labels is not unknown');
    assert.equal(r.json.summary.runnerGroups, 1);
    assert.deepEqual(r.json.findings, []);
  });

  test('a matrix expression that cannot be resolved is counted as dynamic, never published as self-hosted', () => {
    const d = tree({ [`${WF}/w.yml`]: 'on: push\npermissions: {}\njobs:\n  j:\n    runs-on: ${{ inputs.runner }}\n    steps:\n      - run: true\n' });
    const x = run(d);
    assert.deepEqual(x.json.findings, []);
    assert.equal(x.json.summary.runsOnDynamic, 1);
  });
});

describe('voids and failures are declared, never clean', () => {
  test('no .github/workflows directory is a void with a reason', () => {
    const r = run(tree({ 'README.md': 'hi\n' }));
    assert.equal(r.status, 0);
    assert.equal(r.json.summary.void, true);
    assert.equal(r.json.summary.workflowsDir, false);
    assert.match(r.json.summary.voidReason, /no \.github\/workflows directory/);
  });

  test('a workflows directory holding only unparseable yaml is a void, not zero findings on a clean tree', () => {
    const r = run(tree({ [`${WF}/w.yml`]: 'jobs:\n  a:\n    b: 1\n  c\n' }));
    assert.equal(r.json.summary.void, true);
    assert.equal(r.json.summary.unparseable, 1);
    assert.match(r.json.summary.voidReason, /none could be read/);
  });

  test('a workflows directory holding no yaml at all is a void', () => {
    const r = run(tree({ [`${WF}/README.md`]: 'hi\n' }));
    assert.equal(r.json.summary.void, true);
    assert.match(r.json.summary.voidReason, /holds no yaml/);
  });

  test('a root that is not a directory exits 2', () => {
    const d = tree({ 'file.txt': 'x' });
    const r = run(join(d, 'file.txt'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not a directory/);
  });

  test('an unreadable workflow is counted as unreadable, not passed over', (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('root reads everything');
    const d = tree({ [`${WF}/w.yml`]: 'on: push\njobs: {}\n', [`${WF}/locked.yml`]: 'on: push\njobs: {}\n' });
    chmodSync(join(d, WF, 'locked.yml'), 0o000);
    const r = run(d);
    chmodSync(join(d, WF, 'locked.yml'), 0o644);
    assert.equal(r.json.summary.unreadable, 1);
    assert.equal(r.json.summary.unreadableFiles[0].code, 'EACCES');
    assert.equal(r.json.summary.filesScanned, 1);
  });

  test('the env override wins over argv, and is read at call time', () => {
    const a = tree({ [`${WF}/w.yml`]: 'on: push\njobs:\n  j:\n    runs-on: self-hosted\n    steps: []\n' });
    const b = tree({});
    const r = run(a, {}, [b]);
    assert.equal(r.json.summary.findings, 2);
  });
});

describe('the yaml reader and the rule helpers', () => {
  test('block scalars, flow collections, quoted keys and comments parse; a run body keeps its lines', () => {
    const doc = parseYaml('"on": { push: { branches: [main] } } # trailing\njobs:\n  j:\n    runs-on: [a, "b c"]\n    steps:\n    - run: |\n        line one # not a comment\n\n        line three\n      env: {A: 1}\n    - name: x\n');
    const j = doc.entries.get('jobs').entries.get('j');
    assert.deepEqual(triggerNames(doc.entries.get('on')), ['push']);
    assert.deepEqual(j.entries.get('runs-on').items.map((n) => n.value), ['a', 'b c']);
    const steps = j.entries.get('steps').items;
    assert.equal(steps[0].entries.get('run').value, '        line one # not a comment\n\n        line three');
    assert.equal(steps[0].entries.get('env').entries.get('A').value, '1');
    assert.equal(steps[1].entries.get('name').value, 'x');
    assert.equal(steps[1].line, 11);
  });

  test('a misaligned document throws rather than yielding a partial tree', () => {
    assert.throws(() => parseYaml('jobs:\n    a: 1\n  b: 2\n'), /line 3/);
  });

  test('selfHostedForm and triggerNames cover every shape', () => {
    const wf = (y) => parseYaml(y);
    assert.equal(selfHostedForm(wf('r: Self-Hosted').entries.get('r')), 'scalar');
    assert.equal(selfHostedForm(wf('r: ubuntu-latest').entries.get('r')), '');
    assert.equal(selfHostedForm(wf('r: [linux, self-hosted]').entries.get('r')), 'list');
    assert.equal(selfHostedForm(wf('r:\n  labels: self-hosted').entries.get('r')), 'labels');
    assert.equal(selfHostedForm(wf('r:\n  group: g').entries.get('r')), '');
    assert.equal(selfHostedForm(wf('r: ${{ matrix.os }}').entries.get('r'), wf('matrix:\n  os: [self-hosted]')), 'matrix');
    assert.deepEqual(triggerNames(wf('on: push').entries.get('on')), ['push']);
    assert.deepEqual(triggerNames(wf('on:\n  - push\n  - workflow_run').entries.get('on')), ['push', 'workflow_run']);
    assert.deepEqual(triggerNames(undefined), []);
  });

  test('stepPullsTriggeringHead: checkout by ref or repository, artifact download by run id, a run step — and the safe shapes', () => {
    const step = (y) => parseYaml(y);
    assert.equal(stepPullsTriggeringHead(step('uses: actions/checkout@v4\nwith:\n  ref: ${{ github.head_ref }}')), 'checks out the triggering head');
    assert.equal(stepPullsTriggeringHead(step('uses: actions/checkout@v4\nwith:\n  repository: ${{ github.event.pull_request.head.repo.full_name }}')), 'checks out the triggering head');
    assert.equal(stepPullsTriggeringHead(step('uses: actions/checkout@v4\nwith:\n  ref: refs/pull/${{ github.event.pull_request.number }}/merge')), 'checks out the triggering head');
    assert.equal(stepPullsTriggeringHead(step('uses: dawidd6/action-download-artifact@v6\nwith:\n  run_id: ${{ github.event.workflow_run.id }}')), 'downloads the triggering run\'s artifacts');
    assert.equal(stepPullsTriggeringHead(step('run: gh pr checkout ${{ github.event.pull_request.number }}')), 'fetches the triggering head in a run step');
    assert.equal(stepPullsTriggeringHead(step('uses: actions/checkout@v4')), '', 'checkout of the base is the safe pattern');
    assert.equal(stepPullsTriggeringHead(step('uses: actions/checkout@v4\nwith:\n  ref: ${{ github.event.workflow_run.head_branch }}')), 'checks out the triggering head');
    assert.equal(stepPullsTriggeringHead(step('run: echo ${{ github.event.workflow_run.head_sha }}')), '', 'echoing a sha is not fetching it');
    assert.equal(stepPullsTriggeringHead(step('uses: actions/download-artifact@v4\nwith:\n  name: build')), '', 'downloading this run\'s own artifact is not the triggering run\'s');
  });

  test('scanWorkflow with no jobs mapping reports nothing and no jobs', () => {
    const r = scanWorkflow('w.yml', parseYaml('on: push\n'));
    assert.deepEqual(r.findings, []);
    assert.equal(r.counters.jobs, 0);
  });

  test('scanActionsGaps is the same function the CLI runs', () => {
    const d = tree({ [`${WF}/w.yml`]: 'on: workflow_run\npermissions: {}\njobs:\n  j:\n    runs-on: self-hosted\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.workflow_run.head_sha }}\n' });
    const r = scanActionsGaps(d);
    assert.deepEqual(Object.keys(r.summary.byRule).sort(), ['self-hosted-runner', 'workflow-run-trigger']);
  });
});

test('a workflow under .claude/worktrees/<name>/.github/workflows is neither scanned nor named', () => {
  const clean = 'name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: true\n';
  const plant = 'on: push\njobs:\n  j:\n    runs-on: self-hosted\n    steps:\n      - run: true\n';
  const d = tree({ [`${WF}/ci.yml`]: clean, [`.claude/worktrees/agent-x/${WF}/ci.yml`]: plant });
  const r = scanActionsGaps(d);
  assert.equal(r.summary.filesScanned, 1);
  assert.equal(r.summary.findings, 0, JSON.stringify(r.findings));
});
