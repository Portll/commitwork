// Checks whether a file with one of the given names exists within a directory tree (bin/audit.mjs treeHas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeHas } from '../audit.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns true when a matching file exists at the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    assert.equal(treeHas(dir, ['package.json']), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when no matching file exists in the tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    assert.equal(treeHas(dir, ['package-lock.json']), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a matching file exists in a subdirectory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'), '');
    assert.equal(treeHas(dir, ['index.js']), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the matching file is deeper than the default depth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    const deep = join(dir, 'a', 'b', 'c', 'd');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'target.txt'), '');
    assert.equal(treeHas(dir, ['target.txt']), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a matching file is found at exactly the depth limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    const deep = join(dir, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'target.txt'), '');
    assert.equal(treeHas(dir, ['target.txt']), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the matching file is inside a pruned directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'package.json'), '{}');
    assert.equal(treeHas(dir, ['package.json']), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a matching file exists in a non-pruned subdirectory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'package.json'), '{}');
    assert.equal(treeHas(dir, ['package.json']), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    assert.equal(treeHas(dir, ['package.json']), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    const missing = join(dir, 'nonexistent');
    assert.equal(treeHas(missing, ['package.json']), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when any of multiple names matches a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treeHas-'));
  try {
    writeFileSync(join(dir, 'Cargo.toml'), '');
    assert.equal(treeHas(dir, ['package.json', 'Cargo.toml']), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
