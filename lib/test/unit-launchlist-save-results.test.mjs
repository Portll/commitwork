// Persists a project results document to its launchlist JSON file (lib/launchlist.mjs saveResults).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveResults } from '../launchlist.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('writes the document as two-space JSON with a trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    saveResults('proj', { a: 1, b: [1, 2] });
    const p = join(dir, 'll', 'results', 'proj.json');
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"a\": 1,\n  \"b\": [\n    1,\n    2\n  ]\n}\n");
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates the results directory when it does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    saveResults('p2', { x: true });
    assert.equal(existsSync(join(dir, 'll', 'results', 'p2.json')), true);
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns undefined after writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    const r = saveResults('p3', { n: 0 });
    assert.equal(r, undefined);
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serializes nested objects with two-space indentation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    saveResults('deep', { o: { i: { v: 'x' } } });
    const p = join(dir, 'll', 'results', 'deep.json');
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"o\": {\n    \"i\": {\n      \"v\": \"x\"\n    }\n  }\n}\n");
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for a slug containing a dot-dot sequence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    assert.throws(() => saveResults('a..b', {}), { name: "Error", message: "launchlist: not a project slug: \"a..b\"" });
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for an empty slug', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    assert.throws(() => saveResults('', {}), { name: "Error", message: "launchlist: not a project slug: \"\"" });
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for a slug starting with a hyphen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    assert.throws(() => saveResults('-bad', {}), { name: "Error", message: "launchlist: not a project slug: \"-bad\"" });
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws for a slug longer than one hundred characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    const slug = 'a'.repeat(101);
    assert.throws(() => saveResults(slug, {}), { name: "Error", message: "launchlist: not a project slug: \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"" });
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a slug of exactly one hundred characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    const slug = 'a'.repeat(100);
    saveResults(slug, { ok: 1 });
    const p = join(dir, 'll', 'results', `${slug}.json`);
    assert.equal(existsSync(p), true);
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a slug of one character', () => {
  const dir = mkdtempSync(join(tmpdir(), 'saveResults-'));
  try {
    process.env.CW_LAUNCHLIST_DIR = join(dir, 'll');
    saveResults('z', { v: 42 });
    const p = join(dir, 'll', 'results', 'z.json');
    assert.equal(readFileSync(p, 'utf8'), "{\n  \"v\": 42\n}\n");
  } finally {
    delete process.env.CW_LAUNCHLIST_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
