// Lists sweep batch directories under the reports root, oldest first, with parsed manifests. (monitor/area.mjs sweepBatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepBatches } from '../area.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when reports root does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reg = { reportsRoot: 'nonexistent-reports' };
    const result = sweepBatches(reg);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when reports root exists but has no sweep directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    mkdirSync(reportsRoot, { recursive: true });
    writeFileSync(join(reportsRoot, 'file.txt'), 'data');
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out entries that do not start with sweep-', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    mkdirSync(reportsRoot, { recursive: true });
    mkdirSync(join(reportsRoot, 'other-dir'), { recursive: true });
    writeFileSync(join(reportsRoot, 'sweep-file.txt'), 'data');
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out sweep- prefixed files that are not directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    mkdirSync(reportsRoot, { recursive: true });
    writeFileSync(join(reportsRoot, 'sweep-12345678901234'), 'data');
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns sweep directories sorted lexicographically with null stamp and null manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    mkdirSync(reportsRoot, { recursive: true });
    const names = ['sweep-b', 'sweep-a', 'sweep-c'];
    for (const name of names) {
      mkdirSync(join(reportsRoot, name), { recursive: true });
    }
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((r) => r.name), ['sweep-a', 'sweep-b', 'sweep-c']);
    for (const r of result) {
      assert.equal(r.stamp, null);
      assert.equal(r.manifest, null);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extracts 14-digit stamp from sweep directory name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    mkdirSync(reportsRoot, { recursive: true });
    const name = 'sweep-20240101123456';
    mkdirSync(join(reportsRoot, name), { recursive: true });
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, name);
    assert.equal(result[0].stamp, '20240101123456');
    assert.equal(result[0].manifest, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses batch-manifest.json when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    const name = 'sweep-20240101123456';
    const batchDir = join(reportsRoot, name);
    mkdirSync(batchDir, { recursive: true });
    const manifest = { id: 'test-batch', count: 5 };
    writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify(manifest));
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, name);
    assert.equal(result[0].stamp, '20240101123456');
    assert.deepEqual(result[0].manifest, manifest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null manifest when batch-manifest.json is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    const name = 'sweep-20240101123456';
    const batchDir = join(reportsRoot, name);
    mkdirSync(batchDir, { recursive: true });
    writeFileSync(join(batchDir, 'batch-manifest.json'), 'not valid json');
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, name);
    assert.equal(result[0].stamp, '20240101123456');
    assert.equal(result[0].manifest, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles sweep directory with 13-digit prefix (not 14) as null stamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    const name = 'sweep-2024010112345';
    mkdirSync(join(reportsRoot, name), { recursive: true });
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, name);
    assert.equal(result[0].stamp, null);
    assert.equal(result[0].manifest, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles sweep directory with 15-digit prefix (not 14) as null stamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweepBatches-'));
  try {
    const reportsRoot = join(dir, 'reports');
    const name = 'sweep-202401011234567';
    mkdirSync(join(reportsRoot, name), { recursive: true });
    const reg = { reportsRoot: join(reportsRoot) };
    const result = sweepBatches(reg);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, name);
    assert.equal(result[0].stamp, "20240101123456");
    assert.equal(result[0].manifest, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
