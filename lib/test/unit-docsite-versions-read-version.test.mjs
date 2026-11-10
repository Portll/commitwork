// Reads a versioned snapshot file from the docsite versions pool (lib/docsite-versions.mjs readVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVersion } from '../docsite-versions.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns file contents for a valid key, origin, and id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const key = 'my-doc';
    const origin = 'editor-save';
    const id = '2024-01-01T00-00-00-000Z-000001-abcdef123456.snapshot';
    const poolPath = join(root, '.versions', key, origin);
    mkdirSync(poolPath, { recursive: true });
    const content = 'snapshot-data';
    writeFileSync(join(poolPath, id), content);
    const result = readVersion(key, origin, id, { root });
    assert.equal(result.toString(), content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for an invalid version id that does not match ID_RE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const key = 'my-doc';
    const origin = 'editor-save';
    const badId = 'not-a-valid-id';
    assert.throws(() => readVersion(key, origin, badId, { root }), /bad version id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for a bad key that fails KEY_RE validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const badKey = '../escape';
    const origin = 'editor-save';
    const id = '2024-01-01T00-00-00-000Z-000001-abcdef123456.snapshot';
    assert.throws(() => readVersion(badKey, origin, id, { root }), /bad key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for a bad origin not in ORIGINS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const key = 'my-doc';
    const badOrigin = 'unknown-origin';
    const id = '2024-01-01T00-00-00-000Z-000001-abcdef123456.snapshot';
    assert.throws(() => readVersion(key, badOrigin, id, { root }), /bad origin/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts the literal manifest key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const key = 'manifest';
    const origin = 'generated';
    const id = '2024-01-01T00-00-00-000Z-000001-abcdef123456.snapshot';
    const poolPath = join(root, '.versions', key, origin);
    mkdirSync(poolPath, { recursive: true });
    const content = 'manifest-data';
    writeFileSync(join(poolPath, id), content);
    const result = readVersion(key, origin, id, { root });
    assert.equal(result.toString(), content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a UUID key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const key = '123e4567-e89b-12d3-a456-426614174000';
    const origin = 'editor-save';
    const id = '2024-01-01T00-00-00-000Z-000001-abcdef123456.snapshot';
    const poolPath = join(root, '.versions', key, origin);
    mkdirSync(poolPath, { recursive: true });
    const content = 'uuid-doc-data';
    writeFileSync(join(poolPath, id), content);
    const result = readVersion(key, origin, id, { root });
    assert.equal(result.toString(), content);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the snapshot file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const key = 'my-doc';
    const origin = 'editor-save';
    const id = '2024-01-01T00-00-00-000Z-000001-abcdef123456.snapshot';
    const poolPath = join(root, '.versions', key, origin);
    mkdirSync(poolPath, { recursive: true });
    assert.throws(() => readVersion(key, origin, id, { root }), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for an id with wrong timestamp format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readVersion-'));
  try {
    const root = dir;
    const key = 'my-doc';
    const origin = 'editor-save';
    const badId = '2024-01-01T00:00:00.000Z-000001-abcdef123456.snapshot';
    assert.throws(() => readVersion(key, origin, badId, { root }), /bad version id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
