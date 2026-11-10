// Writes a JSON object to a path atomically via mkdir and writeAtomic (cra/lib.mjs writeJSONAtomic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeJSONAtomic } from '../lib.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('creates nested directories and writes formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'a', 'b', 'c.json');
    writeJSONAtomic(p, { x: 1 });
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"x\": 1\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes empty object as formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'empty.json');
    writeJSONAtomic(p, {});
    assert.equal(readFileSync(p, 'utf8'), "{}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes array with two elements as formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'arr.json');
    writeJSONAtomic(p, [1, 2]);
    assert.equal(readFileSync(p, 'utf8'), "[\n  1,\n  2\n]\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes object with nested structure as formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'nested.json');
    writeJSONAtomic(p, { a: { b: [1, 2, 3] }, c: 'x'.repeat(5) });
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"a\": {\n    \"b\": [\n      1,\n      2,\n      3\n    ]\n  },\n  \"c\": \"xxxxx\"\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes object with null and boolean values as formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'types.json');
    writeJSONAtomic(p, { n: null, b: true, s: 'hi' });
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"n\": null,\n  \"b\": true,\n  \"s\": \"hi\"\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes object with unicode characters as formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'uni.json');
    writeJSONAtomic(p, { msg: 'h\u00e9llo w\u00f6rld' });
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"msg\": \"h\u00e9llo w\u00f6rld\"\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes object with long repeated key as formatted JSON with trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'long.json');
    const key = 'k'.repeat(20);
    writeJSONAtomic(p, { [key]: 'v'.repeat(10) });
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"kkkkkkkkkkkkkkkkkkkk\": \"vvvvvvvvvv\"\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes object with numeric values including zero and negative as formatted JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeJSONAtomic-'));
  try {
    const p = join(dir, 'nums.json');
    writeJSONAtomic(p, { a: 0, b: -1, c: 1.5 });
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"a\": 0,\n  \"b\": -1,\n  \"c\": 1.5\n}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
