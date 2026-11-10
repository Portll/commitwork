// The sorted set of a file and every local module it imports, followed transitively (bin/lib/lane-reuse.mjs localImportClosure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localImportClosure } from '../lib/lane-reuse.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'localImportClosure-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(dir, name, src) {
  const p = join(dir, name);
  writeFileSync(p, src);
  return p;
}

test('a file importing a local module with from yields both files sorted', () => {
  withDir((dir) => {
    const a = write(dir, 'a.mjs', "import { y } from './b.mjs';\nexport const x = 1;\n");
    write(dir, 'b.mjs', 'export const y = 2;\n');
    assert.deepEqual(localImportClosure(a), [join(dir, 'a.mjs'), join(dir, 'b.mjs')]);
  });
});

test('a missing file yields only its own resolved path', () => {
  withDir((dir) => {
    assert.deepEqual(localImportClosure(join(dir, 'missing.mjs')), [join(dir, 'missing.mjs')]);
  });
});

test('a file with no local imports yields only itself', () => {
  withDir((dir) => {
    const a = write(dir, 'a.mjs', 'export const x = 1;\n');
    assert.deepEqual(localImportClosure(a), [join(dir, 'a.mjs')]);
  });
});

test('a literal dynamic import is followed', () => {
  withDir((dir) => {
    const a = write(dir, 'a.mjs', "const m = import('./b.mjs');\nexport const x = 1;\n");
    write(dir, 'b.mjs', 'export const y = 2;\n');
    assert.deepEqual(localImportClosure(a), [join(dir, 'a.mjs'), join(dir, 'b.mjs')]);
  });
});

test('a side-effect import is followed', () => {
  withDir((dir) => {
    const a = write(dir, 'a.mjs', "import './b.mjs';\nexport const x = 1;\n");
    write(dir, 'b.mjs', 'export const y = 2;\n');
    assert.deepEqual(localImportClosure(a), [join(dir, 'a.mjs'), join(dir, 'b.mjs')]);
  });
});

test('circular imports are visited once each', () => {
  withDir((dir) => {
    const a = write(dir, 'a.mjs', "import { y } from './b.mjs';\nexport const x = 1;\n");
    write(dir, 'b.mjs', "import { x } from './a.mjs';\nexport const y = 2;\n");
    assert.deepEqual(localImportClosure(a), [join(dir, 'a.mjs'), join(dir, 'b.mjs')]);
  });
});

test('imports into a subdirectory and back to the parent are followed', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sub'));
    const a = write(dir, 'a.mjs', "import { y } from './sub/b.mjs';\n");
    write(dir, join('sub', 'b.mjs'), "import '../c.mjs';\nexport const y = 2;\n");
    write(dir, 'c.mjs', 'export const z = 3;\n');
    assert.deepEqual(localImportClosure(a), [
      join(dir, 'a.mjs'),
      join(dir, 'c.mjs'),
      join(dir, 'sub', 'b.mjs'),
    ]);
  });
});

test('bare package imports are ignored', () => {
  withDir((dir) => {
    const a = write(dir, 'a.mjs', "import { x } from 'some-package';\nimport 'node:fs';\nexport const y = 1;\n");
    assert.deepEqual(localImportClosure(a), [join(dir, 'a.mjs')]);
  });
});

test('results are sorted rather than in visit order', () => {
  withDir((dir) => {
    const z = write(dir, 'z.mjs', "import './a.mjs';\n");
    write(dir, 'a.mjs', 'export const y = 1;\n');
    assert.deepEqual(localImportClosure(z), [join(dir, 'a.mjs'), join(dir, 'z.mjs')]);
  });
});

test('a shared dependency appears once and a missing import target is kept', () => {
  withDir((dir) => {
    const a = write(dir, 'a.mjs', "import './b.mjs';\nimport './c.mjs';\nimport './gone.mjs';\n");
    write(dir, 'b.mjs', "export { k } from './c.mjs';\n");
    write(dir, 'c.mjs', 'export const k = 1;\n');
    assert.deepEqual(localImportClosure(a), [
      join(dir, 'a.mjs'),
      join(dir, 'b.mjs'),
      join(dir, 'c.mjs'),
      join(dir, 'gone.mjs'),
    ]);
  });
});
