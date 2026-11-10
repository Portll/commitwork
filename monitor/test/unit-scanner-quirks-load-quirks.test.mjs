// Loads and caches the scanner quirks manifest (monitor/scanner-quirks.mjs loadQuirks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadQuirks } from '../scanner-quirks.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadQuirks-'));
  try {
    const p = join(dir, 'nope.json');
    const r = loadQuirks({ path: p });
    assert.deepEqual(r, { version: 0, quirks: [], state: "absent" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state with the parse error message for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadQuirks-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    const r = loadQuirks({ path: p });
    assert.deepEqual(r, { version: 0, quirks: [], state: "unreadable", error: "Expected property name or '}' in JSON at position 2 (line 1 column 3)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns malformed state when the quirks field is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadQuirks-'));
  try {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify({ version: 3, quirks: 'nope' }));
    const r = loadQuirks({ path: p });
    assert.deepEqual(r, { version: 0, quirks: [], state: "malformed" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with the parsed document when quirks is an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadQuirks-'));
  try {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ version: 7, quirks: [{ id: 'a' }], extra: 1 }));
    const r = loadQuirks({ path: p });
    assert.deepEqual(r, { version: 7, quirks: [{ id: "a" }], extra: 1, state: "present" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the cached object when the same path is requested again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadQuirks-'));
  try {
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({ version: 2, quirks: [] }));
    const first = loadQuirks({ path: p });
    const second = loadQuirks({ path: p });
    assert.deepStrictEqual(second, { version: 2, quirks: [], state: "present" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a fresh parse when a different path is requested after a cache hit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadQuirks-'));
  try {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, JSON.stringify({ version: 1, quirks: [] }));
    writeFileSync(b, JSON.stringify({ version: 9, quirks: [{ id: 'z' }] }));
    loadQuirks({ path: a });
    const r = loadQuirks({ path: b });
    assert.deepEqual(r, { version: 9, quirks: [{ id: "z" }], state: "present" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
