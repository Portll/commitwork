// list of remediation jobs with their state and metadata (lib/cobolwork-remediation-jobs.mjs listJobs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listJobs } from '../cobolwork-remediation-jobs.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty result when directory does not exist', () => {
  const dir = join(tmpdir(), 'nonexistent-dir-12345');
  const result = listJobs(dir);
  assert.deepStrictEqual(result, { ok: true, jobs: [] });
});

test('returns error when path exists but is not a directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'listJobs-'));
  const filePath = join(base, 'not-a-dir');
  writeFileSync(filePath, 'content');
  try {
    const result = listJobs(filePath);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.startsWith('job store unreadable:'));
    assert.deepStrictEqual(result.jobs, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns empty jobs array when directory has no job files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listJobs-'));
  try {
    const result = listJobs(dir);
    assert.deepStrictEqual(result, { ok: true, jobs: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps fields correctly and marks running job as orphaned when not active', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listJobs-'));
  try {
    const job = {
      state: 'running',
      repo: 'repoX',
      fingerprint: 'fpX',
      updatedAt: '2023-01-01T00:00:00Z',
      finding: { rule: 'R1', sev: 'high', path: 'src/file.cob', line: 10 },
      final: { verdict: 'pass', outcome: 'fixed', attempt: 1, files: ['a.cob'] },
      attempts: [{}, {}],
      applied: { some: 'value' },
      verifications: [{}, { result: 'ok' }],
      error: null,
      events: Array.from({ length: 20 }, (_, i) => i)
    };
    writeFileSync(join(dir, 'aaaaaaaaaaaaaaaa.json'), JSON.stringify(job));
    const result = listJobs(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.jobs.length, 1);
    const j = result.jobs[0];
    assert.strictEqual(j.id, 'aaaaaaaaaaaaaaaa');
    assert.strictEqual(j.state, 'orphaned');
    assert.strictEqual(j.repo, 'repoX');
    assert.strictEqual(j.fingerprint, 'fpX');
    assert.strictEqual(j.updatedAt, '2023-01-01T00:00:00Z');
    assert.deepStrictEqual(j.finding, { rule: 'R1', sev: 'high', path: 'src/file.cob', line: 10 });
    assert.deepStrictEqual(j.final, { verdict: 'pass', outcome: 'fixed', attempt: 1, files: ['a.cob'] });
    assert.strictEqual(j.attempts, 2);
    assert.deepStrictEqual(j.applied, { some: 'value' });
    assert.deepStrictEqual(j.verified, { result: 'ok' });
    assert.strictEqual(j.error, null);
    assert.deepStrictEqual(j.events, Array.from({ length: 14 }, (_, i) => i + 6));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('keeps running state when job id is present in active set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listJobs-'));
  try {
    const job = {
      state: 'running',
      repo: 'repoY',
      fingerprint: 'fpY',
      updatedAt: '2023-02-01T00:00:00Z',
      attempts: []
    };
    writeFileSync(join(dir, 'bbbbbbbbbbbbbbbb.json'), JSON.stringify(job));
    const result = listJobs(dir, new Set(['bbbbbbbbbbbbbbbb']));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.jobs.length, 1);
    assert.strictEqual(result.jobs[0].state, 'running');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orders jobs by updatedAt descending and handles missing optional fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listJobs-'));
  try {
    const older = {
      state: 'completed',
      repo: 'repoOld',
      fingerprint: 'fpOld',
      updatedAt: '2023-01-01T00:00:00Z',
      attempts: []
    };
    const newer = {
      state: 'completed',
      repo: 'repoNew',
      fingerprint: 'fpNew',
      updatedAt: '2023-03-01T00:00:00Z',
      attempts: []
    };
    writeFileSync(join(dir, 'cccccccccccccccc.json'), JSON.stringify(older));
    writeFileSync(join(dir, 'dddddddddddddddd.json'), JSON.stringify(newer));
    const result = listJobs(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.jobs.length, 2);
    assert.strictEqual(result.jobs[0].id, 'dddddddddddddddd');
    assert.strictEqual(result.jobs[0].updatedAt, '2023-03-01T00:00:00Z');
    assert.strictEqual(result.jobs[1].id, 'cccccccccccccccc');
    assert.strictEqual(result.jobs[1].updatedAt, '2023-01-01T00:00:00Z');
    assert.strictEqual(result.jobs[0].finding, null);
    assert.strictEqual(result.jobs[0].final, null);
    assert.strictEqual(result.jobs[0].applied, null);
    assert.strictEqual(result.jobs[0].verified, null);
    assert.strictEqual(result.jobs[0].error, null);
    assert.deepStrictEqual(result.jobs[0].events, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks job as unreadable when JSON does not parse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listJobs-'));
  try {
    writeFileSync(join(dir, 'eeeeeeeeeeeeeeee.json'), '{ invalid json ');
    const result = listJobs(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.jobs.length, 1);
    const j = result.jobs[0];
    assert.strictEqual(j.id, 'eeeeeeeeeeeeeeee');
    assert.strictEqual(j.state, 'unreadable');
    assert.ok(j.error.startsWith('job file does not parse:'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
