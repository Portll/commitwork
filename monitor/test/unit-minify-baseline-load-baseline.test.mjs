// Loads a minify baseline JSON file, validating shape and schema, returning an empty baseline on failure (monitor/minify-baseline.mjs loadBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBaseline } from '../minify-baseline.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty baseline with unreadable flag for null JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, 'null');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [], _unreadable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty baseline with unreadable flag for missing repos property', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, '{"version":1}');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [], _unreadable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty baseline with unreadable flag for non-object repos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, '{"version":1,"repos":"str"}');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [], _unreadable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty baseline with unreadable flag for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, 'not json');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [], _unreadable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty baseline for missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'missing.json');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed baseline with version 2 and empty journal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, '{"version":2,"repos":{"a":1}}');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [], _unreadable: true, _schemaErrors: ["schema: (root): required key 'journal' is missing", "schema: repos.a: expected object, got number"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed baseline with default version 1 and empty repos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, '{"repos":null}');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [], _unreadable: true, _schemaErrors: ["schema: (root): required key 'version' is missing", "schema: (root): required key 'journal' is missing", "schema: repos: expected object, got null"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns parsed baseline with journal array preserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'b.json');
    writeFileSync(p, '{"version":1,"repos":{},"journal":["x","y"]}');
    const r = loadBaseline(p);
    assert.deepEqual(r, { version: 1, repos: {}, journal: [], _unreadable: true, _schemaErrors: ["schema: journal[0]: expected object, got string", "schema: journal[1]: expected object, got string"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
