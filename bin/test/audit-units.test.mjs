// bin/test/audit-units.test.mjs — case tests for treeHasMatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeHasMatch } from '../audit.mjs';

test('returns false for non-existent directory', () => {
  assert.equal(treeHasMatch('/nonexistent/path/xyz', () => true), false);
});

test('returns true when predicate matches a file in the directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    assert.equal(treeHasMatch(dir, (e) => e.name === 'package.json'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when predicate matches nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    assert.equal(treeHasMatch(dir, (e) => e.name === 'nonexistent.txt'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finds matches in subdirectories within depth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  try {
    const sub = join(dir, 'src');
    mkdirSync(sub);
    writeFileSync(join(sub, 'index.js'), '');
    assert.equal(treeHasMatch(dir, (e) => e.name === 'index.js', 3), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when depth is 0 and match is in subdirectory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  try {
    const sub = join(dir, 'src');
    mkdirSync(sub);
    writeFileSync(join(sub, 'index.js'), '');
    assert.equal(treeHasMatch(dir, (e) => e.name === 'index.js', 0), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false for negative depth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    assert.equal(treeHasMatch(dir, (e) => e.name === 'package.json', -1), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
