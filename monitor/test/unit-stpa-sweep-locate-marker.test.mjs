// Finds files under the admin tree that still carry a moved closure marker (monitor/stpa-sweep.mjs locateMarker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateMarker } from '../stpa-sweep.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when no files match the predicate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    mkdirSync(admin, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'content');
    const result = locateMarker(fromPath, () => false);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns matching file relative to admin root with forward slashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    mkdirSync(admin, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'content');
    const target = join(admin, 'b.mjs');
    writeFileSync(target, 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, ['admin/b.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes the fromPath file itself from results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    mkdirSync(admin, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips directories listed in SKIP_DIRS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    const testDir = join(admin, 'test');
    mkdirSync(testDir, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'content');
    const target = join(testDir, 'b.mjs');
    writeFileSync(target, 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips hidden files and directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    const hiddenDir = join(admin, '.hidden');
    mkdirSync(hiddenDir, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'content');
    const target = join(hiddenDir, 'b.mjs');
    writeFileSync(target, 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips files that do not end with .mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    mkdirSync(admin, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'content');
    const target = join(admin, 'b.js');
    writeFileSync(target, 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns multiple matches sorted alphabetically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    const sub = join(admin, 'sub');
    mkdirSync(sub, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'content');
    writeFileSync(join(admin, 'c.mjs'), 'marker');
    writeFileSync(join(sub, 'b.mjs'), 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, ['admin/c.mjs', 'admin/sub/b.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stops scanning when limit is reached', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const admin = join(dir, 'admin');
    mkdirSync(admin, { recursive: true });
    const fromPath = join(admin, 'a.mjs');
    writeFileSync(fromPath, 'content');
    writeFileSync(join(admin, 'b.mjs'), 'marker');
    writeFileSync(join(admin, 'c.mjs'), 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker', { limit: 1 });
    assert.deepEqual(result, ['admin/b.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('searches up to six levels to find admin directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const deep = join(dir, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'admin');
    mkdirSync(deep, { recursive: true });
    const fromPath = join(deep, 'a.mjs');
    writeFileSync(fromPath, 'content');
    const target = join(deep, 'b.mjs');
    writeFileSync(target, 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, ['admin/b.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses starting directory as root when admin is not found within six levels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locateMarker-'));
  try {
    const deep = join(dir, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7');
    mkdirSync(deep, { recursive: true });
    const fromPath = join(deep, 'a.mjs');
    writeFileSync(fromPath, 'content');
    const target = join(deep, 'b.mjs');
    writeFileSync(target, 'marker');
    const result = locateMarker(fromPath, (s) => s === 'marker');
    assert.deepEqual(result, ['l7/b.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
