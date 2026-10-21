// Reads a file and parses its JSON with prototype-pollution, size and depth guards (monitor/safe-parse.mjs safeParseFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeParseFile } from '../safe-parse.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parses a simple JSON object file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'a.json');
    writeFileSync(f, '{"x":1}');
    const r = safeParseFile(f);
    assert.equal(Object.getPrototypeOf(r), null);
    assert.equal(r.x, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses a JSON array file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'b.json');
    writeFileSync(f, '[1,2,3]');
    const r = safeParseFile(f);
    assert.deepEqual(r, [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses a JSON scalar file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'c.json');
    writeFileSync(f, '42');
    const r = safeParseFile(f);
    assert.equal(r, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a file containing a forbidden prototype key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'd.json');
    writeFileSync(f, '{"__proto__":{"x":1}}');
    assert.throws(() => safeParseFile(f), /forbidden key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a file whose nesting depth exceeds the default bound', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'e.json');
    const deep = '['.repeat(201) + ']' .repeat(201);
    writeFileSync(f, deep);
    assert.throws(() => safeParseFile(f), /nesting depth 201 exceeds 200/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a file whose nesting depth equals the default bound', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'f.json');
    const deep = '['.repeat(200) + ']' .repeat(200);
    writeFileSync(f, deep);
    const r = safeParseFile(f);
    assert.equal(r.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects a file whose size exceeds the maxBytes bound', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'g.json');
    writeFileSync(f, 'x'.repeat(10));
    assert.throws(() => safeParseFile(f, { maxBytes: 5 }), /exceeds 5B bound/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a file whose size equals the maxBytes bound', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'h.json');
    writeFileSync(f, '"xxxxx"');
    const r = safeParseFile(f, { maxBytes: 7 });
    assert.equal(r, 'xxxxx');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips the prototype chain from nested objects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'safeParseFile-'));
  try {
    const f = join(dir, 'i.json');
    writeFileSync(f, '{"a":{"b":2}}');
    const r = safeParseFile(f);
    assert.equal(Object.getPrototypeOf(r), null);
    assert.equal(Object.getPrototypeOf(r.a), null);
    assert.equal(r.a.b, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
