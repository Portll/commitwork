// bin/test/test-selection-witness-units.test.mjs — case tests for executedModules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executedModules } from '../test-selection-witness.mjs';

test('returns empty set for empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-json files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    writeFileSync(join(dir, 'readme.txt'), 'hello');
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores invalid json files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not json');
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores urls that do not start with file://', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const doc = { result: [{ url: 'http://example.com/foo.mjs' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores paths outside repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const doc = { result: [{ url: 'file:///outside/foo.mjs' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores node_modules paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const doc = { result: [{ url: 'file:///repo/node_modules/pkg/index.mjs' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-js extensions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const doc = { result: [{ url: 'file:///repo/src/data.json' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes valid in-repo .mjs file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
  try {
    const doc = { result: [{ url: 'file:///repo/src/lib.mjs' }] };
    writeFileSync(join(dir, 'cov.json'), JSON.stringify(doc));
    const result = executedModules(dir, '/repo');
    assert.equal(result.size, 1);
    assert.ok(result.has('src/lib.mjs'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
