// Computes the action needed to make monitor/private a directory or directory symlink (bin/init.mjs planPrivateDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPrivateDir } from '../init.mjs';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync, existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns create-dir when link is missing and wanted is falsy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    const result = planPrivateDir(root, undefined);
    assert.deepEqual(result, { path: join(root, 'monitor', 'private'), action: 'create-dir' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns create-dir when link is missing and wanted equals link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    const link = join(root, 'monitor', 'private');
    const result = planPrivateDir(root, link);
    assert.deepEqual(result, { path: link, action: 'create-dir' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns refuse when link is missing and wanted exists as a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    const wanted = join(dir, 'somefile');
    writeFileSync(wanted, 'data');
    const result = planPrivateDir(root, wanted);
    assert.deepEqual(result, { path: join(root, 'monitor', 'private'), action: 'refuse', reason: `${wanted} exists and is not a directory` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns link when link is missing and wanted exists as a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    const wanted = join(dir, 'target');
    mkdirSync(wanted);
    const result = planPrivateDir(root, wanted);
    assert.deepEqual(result, { path: join(root, 'monitor', 'private'), target: wanted, action: 'link' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns create-and-link when link is missing and wanted does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    mkdirSync(root, { recursive: true });
    const wanted = join(dir, 'nonexistent');
    const result = planPrivateDir(root, wanted);
    assert.deepEqual(result, { path: join(root, 'monitor', 'private'), target: wanted, action: 'create-and-link' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns refuse when link exists as a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    const link = join(root, 'monitor', 'private');
    mkdirSync(join(root, 'monitor'), { recursive: true });
    writeFileSync(link, 'data');
    const result = planPrivateDir(root, undefined);
    assert.deepEqual(result, { path: link, action: 'refuse', reason: `${link} exists and is not a directory` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns keep when link exists as a directory and wanted is falsy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    const link = join(root, 'monitor', 'private');
    mkdirSync(link, { recursive: true });
    const result = planPrivateDir(root, undefined);
    assert.deepEqual(result, { path: link, action: 'keep' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns keep when link exists as a directory and wanted equals link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    const link = join(root, 'monitor', 'private');
    mkdirSync(link, { recursive: true });
    const result = planPrivateDir(root, link);
    assert.deepEqual(result, { path: link, action: 'keep' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns keep when link exists as a directory and wanted resolves to same path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    const link = join(root, 'monitor', 'private');
    const realDir = join(dir, 'actual');
    mkdirSync(realDir);
    mkdirSync(join(root, 'monitor'), { recursive: true });
    symlinkSync(realDir, link, 'dir');
    const result = planPrivateDir(root, realDir);
    assert.deepEqual(result, { path: link, action: 'keep' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns refuse when link exists as a directory and wanted resolves to different path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planPrivateDir-'));
  try {
    const root = join(dir, 'repo');
    const link = join(root, 'monitor', 'private');
    const realDir = join(dir, 'actual');
    const otherDir = join(dir, 'other');
    mkdirSync(realDir);
    mkdirSync(otherDir);
    mkdirSync(join(root, 'monitor'), { recursive: true });
    symlinkSync(realDir, link, 'dir');
    const result = planPrivateDir(root, otherDir);
    const expectedReason = `${link} already resolves to ${realpathSync(link)}, not ${otherDir}`;
    assert.deepEqual(result, { path: link, action: 'refuse', reason: expectedReason });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
