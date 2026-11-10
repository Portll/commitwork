// Collects served HTML pages under a directory, skipping generated reports and git-ignored files. (bin/a11y-scan.mjs htmlFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlFiles } from '../a11y-scan.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array for an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    const result = htmlFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes a top-level html file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'index.html')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes generated report pages by name prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    writeFileSync(join(dir, 'dashboard.html'), '<html></html>');
    writeFileSync(join(dir, 'timeline.html'), '<html></html>');
    writeFileSync(join(dir, 'modernization.html'), '<html></html>');
    writeFileSync(join(dir, 'runtime.html'), '<html></html>');
    writeFileSync(join(dir, 'projectstatus.html'), '<html></html>');
    const result = htmlFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips node_modules and dot directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'lib.html'), '<html></html>');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'config.html'), '<html></html>');
    writeFileSync(join(dir, 'page.html'), '<html></html>');
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'page.html')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('walks subdirectories up to depth 3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'b'));
    mkdirSync(join(dir, 'a', 'b', 'c'));
    mkdirSync(join(dir, 'a', 'b', 'c', 'd'));
    writeFileSync(join(dir, 'a', 'b', 'c', 'deep.html'), '<html></html>');
    writeFileSync(join(dir, 'a', 'b', 'c', 'd', 'deeper.html'), '<html></html>');
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'a', 'b', 'c', 'deep.html')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-html files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    writeFileSync(join(dir, 'style.css'), 'body{}');
    writeFileSync(join(dir, 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'index.html')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when CW_A11Y_FILES is unset and dir has no html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    writeFileSync(join(dir, 'readme.txt'), 'hello');
    const result = htmlFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('respects CW_A11Y_FILES env var with valid paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    writeFileSync(join(dir, 'one.html'), '<html></html>');
    writeFileSync(join(dir, 'two.html'), '<html></html>');
    process.env.CW_A11Y_FILES = 'one.html, two.html';
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'one.html'), join(dir, 'two.html')].sort());
    delete process.env.CW_A11Y_FILES;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CW_A11Y_FILES filters out nonexistent paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    writeFileSync(join(dir, 'real.html'), '<html></html>');
    process.env.CW_A11Y_FILES = 'real.html, missing.html';
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'real.html')]);
    delete process.env.CW_A11Y_FILES;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips reports and dist directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'reports', 'out.html'), '<html></html>');
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'bundle.html'), '<html></html>');
    writeFileSync(join(dir, 'main.html'), '<html></html>');
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'main.html')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes directories named like html files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'htmlFiles-'));
  try {
    mkdirSync(join(dir, 'foo.html'));
    writeFileSync(join(dir, 'bar.html'), '<html></html>');
    const result = htmlFiles(dir);
    assert.deepEqual(result, [join(dir, 'bar.html')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
