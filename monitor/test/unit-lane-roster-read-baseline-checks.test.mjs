// The checks array from a baseline JSON file, or null when the file is missing (monitor/lane-roster.mjs readBaselineChecks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaselineChecks } from '../lane-roster.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    const p = join(dir, 'missing.json');
    const r = readBaselineChecks(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the checks array when the baseline file contains a valid checks array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ checks: [{ id: 'a' }, { id: 'b' }] }));
    const r = readBaselineChecks(p);
    assert.deepEqual(r, [{ id: 'a' }, { id: 'b' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the checks array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    const p = join(dir, 'empty.json');
    writeFileSync(p, JSON.stringify({ checks: [] }));
    const r = readBaselineChecks(p);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the baseline file has no checks property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    const p = join(dir, 'nochecks.json');
    writeFileSync(p, JSON.stringify({ foo: 1 }));
    assert.throws(() => readBaselineChecks(p), { name: 'Error', message: `${p}: no checks array` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the checks property is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    const p = join(dir, 'notarray.json');
    writeFileSync(p, JSON.stringify({ checks: 'nope' }));
    assert.throws(() => readBaselineChecks(p), { name: 'Error', message: `${p}: no checks array` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws the no checks array error when the document is JSON null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    assert.throws(() => readBaselineChecks(p), { name: 'Error', message: `${p}: no checks array` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the parse error when the baseline file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    assert.throws(() => readBaselineChecks(p), {
      name: 'SyntaxError',
      message: "Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rethrows the read error when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaselineChecks-'));
  try {
    assert.throws(() => readBaselineChecks(dir), {
      name: 'Error',
      code: 'EISDIR',
      message: 'EISDIR: illegal operation on a directory, read',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
