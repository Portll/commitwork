// Computes language counts and non-metrics tags from a query database file (bin/joern-lane.mjs readQueryDb).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readQueryDb } from '../joern-lane.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const r = readQueryDb(join(dir, 'nope.json'));
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the parsed value is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'null.json');
    writeFileSync(p, 'null');
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the parsed value is a number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'num.json');
    writeFileSync(p, '42');
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the parsed object has no queries property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'noq.json');
    writeFileSync(p, JSON.stringify({ foo: 1 }));
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the queries array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'empty.json');
    writeFileSync(p, JSON.stringify({ queries: [] }));
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the parsed value is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'str.json');
    writeFileSync(p, JSON.stringify('hello'));
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the parsed value is a boolean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'bool.json');
    writeFileSync(p, JSON.stringify(true));
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the parsed value is an empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'obj.json');
    writeFileSync(p, JSON.stringify({}));
    const r = readQueryDb(p);
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns language counts and tags for a valid queries array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readQueryDb-'));
  try {
    const p = join(dir, 'ok.json');
    const data = {
      queries: [
        { language: 'java', tags: ['metrics', 'security'] },
        { language: 'python', tags: ['security', 'perf'] },
        { language: 'java', tags: [] },
        { language: 'python', tags: ['metrics'] },
        { language: 'c', tags: ['metrics', 'security'] }
      ]
    };
    writeFileSync(p, JSON.stringify(data));
    const r = readQueryDb(p);
    assert.deepEqual(r, { languages: { c: 1, java: 2, python: 2 }, tags: ["perf", "security"], names: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
