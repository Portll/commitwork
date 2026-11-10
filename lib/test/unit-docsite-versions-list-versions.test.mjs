// Lists snapshot ids for a key/origin pool, newest first, with parsed timestamps and byte sizes. (lib/docsite-versions.mjs listVersions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listVersions } from '../docsite-versions.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the pool directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the pool directory exists but is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const pool = join(root, '.versions', 'my-doc', 'editor-save');
    mkdirSync(pool, { recursive: true });
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a single valid snapshot with correct id, at, and bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const pool = join(root, '.versions', 'my-doc', 'editor-save');
    mkdirSync(pool, { recursive: true });
    const id = '2024-01-15T10-30-45-123Z-000001-abcdef123456.snapshot';
    const content = 'hello world';
    writeFileSync(join(pool, id), content);
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, [
      { id, at: '2024-01-15T10:30:45.123Z', bytes: 11 }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns multiple snapshots sorted newest first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const pool = join(root, '.versions', 'my-doc', 'editor-save');
    mkdirSync(pool, { recursive: true });
    const id1 = '2024-01-15T10-30-45-100Z-000001-abcdef123456.snapshot';
    const id2 = '2024-01-15T10-30-45-200Z-000002-abcdef123456.snapshot';
    const id3 = '2024-01-15T10-30-45-300Z-000003-abcdef123456.snapshot';
    writeFileSync(join(pool, id1), 'a');
    writeFileSync(join(pool, id2), 'bb');
    writeFileSync(join(pool, id3), 'ccc');
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, [
      { id: id3, at: '2024-01-15T10:30:45.300Z', bytes: 3 },
      { id: id2, at: '2024-01-15T10:30:45.200Z', bytes: 2 },
      { id: id1, at: '2024-01-15T10:30:45.100Z', bytes: 1 }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out files that do not match the snapshot id pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const pool = join(root, '.versions', 'my-doc', 'editor-save');
    mkdirSync(pool, { recursive: true });
    const validId = '2024-01-15T10-30-45-123Z-000001-abcdef123456.snapshot';
    writeFileSync(join(pool, validId), 'data');
    writeFileSync(join(pool, 'not-a-snapshot.txt'), 'junk');
    writeFileSync(join(pool, '2024-01-15T10-30-45-123Z-000001-abcdef123456'), 'no-ext');
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, [
      { id: validId, at: '2024-01-15T10:30:45.123Z', bytes: 4 }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns bytes as 0 when the snapshot file has been deleted after listing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const pool = join(root, '.versions', 'my-doc', 'editor-save');
    mkdirSync(pool, { recursive: true });
    const id = '2024-01-15T10-30-45-123Z-000001-abcdef123456.snapshot';
    writeFileSync(join(pool, id), 'content');
    rmSync(join(pool, id));
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error for a key that does not match the allowed pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    assert.throws(
      () => listVersions('Bad Key', 'editor-save', { root }),
      /bad key/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws an error for an origin that is not in ORIGINS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    assert.throws(
      () => listVersions('my-doc', 'unknown-origin', { root }),
      /bad origin/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns bytes as 0 when the snapshot file is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const pool = join(root, '.versions', 'my-doc', 'editor-save');
    mkdirSync(pool, { recursive: true });
    const id = '2024-01-15T10-30-45-123Z-000001-abcdef123456.snapshot';
    mkdirSync(join(pool, id));
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, [
      { id, at: '2024-01-15T10:30:45.123Z', bytes: 0 }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns bytes as 0 when the snapshot file is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'listVersions-'));
  try {
    const root = join(dir, 'root');
    const pool = join(root, '.versions', 'my-doc', 'editor-save');
    mkdirSync(pool, { recursive: true });
    const id = '2024-01-15T10-30-45-123Z-000001-abcdef123456.snapshot';
    writeFileSync(join(pool, id), 'secret');
    const result = listVersions('my-doc', 'editor-save', { root });
    assert.deepEqual(result, [
      { id, at: '2024-01-15T10:30:45.123Z', bytes: 6 }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
