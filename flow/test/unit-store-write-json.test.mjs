// Pretty-printed JSON text plus trailing newline written atomically to path (flow/store.mjs writeJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeJson } from '../store.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('writes a flat object with two-space indentation and a trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const target = join(dir, 'a.json');
    const r = writeJson(target, { x: 1 });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "x": 1\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates missing nested parent directories before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const target = join(dir, 'deep', 'nested', 'file.json');
    const r = writeJson(target, { ok: true });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "ok": true\n}\n');
    assert.deepEqual(readdirSync(join(dir, 'deep')), ['nested']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes into an already existing parent directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const target = join(dir, 'ret.json');
    const r = writeJson(target, [1, 2, 3]);
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '[\n  1,\n  2,\n  3\n]\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indents nested objects by two spaces per level', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const target = join(dir, 'nested.json');
    const r = writeJson(target, { a: { b: { c: 1 } } });
    assert.equal(r, target);
    assert.equal(
      readFileSync(target, 'utf8'),
      '{\n  "a": {\n    "b": {\n      "c": 1\n    }\n  }\n}\n',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overwrites an existing file and leaves no tmp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const target = join(dir, 'o.json');
    writeFileSync(target, 'old contents');
    const r = writeJson(target, { k: 'v' });
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), '{\n  "k": "v"\n}\n');
    assert.deepEqual(readdirSync(dir), ['o.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes null as the text null followed by a newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const target = join(dir, 'null.json');
    const r = writeJson(target, null);
    assert.equal(r, target);
    assert.equal(readFileSync(target, 'utf8'), 'null\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes empty object and empty array without inner whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const objPath = join(dir, 'empty.json');
    const arrPath = join(dir, 'emptyarr.json');
    assert.equal(writeJson(objPath, {}), objPath);
    assert.equal(writeJson(arrPath, []), arrPath);
    assert.equal(readFileSync(objPath, 'utf8'), '{}\n');
    assert.equal(readFileSync(arrPath, 'utf8'), '[]\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes a string and a boolean as JSON scalars with a newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const strPath = join(dir, 'str.json');
    const boolPath = join(dir, 'bool.json');
    assert.equal(writeJson(strPath, 'hello'), strPath);
    assert.equal(writeJson(boolPath, false), boolPath);
    assert.equal(readFileSync(strPath, 'utf8'), '"hello"\n');
    assert.equal(readFileSync(boolPath, 'utf8'), 'false\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indents an array of objects inside an object by two spaces per level', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJson-'));
  try {
    const target = join(dir, 'list.json');
    const items = Array.from({ length: 2 }, (_, i) => ({ id: i }));
    const r = writeJson(target, { items });
    assert.equal(r, target);
    assert.equal(
      readFileSync(target, 'utf8'),
      '{\n  "items": [\n    {\n      "id": 0\n    },\n    {\n      "id": 1\n    }\n  ]\n}\n',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
