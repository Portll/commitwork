// monitor/test/validate-authored-judgment-units.test.mjs — case tests for validateLifecycleFiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateLifecycleFiles } from '../validate-authored-judgment.mjs';

test('returns empty array when reportsRoot does not exist', () => {
  const result = validateLifecycleFiles('/nonexistent/path/that/does/not/exist');
  assert.deepEqual(result, []);
});

test('returns empty array when reportsRoot exists but has no subdirectories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    const result = validateLifecycleFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when subdirectory exists but has no lifecycle.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    mkdirSync(join(dir, 'project1'));
    const result = validateLifecycleFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when lifecycle.json has empty records array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    mkdirSync(join(dir, 'project1'));
    writeFileSync(join(dir, 'project1', 'lifecycle.json'), JSON.stringify({ records: [] }));
    const result = validateLifecycleFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when lifecycle.json has no records key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    mkdirSync(join(dir, 'project1'));
    writeFileSync(join(dir, 'project1', 'lifecycle.json'), JSON.stringify({}));
    const result = validateLifecycleFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns violation when lifecycle.json contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    mkdirSync(join(dir, 'project1'));
    writeFileSync(join(dir, 'project1', 'lifecycle.json'), '{invalid json');
    const result = validateLifecycleFiles(dir);
    assert.equal(result.length, 1);
    assert.match(result[0], /project1\/lifecycle\.json: unreadable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns violations for records with missing required fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    mkdirSync(join(dir, 'project1'));
    const records = [{ key: 'test-key' }];
    writeFileSync(join(dir, 'project1', 'lifecycle.json'), JSON.stringify({ records }));
    const result = validateLifecycleFiles(dir);
    assert.ok(result.length > 0);
    assert.ok(result.some((v) => v.includes('project1/lifecycle.json[0] test-key')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns violations for records that are not objects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    mkdirSync(join(dir, 'project1'));
    const records = ['not-an-object'];
    writeFileSync(join(dir, 'project1', 'lifecycle.json'), JSON.stringify({ records }));
    const result = validateLifecycleFiles(dir);
    assert.ok(result.length > 0);
    assert.ok(result.some((v) => v.includes('not an object')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
