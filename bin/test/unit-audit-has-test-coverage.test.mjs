// Detects whether a project tree contains test files, test directories, or test-runner configs (bin/audit.mjs hasTestCoverage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasTestCoverage } from '../audit.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns true when a test file exists at the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    writeFileSync(join(dir, 'app.test.js'), '');
    assert.equal(hasTestCoverage(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a spec file exists at the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    writeFileSync(join(dir, 'app.spec.ts'), '');
    assert.equal(hasTestCoverage(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a vitest config file exists at the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    writeFileSync(join(dir, 'vitest.config.js'), '');
    assert.equal(hasTestCoverage(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a jest config file exists at the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    writeFileSync(join(dir, 'jest.config.mjs'), '');
    assert.equal(hasTestCoverage(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a test directory exists at the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    mkdirSync(join(dir, 'test'));
    assert.equal(hasTestCoverage(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a tests directory exists at the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    mkdirSync(join(dir, 'tests'));
    assert.equal(hasTestCoverage(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a test file exists in a nested directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    const nested = join(dir, 'src', 'lib');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'util.test.js'), '');
    assert.equal(hasTestCoverage(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when no test indicators exist in the tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    writeFileSync(join(dir, 'main.js'), '');
    writeFileSync(join(dir, 'README.md'), '');
    assert.equal(hasTestCoverage(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when a file name contains test but does not match the pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    writeFileSync(join(dir, 'latest.js'), '');
    writeFileSync(join(dir, 'testdata.json'), '');
    assert.equal(hasTestCoverage(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when a directory is named testing instead of test', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    mkdirSync(join(dir, 'testing'));
    writeFileSync(join(dir, 'testing', 'app.js'), '');
    assert.equal(hasTestCoverage(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when a test file exists deeper than the walk depth allows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hasTestCoverage-'));
  try {
    const deep = join(dir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'hidden.test.js'), '');
    assert.equal(hasTestCoverage(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
