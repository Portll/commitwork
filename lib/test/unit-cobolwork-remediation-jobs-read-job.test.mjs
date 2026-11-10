// Reads a job JSON file from a directory, returning the parsed job, a missing flag, or an unreadable message. (lib/cobolwork-remediation-jobs.mjs readJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJob } from '../cobolwork-remediation-jobs.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns missing when the job file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const result = readJob(dir, 'nonexistent');
    assert.deepEqual(result, { missing: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed job when the file contains valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const job = { id: 'job1', status: 'pending' };
    writeFileSync(join(dir, 'job1.json'), JSON.stringify(job));
    const result = readJob(dir, 'job1');
    assert.deepEqual(result, { job });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{ invalid json');
    const result = readJob(dir, 'bad');
    assert.equal(result.unreadable.startsWith('job file does not parse:'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with the error message when the file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const fakeDir = join(dir, 'subdir');
    writeFileSync(join(dir, 'fake.json'), 'content');
    const result = readJob(join(dir, 'does-not-exist'), 'fake');
    assert.equal(result.missing, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a job with an empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '{}');
    const result = readJob(dir, 'empty');
    assert.deepEqual(result, { job: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a job with a long repeated string value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const longStr = 'x'.repeat(100);
    const job = { data: longStr };
    writeFileSync(join(dir, 'long.json'), JSON.stringify(job));
    const result = readJob(dir, 'long');
    assert.deepEqual(result, { job });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns missing for a file in a non-existent subdirectory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const result = readJob(join(dir, 'no-such-dir'), 'job');
    assert.deepEqual(result, { missing: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable when JSON parse fails on a truncated file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const full = JSON.stringify({ a: 'b'.repeat(50) });
    writeFileSync(join(dir, 'trunc.json'), full.slice(0, 10));
    const result = readJob(dir, 'trunc');
    assert.equal(result.unreadable.startsWith('job file does not parse:'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
