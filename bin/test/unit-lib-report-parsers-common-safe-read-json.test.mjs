// Parses a JSON file, returning null on any read or parse failure (bin/lib/report-parsers/common.mjs safeReadJSON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReadJSON } from '../lib/report-parsers/common.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed object for a valid JSON file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'valid.json');
    writeFileSync(file, '{"a":1,"b":[2,3]}', 'utf8');
    assert.deepEqual(safeReadJSON(file), { a: 1, b: [2, 3] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'missing.json');
    assert.equal(safeReadJSON(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{not json', 'utf8');
    assert.equal(safeReadJSON(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed array for a valid JSON array file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'arr.json');
    writeFileSync(file, '[10,20,30]', 'utf8');
    assert.deepEqual(safeReadJSON(file), [10, 20, 30]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the path points to a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub, { recursive: true });
    assert.equal(safeReadJSON(sub), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed string for a valid JSON string file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'str.json');
    writeFileSync(file, '"hello"', 'utf8');
    assert.equal(safeReadJSON(file), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file contains a JSON number with trailing garbage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'num.json');
    writeFileSync(file, '123abc', 'utf8');
    assert.equal(safeReadJSON(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed boolean for a valid JSON boolean file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'bool.json');
    writeFileSync(file, 'true', 'utf8');
    assert.equal(safeReadJSON(file), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'empty.json');
    writeFileSync(file, '', 'utf8');
    assert.equal(safeReadJSON(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed null for a file containing the JSON null literal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeReadJSON-'));
  try {
    const file = join(dir, 'null.json');
    writeFileSync(file, 'null', 'utf8');
    assert.equal(safeReadJSON(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
