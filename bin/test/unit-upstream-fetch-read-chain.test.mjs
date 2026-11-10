// Reads a JSONL chain file, parsing events and detecting torn tails (bin/upstream-fetch.mjs readChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChain } from '../upstream-fetch.mjs';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('returns present false and null error when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'missing.jsonl');
    const r = readChain(p);
    assert.deepEqual(r, { present: false, events: [], tailTorn: false, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present false and error message when file is unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'secret.jsonl');
    writeFileSync(p, 'x');
    chmodSync(p, 0o000);
    const r = readChain(p);
    assert.equal(r.present, false);
    assert.equal(r.error, 'EACCES reading ' + p);
    assert.equal(r.tailTorn, false);
    assert.deepEqual(r.events, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present true with empty events and no tail torn for empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    const r = readChain(p);
    assert.deepEqual(r, { present: true, events: [], tailTorn: false, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns all parsed events when all lines are valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'valid.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n{"c":3}\n');
    const r = readChain(p);
    assert.deepEqual(r, { present: true, events: [{ a: 1 }, { b: 2 }, { c: 3 }], tailTorn: false, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets tailTorn true when last line is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'torn.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\nbroken');
    const r = readChain(p);
    assert.deepEqual(r, { present: true, events: [{ a: 1 }, { b: 2 }], tailTorn: true, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets error message when a middle line is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'corrupt.jsonl');
    writeFileSync(p, '{"a":1}\nbroken\n{"c":3}\n');
    const r = readChain(p);
    assert.equal(r.present, true);
    assert.deepEqual(r.events, [{ a: 1 }]);
    assert.equal(r.tailTorn, false);
    assert.equal(r.error, 'line 2 of 3 is not JSON \u2014 the log is corrupt from there');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets error message when first line is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'firstbad.jsonl');
    writeFileSync(p, 'notjson\n{"b":2}\n');
    const r = readChain(p);
    assert.equal(r.present, true);
    assert.deepEqual(r.events, []);
    assert.equal(r.tailTorn, false);
    assert.equal(r.error, 'line 1 of 2 is not JSON \u2014 the log is corrupt from there');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles single line that is valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'single.jsonl');
    writeFileSync(p, '{"x":99}\n');
    const r = readChain(p);
    assert.deepEqual(r, { present: true, events: [{ x: 99 }], tailTorn: false, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles single line that is invalid JSON as tail torn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'singlebad.jsonl');
    writeFileSync(p, 'garbage\n');
    const r = readChain(p);
    assert.deepEqual(r, { present: true, events: [], tailTorn: true, error: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
