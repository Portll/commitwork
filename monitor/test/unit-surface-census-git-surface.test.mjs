// Per-language counts of the files git tracks in a repository (monitor/surface-census.mjs gitSurface).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitSurface } from '../surface-census.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

function buildIndex(names) {
  const sorted = names.map((n) => Buffer.from(n)).sort(Buffer.compare);
  const sha = createHash('sha1').update('blob 0\0').digest();
  const header = Buffer.alloc(12);
  header.write('DIRC', 0, 'ascii');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(sorted.length, 8);
  const parts = [header];
  for (const name of sorted) {
    const entry = Buffer.alloc(Math.floor((62 + name.length + 8) / 8) * 8);
    entry.writeUInt32BE(0o100644, 24);
    sha.copy(entry, 40);
    entry.writeUInt16BE(name.length, 60);
    name.copy(entry, 62);
    parts.push(entry);
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, createHash('sha1').update(body).digest()]);
}

function makeRepo(dir, names) {
  const root = join(dir, 'repo');
  mkdirSync(join(root, '.git', 'objects'), { recursive: true });
  mkdirSync(join(root, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = false\n');
  if (names) writeFileSync(join(root, '.git', 'index'), buildIndex(names));
  return root;
}

test('returns null when the root has no .git entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = join(dir, 'plain');
    mkdirSync(root, { recursive: true });
    const result = gitSurface(root);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when .git exists but git cannot list files from it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = join(dir, 'broken');
    mkdirSync(join(root, '.git'), { recursive: true });
    const result = gitSurface(root);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty object for a repository with no tracked files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = makeRepo(dir, null);
    const result = gitSurface(root);
    assert.deepEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts one tracked root-level file as one for its language', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = makeRepo(dir, ['a.js']);
    const result = gitSurface(root);
    assert.deepEqual(Object.values(result), [1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adds one per tracked file of a language across root and nested paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = makeRepo(dir, ['a.js', 'src/b.js', 'src/lib/c.js', 'd.py']);
    const result = gitSurface(root);
    assert.deepEqual(Object.values(result), [3, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips a basename whose only dot is its first character but counts one with a dot after it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = makeRepo(dir, ['.js', 'b.js', 'src/.py']);
    const result = gitSurface(root);
    assert.deepEqual(Object.values(result), [1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores tracked files with no extension or an unknown one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = makeRepo(dir, ['Makefile', 'README', 'notes.zzz', 'src/x']);
    const result = gitSurface(root);
    assert.deepEqual(result, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matches the last extension case-insensitively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitSurface-'));
  try {
    const root = makeRepo(dir, ['APP.JS', 'my.file.py', 'keep.js.zzz']);
    const result = gitSurface(root);
    assert.deepEqual(Object.values(result), [1, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
