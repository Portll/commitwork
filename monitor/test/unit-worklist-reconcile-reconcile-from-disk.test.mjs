// Reconciles a program worklist against on-disk rollup, roster and git sources (monitor/worklist-reconcile.mjs reconcileFromDisk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFromDisk } from '../worklist-reconcile.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEYS = ['CW_WORKLIST_PROJECT', 'CW_MODMAP', 'CW_WORKLIST_REPO'];
const ISO = '2026-01-01T00:00:00Z';
const counts = (unverifiable) => ({ agree: 0, mismatch: 0, unverifiable });

function inTemp(body) {
  const dir = mkdtempSync(join(tmpdir(), 'reconcileFromDisk-'));
  const saved = KEYS.map((k) => process.env[k]);
  for (const k of KEYS) delete process.env[k];
  try {
    body(dir);
  } finally {
    KEYS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir, name, value) {
  const p = join(dir, name);
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
}

const emptyList = (dir) => put(dir, 'worklist.json', { programs: [] });

test('marks prose-only and resolver-less items unverifiable and echoes nowIso and the rollup', () => {
  inTemp((dir) => {
    const worklistPath = put(dir, 'worklist.json', { programs: [
      { key: 'cve-2026-10532', items: [{ id: 'p1', status: 'open' }] },
      { key: 'zz-unknown', items: [{ id: 'u1', status: 'done' }, { id: 'u2', status: 'open' }] },
      { key: 'zz-empty' },
    ] });
    put(dir, 'rollup.json', { repos: [{ name: 'alpha' }] });
    const item = (id, authoredStatus, source) => ({ id, authoredStatus, derivedStatus: null, verdict: 'unverifiable', source });
    const none = 'no machine source resolved this item';
    const result = reconcileFromDisk({ outDir: dir, worklistPath, nowIso: ISO });
    assert.deepEqual(result.programs, [
      { key: 'cve-2026-10532', items: [item('p1', 'open', 'prose-only program (no machine anchor)')] },
      { key: 'zz-unknown', items: [item('u1', 'done', none), item('u2', 'open', none)] },
      { key: 'zz-empty', items: [] },
    ]);
    assert.deepEqual(result.summary, {
      agree: 0, mismatch: 0, unverifiable: 3,
      byProgram: { 'cve-2026-10532': counts(1), 'zz-unknown': counts(2), 'zz-empty': counts(0) },
    });
    assert.equal(result.generated, ISO);
    assert.equal(result.sources.rollup, true);
  });
});

test('returns no programs, zero counts and null generated for a worklist without programs and no nowIso', () => {
  inTemp((dir) => {
    const worklistPath = put(dir, 'worklist.json', {});
    const result = reconcileFromDisk({ worklistPath });
    assert.deepEqual(result.programs, []);
    assert.deepEqual(result.summary, { agree: 0, mismatch: 0, unverifiable: 0, byProgram: {} });
    assert.equal(result.generated, null);
    assert.equal(result.sources.rollup, false);
    assert.equal(result.sources.migrationRoster, 0);
    assert.equal(result.sources.teamAGit, false);
  });
});

test('throws ENOENT naming the given worklist path when that file is missing', () => {
  inTemp((dir) => {
    const worklistPath = join(dir, 'missing.json');
    assert.throws(() => reconcileFromDisk({ worklistPath }), {
      name: 'Error', code: 'ENOENT', message: `ENOENT: no such file or directory, open '${worklistPath}'`,
    });
  });
});

test('treats an unparseable rollup.json in outDir as no rollup', () => {
  inTemp((dir) => {
    const worklistPath = emptyList(dir);
    put(dir, 'rollup.json', 'not json');
    const result = reconcileFromDisk({ outDir: dir, worklistPath, nowIso: ISO });
    assert.equal(result.sources.rollup, false);
    assert.equal(result.generated, ISO);
  });
});

test('counts the roster entries of the CW_MODMAP migration-state document', () => {
  inTemp((dir) => {
    const worklistPath = emptyList(dir);
    process.env.CW_MODMAP = put(dir, 'ms.json', { roster: Array.from({ length: 2 }, (_, i) => ({ name: `svc${i}` })) });
    const result = reconcileFromDisk({ worklistPath });
    assert.equal(result.sources.migrationRoster, 2);
  });
});

test('counts a zero roster when the CW_MODMAP document has no roster field', () => {
  inTemp((dir) => {
    const worklistPath = emptyList(dir);
    process.env.CW_MODMAP = put(dir, 'ms.json', {});
    const result = reconcileFromDisk({ worklistPath });
    assert.equal(result.sources.migrationRoster, 0);
  });
});

test('reads map/data/<CW_WORKLIST_PROJECT>/migration-state.json when CW_MODMAP is unset', () => {
  inTemp((dir) => {
    const worklistPath = emptyList(dir);
    put(dir, 'migration-state.json', { roster: Array.from({ length: 3 }, (_, i) => ({ name: `svc${i}` })) });
    process.env.CW_WORKLIST_PROJECT = relative(join(ROOT, 'map', 'data'), dir);
    const result = reconcileFromDisk({ worklistPath });
    assert.equal(result.sources.migrationRoster, 3);
  });
});

test('reports a programme repo when CW_WORKLIST_REPO holds a .git directory', () => {
  inTemp((dir) => {
    const worklistPath = emptyList(dir);
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    process.env.CW_WORKLIST_REPO = repo;
    const result = reconcileFromDisk({ worklistPath });
    assert.equal(result.sources.teamAGit, true);
  });
});

test('reports no programme repo when CW_WORKLIST_REPO has no .git directory', () => {
  inTemp((dir) => {
    const worklistPath = emptyList(dir);
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    process.env.CW_WORKLIST_REPO = repo;
    const result = reconcileFromDisk({ worklistPath });
    assert.equal(result.sources.teamAGit, false);
  });
});

test('does not treat the CW_WORKLIST_PROJECT value itself as the programme repo directory', () => {
  inTemp((dir) => {
    const worklistPath = emptyList(dir);
    const proj = join(dir, 'proj');
    mkdirSync(join(proj, '.git'), { recursive: true });
    process.env.CW_WORKLIST_PROJECT = proj;
    const result = reconcileFromDisk({ worklistPath });
    assert.equal(result.sources.teamAGit, false);
    assert.equal(result.sources.migrationRoster, 0);
  });
});
