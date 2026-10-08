// Writes a job object to a JSON file atomically (lib/cobolwork-remediation-jobs.mjs writeJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeJob } from '../cobolwork-remediation-jobs.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('writes job to a new directory and file with updatedAt set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  try {
    const job = { id: 'job1', name: 'Test Job' };
    writeJob(dir, job);
    const filePath = join(dir, 'job1.json');
    assert.ok(existsSync(filePath));
    const content = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.id, 'job1');
    assert.equal(parsed.name, 'Test Job');
    assert.ok(parsed.updatedAt);
    assert.ok(content.endsWith('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates nested directories recursively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  try {
    const nestedDir = join(dir, 'a', 'b', 'c');
    const job = { id: 'job2' };
    writeJob(nestedDir, job);
    const filePath = join(nestedDir, 'job2.json');
    assert.ok(existsSync(filePath));
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(parsed.id, 'job2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites existing job file with updated content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  try {
    const job = { id: 'job3', value: 1 };
    writeJob(dir, job);
    job.value = 2;
    writeJob(dir, job);
    const filePath = join(dir, 'job3.json');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(parsed.value, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets updatedAt to current ISO timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  try {
    const before = new Date().toISOString();
    const job = { id: 'job4' };
    writeJob(dir, job);
    const after = new Date().toISOString();
    const parsed = JSON.parse(readFileSync(join(dir, 'job4.json'), 'utf8'));
    assert.ok(parsed.updatedAt >= before);
    assert.ok(parsed.updatedAt <= after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses CW_NOW environment variable for updatedAt when set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  const originalNow = process.env.CW_NOW;
  try {
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    const job = { id: 'job5' };
    writeJob(dir, job);
    const parsed = JSON.parse(readFileSync(join(dir, 'job5.json'), 'utf8'));
    assert.equal(parsed.updatedAt, '2024-01-01T00:00:00.000Z');
  } finally {
    if (originalNow === undefined) {
      delete process.env.CW_NOW;
    } else {
      process.env.CW_NOW = originalNow;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes job with 2-space indentation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  try {
    const job = { id: 'job6', nested: { key: 'value' } };
    writeJob(dir, job);
    const content = readFileSync(join(dir, 'job6.json'), 'utf8');
    const expected = JSON.stringify(job, null, 2) + '\n';
    assert.equal(content, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles job with special characters in id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  try {
    const job = { id: 'job-with-dashes_and.underscores' };
    writeJob(dir, job);
    const filePath = join(dir, 'job-with-dashes_and.underscores.json');
    assert.ok(existsSync(filePath));
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(parsed.id, 'job-with-dashes_and.underscores');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preserves all job properties in output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJob-'));
  try {
    const job = { id: 'job7', status: 'pending', count: 42, tags: ['a', 'b'] };
    writeJob(dir, job);
    const parsed = JSON.parse(readFileSync(join(dir, 'job7.json'), 'utf8'));
    assert.equal(parsed.id, 'job7');
    assert.equal(parsed.status, 'pending');
    assert.equal(parsed.count, 42);
    assert.deepEqual(parsed.tags, ['a', 'b']);
    assert.ok(parsed.updatedAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
