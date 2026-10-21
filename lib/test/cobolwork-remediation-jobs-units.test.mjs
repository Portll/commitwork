// lib/test/cobolwork-remediation-jobs-units.test.mjs — case tests for listJobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listJobs } from '../cobolwork-remediation-jobs.mjs';

test('listJobs returns empty jobs array for a non-existent directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    assert.deepEqual(listJobs(join(root, 'absent')), { ok: true, jobs: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('listJobs returns ok:true with empty jobs for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const result = listJobs(dir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.jobs, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listJobs filters out files that do not match the 16-hex-id.json pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    writeFileSync(join(dir, 'not-a-job.json'), '{}');
    writeFileSync(join(dir, 'abc.json'), '{}');
    writeFileSync(join(dir, 'a1b2c3d4e5f6a7b8.json'), JSON.stringify({ id: 'a1b2c3d4e5f6a7b8', state: 'queued' }));
    const result = listJobs(dir);
    assert.equal(result.ok, true);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].id, 'a1b2c3d4e5f6a7b8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listJobs marks a running job as orphaned when its id is not in the active set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const id = 'deadbeefdeadbeef';
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, state: 'running', repo: 'r', fingerprint: 'f', updatedAt: '2024-01-01T00:00:00.000Z' }));
    const result = listJobs(dir, new Set());
    assert.equal(result.ok, true);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].state, 'orphaned');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listJobs keeps a running job as running when its id is in the active set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const id = 'cafebabe12345678';
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, state: 'running', repo: 'r', fingerprint: 'f', updatedAt: '2024-01-01T00:00:00.000Z' }));
    const result = listJobs(dir, new Set([id]));
    assert.equal(result.ok, true);
    assert.equal(result.jobs[0].state, 'running');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listJobs sorts jobs by updatedAt in descending order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const id1 = 'aaaaaaaaaaaaaaaa';
    const id2 = 'bbbbbbbbbbbbbbbb';
    writeFileSync(join(dir, `${id1}.json`), JSON.stringify({ id: id1, state: 'queued', updatedAt: '2024-01-01T00:00:00.000Z' }));
    writeFileSync(join(dir, `${id2}.json`), JSON.stringify({ id: id2, state: 'queued', updatedAt: '2024-01-02T00:00:00.000Z' }));
    const result = listJobs(dir);
    assert.equal(result.jobs[0].id, id2);
    assert.equal(result.jobs[1].id, id1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listJobs returns unreadable state for a job file that does not parse as JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const id = 'ffffffffffffffff';
    writeFileSync(join(dir, `${id}.json`), 'not valid json');
    const result = listJobs(dir);
    assert.equal(result.ok, true);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].id, id);
    assert.equal(result.jobs[0].state, 'unreadable');
    assert.match(result.jobs[0].error, /does not parse/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
