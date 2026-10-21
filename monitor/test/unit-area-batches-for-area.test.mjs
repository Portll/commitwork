// Splits sweep batches into those covering the target area and those of unknown scope (monitor/area.mjs batchesForArea).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchesForArea } from '../area.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('returns empty covers and unknown when no sweep batches exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    mkdirSync(reports, { recursive: true });
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.deepEqual(result, { covers: [], unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty covers and unknown when reports root does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reg = { reportsRoot: join(dir, 'nonexistent') };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.deepEqual(result, { covers: [], unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies batch with matching area slug into covers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const batchDir = join(reports, 'sweep-20240101000000');
    mkdirSync(batchDir, { recursive: true });
    writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify({ area: 'alpha' }));
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.equal(result.covers.length, 1);
    assert.equal(result.covers[0].name, 'sweep-20240101000000');
    assert.equal(result.unknown.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies batch with non-matching area slug into neither list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const batchDir = join(reports, 'sweep-20240101000000');
    mkdirSync(batchDir, { recursive: true });
    writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify({ area: 'beta' }));
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.equal(result.covers.length, 0);
    assert.equal(result.unknown.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies batch with matching areaOut dir into covers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const batchDir = join(reports, 'sweep-20240101000000');
    mkdirSync(batchDir, { recursive: true });
    const targetDir = join(dir, 'alpha-out');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify({ areaOut: targetDir }));
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: null, dir: targetDir }, reg);
    assert.equal(result.covers.length, 1);
    assert.equal(result.covers[0].name, 'sweep-20240101000000');
    assert.equal(result.unknown.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies batch with non-matching areaOut dir into neither list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const batchDir = join(reports, 'sweep-20240101000000');
    mkdirSync(batchDir, { recursive: true });
    const targetDir = join(dir, 'alpha-out');
    mkdirSync(targetDir, { recursive: true });
    const otherDir = join(dir, 'beta-out');
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify({ areaOut: otherDir }));
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: null, dir: targetDir }, reg);
    assert.equal(result.covers.length, 0);
    assert.equal(result.unknown.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies batch with no area or areaOut in manifest into unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const batchDir = join(reports, 'sweep-20240101000000');
    mkdirSync(batchDir, { recursive: true });
    writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify({ other: 'field' }));
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.equal(result.covers.length, 0);
    assert.equal(result.unknown.length, 1);
    assert.equal(result.unknown[0].name, 'sweep-20240101000000');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies batch with missing manifest file into unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const batchDir = join(reports, 'sweep-20240101000000');
    mkdirSync(batchDir, { recursive: true });
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.equal(result.covers.length, 0);
    assert.equal(result.unknown.length, 1);
    assert.equal(result.unknown[0].name, 'sweep-20240101000000');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns batches in newest-first order with covers before unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const b1 = join(reports, 'sweep-20240101000000');
    const b2 = join(reports, 'sweep-20240102000000');
    const b3 = join(reports, 'sweep-20240103000000');
    mkdirSync(b1, { recursive: true });
    mkdirSync(b2, { recursive: true });
    mkdirSync(b3, { recursive: true });
    writeFileSync(join(b1, 'batch-manifest.json'), JSON.stringify({ area: 'alpha' }));
    writeFileSync(join(b2, 'batch-manifest.json'), JSON.stringify({ other: 'x' }));
    writeFileSync(join(b3, 'batch-manifest.json'), JSON.stringify({ area: 'alpha' }));
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.equal(result.covers.length, 2);
    assert.equal(result.covers[0].name, 'sweep-20240103000000');
    assert.equal(result.covers[1].name, 'sweep-20240101000000');
    assert.equal(result.unknown.length, 1);
    assert.equal(result.unknown[0].name, 'sweep-20240102000000');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-sweep directories and files in reports root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batchesForArea-'));
  try {
    const reports = join(dir, 'reports');
    const batchDir = join(reports, 'sweep-20240101000000');
    const otherDir = join(reports, 'other-dir');
    mkdirSync(batchDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(reports, 'sweep-file.txt'), 'not a dir');
    writeFileSync(join(batchDir, 'batch-manifest.json'), JSON.stringify({ area: 'alpha' }));
    const reg = { reportsRoot: reports };
    const result = batchesForArea({ slug: 'alpha', dir: join(dir, 'out') }, reg);
    assert.equal(result.covers.length, 1);
    assert.equal(result.covers[0].name, 'sweep-20240101000000');
    assert.equal(result.unknown.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
