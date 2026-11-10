// Parses the calibrate baseline JSON file, null when absent, error object otherwise (bin/lib/verdict-journal-core.mjs readCalibrateBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCalibrateBaseline } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed object when the file contains valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readCalibrateBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ gate: 'v1', tests: 'v2' }));
    assert.deepEqual(readCalibrateBaseline(p), { gate: 'v1', tests: 'v2' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readCalibrateBaseline-'));
  try {
    const p = join(dir, 'missing.json');
    assert.equal(readCalibrateBaseline(p), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error object with the parse message when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readCalibrateBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not valid json');
    assert.deepEqual(readCalibrateBaseline(p), {
      _error: true,
      message: "Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error object with the read message when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readCalibrateBaseline-'));
  try {
    const sub = join(dir, 'adir');
    mkdirSync(sub);
    writeFileSync(join(sub, 'x'), 'x');
    let msg;
    try {
      readFileSync(sub, 'utf8');
    } catch (e) {
      msg = e.message;
    }
    assert.deepEqual(readCalibrateBaseline(sub), { _error: true, message: msg });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed array when the file contains a JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readCalibrateBaseline-'));
  try {
    const p = join(dir, 'arr.json');
    writeFileSync(p, JSON.stringify(Array.from({ length: 3 }, (_, i) => i + 1)));
    assert.deepEqual(readCalibrateBaseline(p), [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the parent directory of the path is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readCalibrateBaseline-'));
  try {
    const p = join(dir, 'no-such-dir', 'file.json');
    assert.equal(readCalibrateBaseline(p), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error object when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readCalibrateBaseline-'));
  try {
    const p = join(dir, 'empty.json');
    writeFileSync(p, '');
    let msg;
    try {
      JSON.parse('');
    } catch (e) {
      msg = e.message;
    }
    assert.deepEqual(readCalibrateBaseline(p), { _error: true, message: msg });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
