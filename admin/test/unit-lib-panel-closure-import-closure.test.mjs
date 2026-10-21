// Computes the transitive closure of relative imports from an entry file (admin/lib/panel-closure.mjs importClosure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importClosure } from '../lib/panel-closure.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty files and unknown when entry file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const entry = join(dir, 'missing.mjs');
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [], unknown: [{ file: entry, reason: 'ENOENT' }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the entry file when it has no imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const entry = join(dir, 'entry.mjs');
    writeFileSync(entry, 'const x = 1;\n');
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [entry], unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes a single relative import in the closure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const entry = join(dir, 'entry.mjs');
    const dep = join(dir, 'dep.mjs');
    writeFileSync(dep, 'export const y = 2;\n');
    writeFileSync(entry, `import { y } from './dep.mjs';\n`);
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [dep, entry].sort(), unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('follows transitive relative imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const entry = join(dir, 'entry.mjs');
    const mid = join(dir, 'mid.mjs');
    const leaf = join(dir, 'leaf.mjs');
    writeFileSync(leaf, 'export const z = 3;\n');
    writeFileSync(mid, `import { z } from './leaf.mjs';\nexport const m = z;\n`);
    writeFileSync(entry, `import { m } from './mid.mjs';\n`);
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [entry, mid, leaf].sort(), unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not follow non-relative imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const entry = join(dir, 'entry.mjs');
    writeFileSync(entry, `import { x } from 'node:fs';\n`);
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [entry], unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks a missing relative import as unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const entry = join(dir, 'entry.mjs');
    const missing = join(dir, 'missing.mjs');
    writeFileSync(entry, `import { x } from './missing.mjs';\n`);
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [entry], unknown: [{ file: missing, reason: 'ENOENT' }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles imports from a subdirectory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub, { recursive: true });
    const entry = join(dir, 'entry.mjs');
    const dep = join(sub, 'dep.mjs');
    writeFileSync(dep, 'export const y = 2;\n');
    writeFileSync(entry, `import { y } from './sub/dep.mjs';\n`);
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [dep, entry].sort(), unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles parent directory imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub, { recursive: true });
    const entry = join(sub, 'entry.mjs');
    const dep = join(dir, 'dep.mjs');
    writeFileSync(dep, 'export const y = 2;\n');
    writeFileSync(entry, `import { y } from '../dep.mjs';\n`);
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [dep, entry].sort(), unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates files that are imported multiple times', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const entry = join(dir, 'entry.mjs');
    const dep = join(dir, 'dep.mjs');
    writeFileSync(dep, 'export const y = 2;\n');
    writeFileSync(entry, `import { y } from './dep.mjs';\nimport { y as y2 } from './dep.mjs';\n`);
    const result = importClosure(entry);
    assert.deepEqual(result, { files: [dep, entry].sort(), unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles circular imports without infinite recursion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'importClosure-'));
  try {
    const a = join(dir, 'a.mjs');
    const b = join(dir, 'b.mjs');
    writeFileSync(a, `import { x } from './b.mjs';\nexport const a = 1;\n`);
    writeFileSync(b, `import { a } from './a.mjs';\nexport const x = 2;\n`);
    const result = importClosure(a);
    assert.deepEqual(result, { files: [a, b].sort(), unknown: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
