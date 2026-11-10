// Set of relative .js/.mjs module paths from coverage JSON result URLs (bin/test-selection-witness.mjs executedModules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executedModules } from '../test-selection-witness.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns empty set when coverage directory has no json files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips json files that fail to parse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not valid json');
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips entries whose url does not start with file://', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [{ url: 'http://example.com/foo.js' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adds relative path for file url inside repo with .mjs extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [{ url: 'file:///repo/src/app.mjs' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set(['src/app.mjs']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adds relative path for file url inside repo with .js extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [{ url: 'file:///repo/lib/util.js' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set(['lib/util.js']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes paths that resolve outside the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [{ url: 'file:///other/app.mjs' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes paths containing node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [{ url: 'file:///repo/node_modules/pkg/index.mjs' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes paths without .js or .mjs extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [{ url: 'file:///repo/data/file.json' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips query string from url before computing relative path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [{ url: 'file:///repo/src/app.mjs?v=1' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.deepEqual(result, new Set(['src/app.mjs']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates identical module paths across multiple entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'executedModules-'));
  try {
    const doc = { result: [
      { url: 'file:///repo/src/app.mjs' },
      { url: 'file:///repo/src/app.mjs' }
    ]};
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 1);
    assert.ok(result.has('src/app.mjs'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
