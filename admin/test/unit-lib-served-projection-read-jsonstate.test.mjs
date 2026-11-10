// Reads a JSON file and reports its parse status (admin/lib/served-projection.mjs readJSONState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJSONState } from '../lib/served-projection.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const missing = join(dir, 'nope.json');
    const result = readJSONState(missing);
    assert.deepEqual(result, { state: 'absent' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with parsed data for valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const file = join(dir, 'data.json');
    const payload = { name: 'test', value: 42 };
    writeFileSync(file, JSON.stringify(payload), 'utf8');
    const result = readJSONState(file);
    assert.deepEqual(result, { state: 'ok', data: payload });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with parse detail for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{invalid json', 'utf8');
    const result = readJSONState(file);
    assert.deepEqual(result, { state: 'unreadable', detail: 'parse' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with error code for permission denied', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const file = join(dir, 'secret.json');
    writeFileSync(file, '{}', 'utf8');
    const result = readJSONState(join(dir, 'nonexistent-subdir', 'file.json'));
    assert.deepEqual(result, { state: 'absent' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with error code when path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    const result = readJSONState(sub);
    assert.equal(result.state, 'unreadable');
    assert.equal(result.detail, 'EISDIR');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state for empty JSON object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const file = join(dir, 'empty.json');
    writeFileSync(file, '{}', 'utf8');
    const result = readJSONState(file);
    assert.deepEqual(result, { state: 'ok', data: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state for JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const file = join(dir, 'arr.json');
    const arr = Array.from({ length: 5 }, (_, i) => i);
    writeFileSync(file, JSON.stringify(arr), 'utf8');
    const result = readJSONState(file);
    assert.deepEqual(result, { state: 'ok', data: arr });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable with parse detail for truncated JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJSONState-'));
  try {
    const file = join(dir, 'trunc.json');
    const long = 'x'.repeat(100);
    writeFileSync(file, `{"key": "${long}`, 'utf8');
    const result = readJSONState(file);
    assert.deepEqual(result, { state: 'unreadable', detail: 'parse' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
