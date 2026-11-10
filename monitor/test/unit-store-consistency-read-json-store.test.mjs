// Parsed contents of a JSON file, or an unknown marker saying why not (monitor/store-consistency.mjs readJsonStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonStore } from '../store-consistency.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a missing file yields an absent unknown carrying the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonStore-'));
  try {
    const p = join(dir, 'missing.json');
    const result = readJsonStore(p);
    assert.deepEqual(result, { unknown: true, unknownReason: 'absent', unknownDetail: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory path yields a not-permitted unknown with the error code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonStore-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    const result = readJsonStore(sub);
    assert.deepEqual(result, { unknown: true, unknownReason: 'not-permitted', unknownDetail: `${sub}: EISDIR` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a whitespace-only file yields an empty unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonStore-'));
  try {
    const p = join(dir, 'blank.json');
    writeFileSync(p, '   \n\t  ');
    const result = readJsonStore(p);
    assert.deepEqual(result, { unknown: true, unknownReason: 'empty', unknownDetail: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a zero-byte file yields an empty unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonStore-'));
  try {
    const p = join(dir, 'zero.json');
    writeFileSync(p, '');
    const result = readJsonStore(p);
    assert.deepEqual(result, { unknown: true, unknownReason: 'empty', unknownDetail: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a single digit surrounded by whitespace parses as ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonStore-'));
  try {
    const p = join(dir, 'digit.json');
    writeFileSync(p, '  0 \n');
    const result = readJsonStore(p);
    assert.deepEqual(result, { ok: true, value: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a valid JSON object parses as ok with the parsed value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonStore-'));
  try {
    const p = join(dir, 'data.json');
    writeFileSync(p, '{"a":1,"b":[2,3]}');
    const result = readJsonStore(p);
    assert.deepEqual(result, { ok: true, value: { a: 1, b: [2, 3] } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid JSON yields an unparseable unknown with the parser message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJsonStore-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not json');
    const result = readJsonStore(p);
    assert.deepEqual(result, {
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `${p}: Expected property name or '}' in JSON at position 1 (line 1 column 2)`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
