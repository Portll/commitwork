// Removes a finished job and the draft ref it kept. (lib/cobolwork-remediation-jobs.mjs clearJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearJob } from '../cobolwork-remediation-jobs.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok true when job file exists and is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearJob-'));
  try {
    writeFileSync(join(dir, 'job1.json'), '{}');
    const result = await clearJob(dir, { id: 'job1' });
    assert.deepEqual(result, { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true when job file is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearJob-'));
  try {
    const result = await clearJob(dir, { id: 'missing' });
    assert.deepEqual(result, { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with error when unlink fails with non-ENOENT error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearJob-'));
  try {
    const filePath = join(dir, 'job3.json');
    mkdirSync(filePath);
    const expectedError = `EPERM: operation not permitted, unlink '${filePath}'`;
    const result = await clearJob(dir, { id: 'job3' });
    assert.deepEqual(result, { ok: false, error: expectedError });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true when repoPath truthy and job.final truthy but ref does not match', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearJob-'));
  try {
    writeFileSync(join(dir, 'job4.json'), '{}');
    const result = await clearJob(dir, { id: 'job4', final: { ref: 'not-matching' } }, { repoPath: '/non/existent/path' });
    assert.deepEqual(result, { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true when repoPath truthy and job.final falsy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearJob-'));
  try {
    writeFileSync(join(dir, 'job5.json'), '{}');
    const result = await clearJob(dir, { id: 'job5' }, { repoPath: '/non/existent/path' });
    assert.deepEqual(result, { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok true when repoPath is null and job file exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clearJob-'));
  try {
    writeFileSync(join(dir, 'job6.json'), '{}');
    const result = await clearJob(dir, { id: 'job6' }, { repoPath: null });
    assert.deepEqual(result, { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
