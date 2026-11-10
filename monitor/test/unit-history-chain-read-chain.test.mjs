// Parsed events and torn-tail or corrupt status of a JSONL chain file (monitor/history-chain.mjs readChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChain } from '../history-chain.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CORRUPT = ' is not JSON \u2014 the log is corrupt from there and later lines cannot be trusted in order';

test('a missing chain file reports not present with no error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    assert.deepEqual(readChain(dir), { present: false, events: [], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a directory at the chain path reports not present with the EISDIR error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    mkdirSync(p);
    assert.deepEqual(readChain(dir), { present: false, events: [], tailTorn: false, error: `EISDIR reading ${p}`, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a custom file name is read instead of the default chain file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'other.jsonl');
    writeFileSync(join(dir, 'chain.jsonl'), '{"wrong":true}\n');
    writeFileSync(p, '{"a":1}\n');
    assert.deepEqual(readChain(dir, 'other.jsonl'), { present: true, events: [{ a: 1 }], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty file is present with no events and no error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    writeFileSync(p, '');
    assert.deepEqual(readChain(dir), { present: true, events: [], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('valid lines are parsed in order and blank lines are skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    writeFileSync(p, '\n{"a":1}\n\n{"b":2}\n\n');
    assert.deepEqual(readChain(dir), { present: true, events: [{ a: 1 }, { b: 2 }], tailTorn: false, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unparseable last line marks the tail torn and keeps the prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n{"c"');
    assert.deepEqual(readChain(dir), { present: true, events: [{ a: 1 }, { b: 2 }], tailTorn: true, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a single unparseable line is a torn tail with no events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    writeFileSync(p, 'garbage\n');
    assert.deepEqual(readChain(dir), { present: true, events: [], tailTorn: true, error: null, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unparseable second-to-last line is corruption and stops the read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    writeFileSync(p, '{"a":1}\nbad\n{"c":3}\n');
    assert.deepEqual(readChain(dir), { present: true, events: [{ a: 1 }], tailTorn: false, error: 'line 2 of 3' + CORRUPT, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unparseable first line is corruption and leaves no events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    writeFileSync(p, 'bad\n{"b":2}\n{"c":3}\n');
    assert.deepEqual(readChain(dir), { present: true, events: [], tailTorn: false, error: 'line 1 of 3' + CORRUPT, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blank lines are not counted in the corrupt line number or total', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readChain-'));
  try {
    const p = join(dir, 'chain.jsonl');
    writeFileSync(p, '{"a":1}\n\nbad\n\n{"c":3}\n{"d":4}\n');
    assert.deepEqual(readChain(dir), { present: true, events: [{ a: 1 }], tailTorn: false, error: 'line 2 of 4' + CORRUPT, path: p });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
