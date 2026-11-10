// Reads and parses the lattice attributes JSON file (bin/taxonomy-lattice.mjs loadAttributes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAttributes } from '../taxonomy-lattice.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parses a valid attributes file into an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  try {
    const p = join(dir, 'attrs.json');
    writeFileSync(p, JSON.stringify({ a: 1, b: [2, 3] }));
    const r = loadAttributes(p);
    assert.deepEqual(r, { a: 1, b: [2, 3] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a no encoding file error when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  try {
    const p = join(dir, 'missing.json');
    assert.throws(() => loadAttributes(p), {
      name: 'Error',
      message: `lattice: no encoding file at ${p}`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a cannot read error when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  try {
    const p = join(dir, 'subdir');
    mkdirSync(p);
    assert.throws(() => loadAttributes(p), {
      name: 'Error',
      message: `lattice: cannot read ${p}: EISDIR: illegal operation on a directory, read`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a syntax error when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ invalid json');
    assert.throws(() => loadAttributes(p), { name: 'SyntaxError' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses an empty object file into an empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  try {
    const p = join(dir, 'empty.json');
    writeFileSync(p, '{}');
    const r = loadAttributes(p);
    assert.deepEqual(r, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses a file with unicode content into the same object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  try {
    const p = join(dir, 'uni.json');
    writeFileSync(p, JSON.stringify({ name: 'caf\u00e9', count: 42 }));
    const r = loadAttributes(p);
    assert.deepEqual(r, { name: 'caf\u00e9', count: 42 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the CW_LATTICE_ATTRS path when no argument is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  const prev = process.env.CW_LATTICE_ATTRS;
  try {
    const p = join(dir, 'env.json');
    const list = Array.from({ length: 5 }, (_, i) => i);
    writeFileSync(p, JSON.stringify({ list }));
    process.env.CW_LATTICE_ATTRS = p;
    const r = loadAttributes();
    assert.deepEqual(r, { list: [0, 1, 2, 3, 4] });
  } finally {
    if (prev === undefined) delete process.env.CW_LATTICE_ATTRS;
    else process.env.CW_LATTICE_ATTRS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a no encoding file error for a missing CW_LATTICE_ATTRS path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAttributes-'));
  const prev = process.env.CW_LATTICE_ATTRS;
  try {
    const p = join(dir, 'nope.json');
    process.env.CW_LATTICE_ATTRS = p;
    assert.throws(() => loadAttributes(), {
      name: 'Error',
      message: `lattice: no encoding file at ${p}`
    });
  } finally {
    if (prev === undefined) delete process.env.CW_LATTICE_ATTRS;
    else process.env.CW_LATTICE_ATTRS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
