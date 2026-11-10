// Reads and validates the persistence baseline JSON file (monitor/persistence-diff.mjs readBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBaseline } from '../persistence-diff.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    process.env.CW_PERSIST_BASELINE = join(dir, 'missing.json');
    assert.equal(readBaseline(), null);
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when the file contains a valid baseline with items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baseline.json');
    writeFileSync(p, JSON.stringify({ items: [{ name: 'a' }] }));
    process.env.CW_PERSIST_BASELINE = p;
    assert.deepEqual(readBaseline(), { items: [{ name: "a" }] });
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not json');
    process.env.CW_PERSIST_BASELINE = p;
    assert.throws(() => readBaseline(), { name: "SyntaxError", message: "Expected property name or '}' in JSON at position 1 (line 1 column 2)" });
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed value is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    process.env.CW_PERSIST_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the parsed object has no items property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'noitems.json');
    writeFileSync(p, JSON.stringify({ foo: 1 }));
    process.env.CW_PERSIST_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when items is present but not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'baditems.json');
    writeFileSync(p, JSON.stringify({ items: 'notarray' }));
    process.env.CW_PERSIST_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed object when items is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'empty.json');
    writeFileSync(p, JSON.stringify({ items: [] }));
    process.env.CW_PERSIST_BASELINE = p;
    assert.deepEqual(readBaseline(), { items: [] });
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the file contains a JSON array instead of an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readBaseline-'));
  try {
    const p = join(dir, 'arr.json');
    writeFileSync(p, JSON.stringify([1, 2, 3]));
    process.env.CW_PERSIST_BASELINE = p;
    assert.throws(() => readBaseline(), { name: 'Error', message: 'baseline has no items[]' });
  } finally {
    delete process.env.CW_PERSIST_BASELINE;
    rmSync(dir, { recursive: true, force: true });
  }
});
