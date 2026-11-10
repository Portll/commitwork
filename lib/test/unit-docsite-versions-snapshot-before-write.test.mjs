// creates a snapshot file before overwriting a doc (lib/docsite-versions.mjs snapshotBeforeWrite)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotBeforeWrite } from '../docsite-versions.mjs';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns undefined when previousContent is null', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'snapshotBeforeWrite-'));
  try {
    const result = snapshotBeforeWrite('manifest', 'editor-save', null, { root: tmp });
    assert.equal(result, undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('throws on bad key', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'snapshotBeforeWrite-'));
  try {
    assert.throws(
      () => snapshotBeforeWrite('Invalid!Key', 'editor-save', 'data', { root: tmp }),
      {
        name: 'Error',
        message: "docsite-versions: bad key 'Invalid!Key'"
      }
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('throws on bad origin', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'snapshotBeforeWrite-'));
  try {
    assert.throws(
      () => snapshotBeforeWrite('manifest', 'unknown-origin', 'data', { root: tmp }),
      {
        name: 'Error',
        message: "docsite-versions: bad origin 'unknown-origin' (want editor-save|generated)"
      }
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('writes a snapshot file with correct naming pattern and content', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'snapshotBeforeWrite-'));
  try {
    const key = 'manifest';
    const origin = 'editor-save';
    const content = 'original content';
    const result = snapshotBeforeWrite(key, origin, content, { root: tmp });
    assert.equal(result, undefined);
    const dir = join(tmp, '.versions', key, origin);
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    const fileName = files[0];
    assert.match(fileName, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.\d{3}Z-\d{6}-[0-9a-f]{12}\.snapshot$/);
    const fileContent = readFileSync(join(dir, fileName), 'utf8');
    assert.equal(fileContent, content);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('creates nested directories when root path does not exist (original recursive mkdir behavior)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'snapshotBeforeWrite-'));
  try {
    const nestedRoot = join(tmp, 'a', 'b', 'c');
    const result = snapshotBeforeWrite('manifest', 'generated', 'data', { root: nestedRoot });
    assert.equal(result, undefined);
    const dir = join(nestedRoot, '.versions', 'manifest', 'generated');
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
