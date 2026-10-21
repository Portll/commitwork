// Bounded recursive directory walk that returns true if any entry matches a predicate (bin/audit.mjs treeHasMatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeHasMatch } from '../audit.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns false immediately when depth is negative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    const result = treeHasMatch(dir, () => true, -1);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a file matches the predicate at the root level', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    writeFileSync(join(dir, 'target.txt'), 'content');
    const result = treeHasMatch(dir, (e) => e.isFile() && e.name === 'target.txt', 3);
    assert.equal(result, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when no entries match the predicate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    writeFileSync(join(dir, 'other.txt'), 'content');
    const result = treeHasMatch(dir, (e) => e.isFile() && e.name === 'target.txt', 3);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a nested file matches within the depth limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'target.txt'), 'content');
    const result = treeHasMatch(dir, (e) => e.isFile() && e.name === 'target.txt', 3);
    assert.equal(result, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the matching file is deeper than the depth limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'b'));
    mkdirSync(join(dir, 'a', 'b', 'c'));
    writeFileSync(join(dir, 'a', 'b', 'c', 'target.txt'), 'content');
    const result = treeHasMatch(dir, (e) => e.isFile() && e.name === 'target.txt', 2);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when the matching file is exactly at the depth limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'b'));
    writeFileSync(join(dir, 'a', 'b', 'target.txt'), 'content');
    const result = treeHasMatch(dir, (e) => e.isFile() && e.name === 'target.txt', 2);
    assert.equal(result, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not descend into pruned directories even if they contain matches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'target.txt'), 'content');
    const result = treeHasMatch(dir, (e) => e.isFile() && e.name === 'target.txt', 3);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    const result = treeHasMatch(join(dir, 'nonexistent'), () => true, 3);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a directory entry matches the predicate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    mkdirSync(join(dir, 'target'));
    const result = treeHasMatch(dir, (e) => e.isDirectory() && e.name === 'target', 3);
    assert.equal(result, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHasMatch-'));
  try {
    const result = treeHasMatch(dir, () => true, 3);
    assert.equal(result, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
