// monitor/test/codeql-coverage-units.test.mjs — case tests for laneSourceExts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laneSourceExts } from '../codeql-coverage.mjs';

test('laneSourceExts returns null for unreadable path', () => {
  const result = laneSourceExts('some-check', { path: '/nonexistent/path/manifest.json' });
  assert.equal(result, null);
});

test('laneSourceExts returns null for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, 'not valid json');
  const result = laneSourceExts('some-check', { path });
  assert.equal(result, null);
  rmSync(dir, { recursive: true, force: true });
});

test('laneSourceExts returns null when checks field is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ foo: 'bar' }));
  const result = laneSourceExts('some-check', { path });
  assert.equal(result, null);
  rmSync(dir, { recursive: true, force: true });
});

test('laneSourceExts returns null for unknown check id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ checks: [{ id: 'known-check', appliesIfSourceExt: ['.js'] }] }));
  const result = laneSourceExts('unknown-check', { path });
  assert.equal(result, null);
  rmSync(dir, { recursive: true, force: true });
});

test('laneSourceExts returns null when appliesIfSourceExt is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ checks: [{ id: 'check-1', appliesIfSourceExt: '.js' }] }));
  const result = laneSourceExts('check-1', { path });
  assert.equal(result, null);
  rmSync(dir, { recursive: true, force: true });
});

test('laneSourceExts returns the extension array for a known check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ checks: [{ id: 'check-1', appliesIfSourceExt: ['.py', '.rb'] }] }));
  const result = laneSourceExts('check-1', { path });
  assert.deepEqual(result, ['.py', '.rb']);
  rmSync(dir, { recursive: true, force: true });
});

test('laneSourceExts returns null when check entry has no id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ checks: [{ appliesIfSourceExt: ['.js'] }] }));
  const result = laneSourceExts('check-1', { path });
  assert.equal(result, null);
  rmSync(dir, { recursive: true, force: true });
});
