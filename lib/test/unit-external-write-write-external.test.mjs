// writes a redacted file and returns its path and byte length (lib/external-write.mjs writeExternal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeExternal } from '../external-write.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

test('writes a file when given a valid relative path and content that fully redacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { secret: 'REDACTED' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    const result = writeExternal('sub/file.txt', 'this contains secret', env);
    const written = readFileSync(result.path, 'utf8');
    assert.equal(written, 'this contains REDACTED');
    const expectedPath = resolve(dir, 'sub/file.txt');
    const expectedBytes = Buffer.byteLength('this contains REDACTED');
    assert.deepEqual(result, { path: expectedPath, bytes: expectedBytes });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the path argument is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { a: 'b' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    assert.throws(() => writeExternal(123, 'content', env), {
      name: 'Error',
      message: 'external-write: path must be relative to the external/ folder'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the path is absolute', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { a: 'b' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    const absPath = join(dir, 'file.txt');
    assert.throws(() => writeExternal(absPath, 'x', env), {
      name: 'Error',
      message: 'external-write: path must be relative to the external/ folder'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the resolved path escapes the external root via ".."', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { a: 'b' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    assert.throws(() => writeExternal(`..${sep}outside.txt`, 'x', env), {
      name: 'Error',
      message: `external-write: ..${sep}outside.txt resolves outside ${dir} \u2014 refusing to write`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when residual tokens survive the map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { foo: 'foo' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    assert.throws(() => writeExternal('file.txt', 'foo bar', env), {
      name: 'Error',
      message: 'external-write: 1 name(s) survived the name map (residual forms of foo) \u2014 refusing to write file.txt'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates intermediate directories recursively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { x: 'y' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    const result = writeExternal('a/b/c/d.txt', 'x', env);
    const written = readFileSync(result.path, 'utf8');
    assert.equal(written, 'y');
    const expectedPath = resolve(dir, 'a/b/c/d.txt');
    const expectedBytes = Buffer.byteLength('y');
    assert.deepEqual(result, { path: expectedPath, bytes: expectedBytes });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes to a nested path without pre-existing parent directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { a: 'b' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    const result = writeExternal('no/recursion.txt', 'a', env);
    const written = readFileSync(result.path, 'utf8');
    assert.equal(written, 'b');
    const expectedPath = resolve(dir, 'no/recursion.txt');
    const expectedBytes = Buffer.byteLength('b');
    assert.deepEqual(result, { path: expectedPath, bytes: expectedBytes });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when relPath is empty string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { a: 'b' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    assert.throws(() => writeExternal('', 'a', env), {
      name: 'Error',
      message: 'external-write: path must be relative to the external/ folder'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when relPath resolves to root (rel is empty string)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeExternal-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { a: 'b' } }));
    const env = { ...process.env, CW_EXTERNAL_ROOT: dir, CW_EXTERNAL_REDACTIONS: mapPath };
    assert.throws(() => writeExternal('.', 'a', env), {
      name: 'Error',
      message: 'external-write: . resolves outside ' + dir + ' \u2014 refusing to write'
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
