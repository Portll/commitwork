// Scans .github/workflows for self-hosted runners, privileged triggers, missing permissions, and masked pipelines (bin/actions-gaps.mjs scanActionsGaps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanActionsGaps } from '../actions-gaps.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fresh = () => mkdtempSync(join(tmpdir(), 'scanActionsGaps-'));
const setup = (dir, files) => {
  const wf = join(dir, '.github', 'workflows');
  mkdirSync(wf, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(wf, name), content);
  return wf;
};

test('returns void when no workflows directory exists', () => {
  const dir = fresh();
  try {
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.workflowsDir, false);
    assert.equal(r.summary.void, true);
    assert.equal(r.summary.voidReason, 'no .github/workflows directory in this tree \u2014 a stated void, not a clean tree');
    assert.equal(r.summary.findings, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns void when workflows directory has no yaml files', () => {
  const dir = fresh();
  try {
    setup(dir, {});
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.workflowsDir, true);
    assert.equal(r.summary.void, true);
    assert.equal(r.summary.voidReason, '.github/workflows holds no yaml \u2014 a stated void, not a clean tree');
    assert.equal(r.summary.filesScanned, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports self-hosted runner and missing permissions for a simple workflow', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'ci.yml': 'on: push\njobs:\n  build:\n    runs-on: self-hosted\n    steps:\n      - run: echo hi\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.filesScanned, 1);
    assert.equal(r.summary.void, false);
    assert.equal(r.summary.findings, 2);
    assert.equal(r.summary.byRule['self-hosted-runner'], 1);
    assert.equal(r.summary.byRule['permissions-absent'], 1);
    assert.equal(r.summary.jobsScanned, 1);
    assert.equal(r.summary.privilegedTriggerWorkflows, 0);
    assert.equal(r.summary.runnerGroups, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('counts a job whose runs-on names a runner group without a self-hosted label', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'group.yml': 'on: push\njobs:\n  build:\n    runs-on:\n      group: build-runners\n    permissions: read-all\n    steps:\n      - run: echo hi\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.filesScanned, 1);
    assert.equal(r.summary.jobsScanned, 1);
    assert.equal(r.summary.runnerGroups, 1);
    assert.equal(r.summary.findings, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports workflow-run-trigger when privileged trigger checks out triggering head', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'pr.yml': 'on: pull_request_target\njobs:\n  check:\n    runs-on: ubuntu-latest\n    permissions: read-all\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.workflow_run.head_sha }}\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.privilegedTriggerWorkflows, 1);
    assert.equal(r.summary.byRule['workflow-run-trigger'], 1);
    assert.equal(r.summary.byRule['permissions-absent'], undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports exit-masked-by-pipe for pipeline into grep without pipefail', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'pipe.yml': 'on: push\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    permissions: read-all\n    steps:\n      - run: make lint | grep error\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.byRule['exit-masked-by-pipe'], 1);
    assert.equal(r.summary.byRule['permissions-absent'], undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('does not report exit-masked-by-pipe when pipefail is set', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'pipe.yml': 'on: push\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    permissions: read-all\n    steps:\n      - run: set -o pipefail; make lint | grep error\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.byRule['exit-masked-by-pipe'], undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('does not report exit-masked-by-pipe on windows runners', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'pipe.yml': 'on: push\njobs:\n  lint:\n    runs-on: windows-latest\n    permissions: read-all\n    steps:\n      - run: make lint | grep error\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.byRule['exit-masked-by-pipe'], undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports unparseable file when yaml is invalid', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'bad.yml': 'on: push\n  bad_indent: true\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.unparseable, 1);
    assert.equal(r.summary.filesScanned, 0);
    assert.equal(r.summary.void, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('skips files over 1 MiB', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'big.yml': 'x'.repeat(1024 * 1024 + 1)
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.skipped, 1);
    assert.equal(r.summary.filesScanned, 0);
    assert.equal(r.summary.void, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('aggregates counters across multiple workflow files', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'a.yml': 'on: push\njobs:\n  j1:\n    runs-on: self-hosted\n    permissions: read-all\n    steps:\n      - run: echo a\n  j2:\n    runs-on: ubuntu-latest\n    permissions: read-all\n    steps:\n      - run: echo b\n',
      'b.yml': 'on: pull_request_target\njobs:\n  j3:\n    runs-on: ubuntu-latest\n    permissions: read-all\n    steps:\n      - run: echo c\n'
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.filesScanned, 2);
    assert.equal(r.summary.jobsScanned, 3);
    assert.equal(r.summary.privilegedTriggerWorkflows, 1);
    assert.equal(r.summary.byRule['self-hosted-runner'], 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports an unreadable file with the ENOENT code when stat fails on a dangling symlink', { skip: process.platform === 'win32' ? 'creating a symlink on Windows needs Developer Mode or elevated rights' : false }, (t) => {
  const dir = fresh();
  try {
    const wf = setup(dir, {});
    const target = join(dir, 'target.yml');
    writeFileSync(target, 'on: push\n');
    try { symlinkSync(target, join(wf, 'broken.yml')); } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'ENOSYS') throw e;
      t.skip(`symlinkSync failed with ${e.code}: this user or filesystem cannot create a symlink`);
      return;
    }
    rmSync(target);
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.unreadable, 1);
    assert.equal(r.summary.unreadableFiles[0].path, '.github/workflows/broken.yml');
    assert.equal(r.summary.unreadableFiles[0].code, 'ENOENT');
    assert.equal(r.summary.filesScanned, 0);
    assert.equal(r.summary.void, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reports an unreadable file with the EACCES code when stat succeeds but the read is refused', (t) => {
  const dir = fresh();
  try {
    const wf = setup(dir, {
      'locked.yml': 'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    permissions: read-all\n    steps:\n      - run: echo hi\n'
    });
    const p = join(wf, 'locked.yml');
    chmodSync(p, 0o000);
    let probe = 'no error';
    try { readFileSync(p); } catch (e) { probe = e.code; }
    if (probe !== 'EACCES') {
      t.skip(`reading a mode 000 file gave ${probe}, not EACCES: this user reads every file, or the platform ignores the mode`);
      return;
    }
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.unreadable, 1);
    assert.deepEqual(r.summary.unreadableFiles, [{ path: '.github/workflows/locked.yml', code: 'EACCES' }]);
    assert.equal(r.summary.filesScanned, 0);
    assert.equal(r.summary.void, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reads a file of exactly 1 MiB instead of skipping it, and reports it unparseable', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'exact.yml': 'x'.repeat(1024 * 1024)
    });
    const r = scanActionsGaps(dir);
    assert.equal(r.summary.skipped, 0);
    assert.equal(r.summary.filesScanned, 0);
    assert.equal(r.summary.unparseable, 1);
    assert.equal(r.summary.void, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sorts findings by path, rule, and job', () => {
  const dir = fresh();
  try {
    setup(dir, {
      'b.yml': 'on: push\njobs:\n  z:\n    runs-on: self-hosted\n    permissions: read-all\n    steps:\n      - run: echo z\n  a:\n    runs-on: self-hosted\n    permissions: read-all\n    steps:\n      - run: echo a\n',
      'a.yml': 'on: push\njobs:\n  m:\n    runs-on: self-hosted\n    permissions: read-all\n    steps:\n      - run: echo m\n'
    });
    const r = scanActionsGaps(dir);
    const paths = r.findings.map(f => f.path);
    const jobs = r.findings.map(f => f.job);
    assert.deepEqual(paths, ['.github/workflows/a.yml', '.github/workflows/b.yml', '.github/workflows/b.yml']);
    assert.deepEqual(jobs, ['m', 'a', 'z']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
