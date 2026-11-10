// Absolute paths of the relative modules a source file imports (bin/lib/lane-reuse.mjs localImports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localImports } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    assert.deepEqual(localImports(join(dir, 'nope.mjs')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when the path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    assert.deepEqual(localImports(sub), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves static relative import from same directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "import { x } from './b.mjs';\n");
    assert.deepEqual(localImports(file), [join(dir, 'b.mjs')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves static relative import from parent directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const file = join(sub, 'a.mjs');
    writeFileSync(file, "import { x } from '../b.mjs';\n");
    assert.deepEqual(localImports(file), [join(dir, 'b.mjs')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves dynamic import expression', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "const m = import('./c.mjs');\n");
    assert.deepEqual(localImports(file), [join(dir, 'c.mjs')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves bare side-effect import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "import './d.mjs';\n");
    assert.deepEqual(localImports(file), [join(dir, 'd.mjs')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves multiple imports in one file in source order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "import { x } from './b.mjs';\nimport './c.mjs';\nconst m = import('./d.mjs');\n");
    assert.deepEqual(localImports(file), [join(dir, 'b.mjs'), join(dir, 'c.mjs'), join(dir, 'd.mjs')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-relative imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "import { x } from 'node:fs';\nimport 'lodash';\n");
    assert.deepEqual(localImports(file), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores a specifier starting with three dots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "import x from '.../y.mjs';\n");
    assert.deepEqual(localImports(file), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolves export from relative path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'localImports-'));
  try {
    const file = join(dir, 'a.mjs');
    writeFileSync(file, "export { x } from './e.mjs';\n");
    assert.deepEqual(localImports(file), [join(dir, 'e.mjs')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
