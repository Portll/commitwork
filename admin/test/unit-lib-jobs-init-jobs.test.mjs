// Restores persisted health runs and returns the live job registries (admin/lib/jobs.mjs initJobs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initJobs } from '../lib/jobs.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeDeps(dir) {
  const store = join(dir, 'sessions.json');
  writeFileSync(store, '{}');
  return {
    CW: {},
    registry: {},
    sessionStorePath: () => store,
    projectSlug: 'test',
    primaryArea: 'main',
  };
}

test('returns empty jobs and running objects when no persisted file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const { jobs, running } = initJobs(deps);
    assert.deepStrictEqual(jobs, {});
    assert.deepStrictEqual(running, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restores a valid health job from persisted file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const healthPath = join(dir, 'health-runs.json');
    const doc = {
      version: 1,
      jobs: {
        'health-all': {
          running: false,
          startedAt: '2024-01-01T00:00:00.000Z',
          finishedAt: '2024-01-01T00:01:00.000Z',
          exitCode: 0,
          phase: 'done',
          done: 10,
          total: 10,
          current: null,
          batchDir: '/tmp/batch',
          seq: 1,
          lines: ['line1', 'line2'],
        },
      },
    };
    writeFileSync(healthPath, JSON.stringify(doc));
    const { jobs } = initJobs(deps);
    assert.ok(jobs['health-all']);
    assert.strictEqual(jobs['health-all'].kind, 'health-all');
    assert.strictEqual(jobs['health-all'].running, false);
    assert.strictEqual(jobs['health-all'].exitCode, 0);
    assert.strictEqual(jobs['health-all'].done, 10);
    assert.strictEqual(jobs['health-all'].total, 10);
    assert.deepStrictEqual(jobs['health-all'].lines, ['line1', 'line2']);
    assert.strictEqual(jobs['health-all'].proc, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks interrupted running jobs with interrupted phase and timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const healthPath = join(dir, 'health-runs.json');
    const doc = {
      version: 1,
      jobs: {
        'health-deadcode': {
          running: true,
          startedAt: '2024-01-01T00:00:00.000Z',
          finishedAt: null,
          exitCode: null,
          phase: 'scanning',
          done: 5,
          total: 100,
          current: 'repo1',
          batchDir: '/tmp/batch',
          seq: 42,
          lines: ['a', 'b', 'c'],
        },
      },
    };
    writeFileSync(healthPath, JSON.stringify(doc));
    const { jobs } = initJobs(deps);
    const j = jobs['health-deadcode'];
    assert.ok(j);
    assert.strictEqual(j.running, false);
    assert.strictEqual(j.phase, 'interrupted');
    assert.ok(j.interruptedAt);
    assert.strictEqual(j.done, 5);
    assert.strictEqual(j.total, 100);
    assert.deepStrictEqual(j.lines, ['a', 'b', 'c']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-health job kinds in persisted file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const healthPath = join(dir, 'health-runs.json');
    const doc = {
      version: 1,
      jobs: {
        'sweep': { running: false, phase: 'done' },
        'health-all': { running: false, phase: 'done' },
      },
    };
    writeFileSync(healthPath, JSON.stringify(doc));
    const { jobs } = initJobs(deps);
    assert.strictEqual(jobs['sweep'], undefined);
    assert.ok(jobs['health-all']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty jobs when persisted file has wrong version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const healthPath = join(dir, 'health-runs.json');
    const doc = { version: 2, jobs: { 'health-all': { running: false } } };
    writeFileSync(healthPath, JSON.stringify(doc));
    const { jobs } = initJobs(deps);
    assert.strictEqual(Object.keys(jobs).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('truncates lines to LOG_CAP of 400 when more are persisted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const healthPath = join(dir, 'health-runs.json');
    const lines = Array.from({ length: 500 }, (_, i) => `line${i}`);
    const doc = {
      version: 1,
      jobs: {
        'health-toolchain': { running: false, phase: 'done', lines },
      },
    };
    writeFileSync(healthPath, JSON.stringify(doc));
    const { jobs } = initJobs(deps);
    const j = jobs['health-toolchain'];
    assert.strictEqual(j.lines.length, 400);
    assert.strictEqual(j.lines[0], 'line100');
    assert.strictEqual(j.lines[399], 'line499');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty jobs when persisted file is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const healthPath = join(dir, 'health-runs.json');
    writeFileSync(healthPath, 'not valid json');
    const { jobs } = initJobs(deps);
    assert.strictEqual(Object.keys(jobs).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses CW_HEALTH_RUNS_STORE env var when set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'initJobs-'));
  try {
    const deps = makeDeps(dir);
    const customPath = join(dir, 'custom-health.json');
    const doc = {
      version: 1,
      jobs: {
        'health-gates': { running: false, phase: 'done', lines: ['x'] },
      },
    };
    writeFileSync(customPath, JSON.stringify(doc));
    const oldEnv = process.env.CW_HEALTH_RUNS_STORE;
    process.env.CW_HEALTH_RUNS_STORE = customPath;
    const { jobs } = initJobs(deps);
    assert.ok(jobs['health-gates']);
    assert.strictEqual(jobs['health-gates'].phase, 'done');
    process.env.CW_HEALTH_RUNS_STORE = oldEnv;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
