// Computes version, bootAt, checkout flag, commit, short, branch, or reason for a worktree (admin/lib/panel-build.mjs readBuild).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBuild } from '../lib/panel-build.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns checkout false when .git is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3' }));
    const res = readBuild(dir, 1000);
    assert.deepEqual(res, { version: '1.2.3', bootAt: 1000, checkout: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version null when package.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'main'), 'abc123def456\n');
    const res = readBuild(dir, 2000);
    assert.equal(res.version, null);
    assert.equal(res.bootAt, 2000);
    assert.equal(res.checkout, true);
    assert.equal(res.commit, 'abc123def456');
    assert.equal(res.short, 'abc123de');
    assert.equal(res.branch, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns version null when package.json has no version field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'dev'), 'fedcba987654\n');
    const res = readBuild(dir, 3000);
    assert.equal(res.version, null);
    assert.equal(res.bootAt, 3000);
    assert.equal(res.checkout, true);
    assert.equal(res.commit, 'fedcba987654');
    assert.equal(res.short, 'fedcba98');
    assert.equal(res.branch, 'dev');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns commit from detached HEAD', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'deadbeefcafe1234\n');
    const res = readBuild(dir, 4000);
    assert.equal(res.version, '2.0.0');
    assert.equal(res.bootAt, 4000);
    assert.equal(res.checkout, true);
    assert.equal(res.commit, 'deadbeefcafe1234');
    assert.equal(res.short, 'deadbeef');
    assert.equal(res.branch, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns reason when HEAD file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '3.1.4' }));
    mkdirSync(join(dir, '.git'));
    const res = readBuild(dir, 5000);
    assert.equal(res.version, '3.1.4');
    assert.equal(res.bootAt, 5000);
    assert.equal(res.checkout, true);
    assert.equal(res.commit, null);
    assert.ok(res.reason.includes('ENOENT'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns reason when ref is in neither loose nor packed refs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '4.5.6' }));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/missing\n');
    const res = readBuild(dir, 6000);
    assert.equal(res.version, '4.5.6');
    assert.equal(res.bootAt, 6000);
    assert.equal(res.checkout, true);
    assert.equal(res.commit, null);
    assert.ok(res.reason.includes('missing'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns commit from packed-refs when loose ref is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '5.6.7' }));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/packed\n');
    writeFileSync(join(dir, '.git', 'packed-refs'), '1111222233334444 refs/heads/packed\n');
    const res = readBuild(dir, 7000);
    assert.equal(res.version, '5.6.7');
    assert.equal(res.bootAt, 7000);
    assert.equal(res.checkout, true);
    assert.equal(res.commit, '1111222233334444');
    assert.equal(res.short, '11112222');
    assert.equal(res.branch, 'packed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns reason when .git exists but statSync throws non-ENOENT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBuild-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '6.7.8' }));
    const gitDir = join(dir, '.git');
    mkdirSync(gitDir);
    const res = readBuild(dir, 8000);
    assert.equal(res.version, '6.7.8');
    assert.equal(res.bootAt, 8000);
    assert.equal(res.checkout, true);
    assert.equal(res.commit, null);
    assert.ok(res.reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
