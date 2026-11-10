// Reads a JSON file from a root directory and returns a result object with ok, value, absent, and error fields (bin/lib/docsite-figures.mjs readSource).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../lib/docsite-figures.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('readSource returns parsed JSON when file exists and contains valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'data.json';
    writeFileSync(join(dir, rel), '{"key":"value"}', 'utf8');
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: true, value: { key: "value" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns absent true when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'missing.json';
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: false, absent: true, error: "missing.json is absent" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns error with code when read fails with non-ENOENT error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'noperm.json';
    writeFileSync(join(dir, rel), '{}', 'utf8');
    chmodSync(join(dir, rel), 0o000);
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: false, absent: false, error: "noperm.json could not be read (EACCES)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns error when file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'bad.json';
    writeFileSync(join(dir, rel), 'not json', 'utf8');
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: false, absent: false, error: "bad.json is not readable JSON: Unexpected token 'o', \"not json\" is not valid JSON" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns parsed JSON for empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'empty.json';
    writeFileSync(join(dir, rel), '{}', 'utf8');
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: true, value: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns parsed JSON for empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'array.json';
    writeFileSync(join(dir, rel), '[]', 'utf8');
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: true, value: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns error for file with only whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'whitespace.json';
    writeFileSync(join(dir, rel), '   ', 'utf8');
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: false, absent: false, error: "whitespace.json is not readable JSON: Unexpected end of JSON input" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns error for file with trailing comma', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'trailing.json';
    writeFileSync(join(dir, rel), '{"a":1,}', 'utf8');
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: false, absent: false, error: "trailing.json is not readable JSON: Expected double-quoted property name in JSON at position 7 (line 1 column 8)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns parsed JSON for nested object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'nested.json';
    writeFileSync(join(dir, rel), '{"outer":{"inner":42}}', 'utf8');
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: true, value: { outer: { inner: 42 } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readSource returns error when path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSource-'));
  try {
    const rel = 'adir';
    mkdirSync(join(dir, rel));
    const result = readSource(dir, rel);
    assert.deepEqual(result, { ok: false, absent: false, error: "adir could not be read (EISDIR)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
