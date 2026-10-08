// lib/test/cobolwork-resolve-units.test.mjs — case tests for readTree, statedCommit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTree, statedCommit } from '../cobolwork-resolve.mjs';

test('readTree returns empty array for empty package dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    mkdirSync(join(dir, 'package'));
    assert.deepEqual(readTree(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readTree reads regular files with path and data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    mkdirSync(join(dir, 'package', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'package', 'a.txt'), 'hello');
    writeFileSync(join(dir, 'package', 'sub', 'b.txt'), 'world');
    const result = readTree(dir);
    assert.equal(result.length, 2);
    const a = result.find(e => e.path === 'package/a.txt');
    assert.ok(a);
    assert.equal(a.data.toString(), 'hello');
    const b = result.find(e => e.path === 'package/sub/b.txt');
    assert.ok(b);
    assert.equal(b.data.toString(), 'world');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readTree throws on symlink', { skip: process.platform === 'win32' && 'symlinks need a privilege on Windows' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    mkdirSync(join(dir, 'package'));
    writeFileSync(join(dir, 'package', 'target.txt'), 'x');
    symlinkSync(join(dir, 'package', 'target.txt'), join(dir, 'package', 'link.txt'));
    assert.throws(() => readTree(dir), /neither a file nor a directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readTree throws when package dir does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    assert.throws(() => readTree(dir), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns commit when revision.json contains a valid 40-char hex commit', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from('{"commit":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"}') },
    { path: 'package/package.json', data: Buffer.from('{}') }
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' });
});

test('returns reason when revision.json is missing from entries', () => {
  const entries = [
    { path: 'package/package.json', data: Buffer.from('{}') }
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: 'the package has no lib/revision.json, so it states no commit' });
});

test('returns reason when commit value is not a 40-char hex string', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from('{"commit":"short"}') }
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: 'package/lib/revision.json states no commit id ("short")' });
});

test('returns reason when revision.json contains invalid JSON', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from('not valid json') }
  ];
  const result = statedCommit(entries);
  assert.match(result.reason, /package\/lib\/revision\.json is not JSON/);
});

test('returns reason when commit is a number instead of a string', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from('{"commit":12345}') }
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: 'package/lib/revision.json states no commit id (12345)' });
});

test('returns reason when commit is null', () => {
  const entries = [
    { path: 'package/lib/revision.json', data: Buffer.from('{"commit":null}') }
  ];
  const result = statedCommit(entries);
  assert.deepEqual(result, { reason: 'package/lib/revision.json states no commit id (null)' });
});
