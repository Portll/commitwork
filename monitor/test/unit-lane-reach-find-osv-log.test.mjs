// Picks the OSV log path from the last sorted batch that has one for a repo (monitor/lane-reach.mjs findOsvLog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOsvLog } from '../lane-reach.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function seedLog(reports, batch, repo) {
  mkdirSync(join(reports, batch, repo), { recursive: true });
  const p = join(reports, batch, repo, 'osv.log');
  writeFileSync(p, 'x');
  return p;
}

test('returns null when the reports directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    assert.equal(findOsvLog(join(dir, 'no-such-reports'), 'repo-a'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the scandir error when the reports path is a regular file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    writeFileSync(reports, 'x');
    assert.throws(() => findOsvLog(reports, 'repo-a'), {
      name: 'Error',
      code: 'ENOTDIR',
      message: `ENOTDIR: not a directory, scandir '${reports}'`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the reports directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    mkdirSync(reports);
    assert.equal(findOsvLog(reports, 'repo-a'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when no batch contains a log for the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    seedLog(reports, 'b1', 'other-repo');
    mkdirSync(join(reports, 'b1', 'repo-a'));
    assert.equal(findOsvLog(reports, 'repo-a'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the only hit when one batch has the repo log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    const hit = seedLog(reports, 'b1', 'repo-a');
    assert.equal(findOsvLog(reports, 'repo-a'), hit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the second hit when two batches have the repo log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    seedLog(reports, 'b1', 'repo-a');
    const last = seedLog(reports, 'b2', 'repo-a');
    assert.equal(findOsvLog(reports, 'repo-a'), last);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the third hit when three batches have the repo log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    seedLog(reports, 'aa', 'repo-a');
    seedLog(reports, 'mm', 'repo-a');
    const last = seedLog(reports, 'zz', 'repo-a');
    assert.equal(findOsvLog(reports, 'repo-a'), last);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('orders batches as strings so b9 comes after b10', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    seedLog(reports, 'b10', 'repo-a');
    const last = seedLog(reports, 'b9', 'repo-a');
    assert.equal(findOsvLog(reports, 'repo-a'), last);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to an earlier batch when the last batch has no log for the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    const hit = seedLog(reports, 'b1', 'repo-a');
    seedLog(reports, 'b2', 'other-repo');
    assert.equal(findOsvLog(reports, 'repo-a'), hit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips a plain file sitting among the batch directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findOsvLog-'));
  try {
    const reports = join(dir, 'reports');
    const hit = seedLog(reports, 'b1', 'repo-a');
    writeFileSync(join(reports, 'zz'), 'x');
    assert.equal(findOsvLog(reports, 'repo-a'), hit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
