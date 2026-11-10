// Reads and parses a JSON file into an absent or present state record (flow/store.mjs readJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../store.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('A missing file yields the absent state with null data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'missing.json');
    const r = readJson(p);
    assert.deepEqual(r, { state: 'absent', data: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A valid JSON object file yields the present state with the parsed object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'data.json');
    writeFileSync(p, JSON.stringify({ a: 1, b: 'two' }));
    const r = readJson(p);
    assert.deepEqual(r, { state: 'present', data: { a: 1, b: 'two' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A valid JSON array file yields the present state with the parsed array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'arr.json');
    writeFileSync(p, JSON.stringify(Array.from({ length: 3 }, (_, i) => i + 1)));
    const r = readJson(p);
    assert.deepEqual(r, { state: 'present', data: [1, 2, 3] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A directory path throws the unreadable error naming the EISDIR code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'subdir');
    mkdirSync(p);
    assert.throws(() => readJson(p), {
      name: 'Error',
      message: `flow store unreadable ${p}: EISDIR`,
      code: 'CW_FLOW_STORE_UNREADABLE',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A path beneath a regular file throws the unreadable error naming the ENOTDIR code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const f = join(dir, 'plain.json');
    writeFileSync(f, '{}');
    const p = join(f, 'inner.json');
    assert.throws(() => readJson(p), {
      name: 'Error',
      message: `flow store unreadable ${p}: ENOTDIR`,
      code: 'CW_FLOW_STORE_UNREADABLE',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A file with invalid JSON throws the corrupt error with the parser message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not valid json');
    assert.throws(() => readJson(p), {
      name: 'Error',
      message: `flow store corrupt ${p}: Expected property name or '}' in JSON at position 1 (line 1 column 2)`,
      code: 'CW_FLOW_STORE_CORRUPT',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A missing file inside missing directories yields the absent state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'deep', 'nested', 'file.json');
    const r = readJson(p);
    assert.deepEqual(r, { state: 'absent', data: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A file containing JSON null yields the present state with null data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    const r = readJson(p);
    assert.deepEqual(r, { state: 'present', data: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A file containing a JSON number yields the present state with that number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJson-'));
  try {
    const p = join(dir, 'num.json');
    writeFileSync(p, '42');
    const r = readJson(p);
    assert.deepEqual(r, { state: 'present', data: 42 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
