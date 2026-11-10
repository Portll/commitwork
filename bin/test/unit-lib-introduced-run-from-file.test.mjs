// Reads a file as UTF-8 text, or reports it absent or unreadable (bin/lib/introduced-run.mjs fromFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromFile } from '../lib/introduced-run.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the file text when the file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fromFile-'));
  try {
    const p = join(dir, 'ok.txt');
    writeFileSync(p, 'hello world');
    assert.deepEqual(fromFile(p), { text: 'hello world' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the empty string as text for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fromFile-'));
  try {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '');
    assert.deepEqual(fromFile(p), { text: '' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns long multiline text unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fromFile-'));
  try {
    const p = join(dir, 'long.txt');
    const body = 'abc\n'.repeat(500);
    writeFileSync(p, body);
    assert.deepEqual(fromFile(p), { text: body });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent true when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fromFile-'));
  try {
    const p = join(dir, 'missing.txt');
    assert.deepEqual(fromFile(p), { absent: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns absent true when a parent directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fromFile-'));
  try {
    const p = join(dir, 'nope', 'missing.txt');
    assert.deepEqual(fromFile(p), { absent: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error naming EISDIR when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fromFile-'));
  try {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    assert.deepEqual(fromFile(sub), { error: `${sub} could not be read (EISDIR)` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error naming the code when the path contains a null byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fromFile-'));
  try {
    const p = join(dir, 'bad\0name.txt');
    assert.deepEqual(fromFile(p), { error: `${p} could not be read (ERR_INVALID_ARG_VALUE)` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
