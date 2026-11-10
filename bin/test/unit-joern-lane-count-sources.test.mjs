// Per-frontend source file counts and unreadable directories under a root (bin/joern-lane.mjs countSources).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSources } from '../joern-lane.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'countSources-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const none = () => false;
const zeros = { c: 0, java: 0, kotlin: 0, php: 0 };

test('An empty directory gives zero for every frontend and no unreadable paths', () => {
  withDir((dir) => {
    assert.deepEqual(countSources(dir, none), { counts: zeros, unreadable: [] });
  });
});

test('Files are counted by their last extension case-insensitively and other files are ignored', () => {
  withDir((dir) => {
    const names = ['a.c', 'b.HPP', 'c.java', 'd.kt', 'e.kts', 'f.php', 'g.txt', 'h.c.txt', 'i.txt.php', 'Makefile'];
    for (const name of names) writeFileSync(join(dir, name), '');
    mkdirSync(join(dir, 'pkg.c'));
    writeFileSync(join(dir, 'pkg.c', 'inner.c'), '');
    assert.deepEqual(countSources(dir, none), {
      counts: { c: 3, java: 1, kotlin: 2, php: 2 },
      unreadable: [],
    });
  });
});

test('A file whose only dot is at index 0 is not counted', () => {
  withDir((dir) => {
    writeFileSync(join(dir, '.c'), '');
    writeFileSync(join(dir, '.php'), '');
    assert.deepEqual(countSources(dir, none), { counts: zeros, unreadable: [] });
  });
});

test('A one-character base name with the dot at index 1 is counted', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'a.java'), '');
    writeFileSync(join(dir, 'ab.kt'), '');
    assert.deepEqual(countSources(dir, none), {
      counts: { c: 0, java: 1, kotlin: 1, php: 0 },
      unreadable: [],
    });
  });
});

test('Excluded subdirectories are not descended into and the excluder sees root-relative paths', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'keep', 'inner'), { recursive: true });
    mkdirSync(join(dir, 'skip'));
    writeFileSync(join(dir, 'top.php'), '');
    writeFileSync(join(dir, 'keep', 'y.java'), '');
    writeFileSync(join(dir, 'keep', 'inner', 'z.kt'), '');
    writeFileSync(join(dir, 'skip', 'x.c'), '');
    const seen = [];
    const r = countSources(dir, (rel) => {
      seen.push(rel);
      return rel === 'skip';
    });
    assert.deepEqual(r, { counts: { c: 0, java: 1, kotlin: 1, php: 1 }, unreadable: [] });
    assert.deepEqual(seen.sort(), ['keep', join('keep', 'inner'), 'skip']);
  });
});

test('Symbolic links are neither counted nor followed', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'real.c'), '');
    symlinkSync('real.c', join(dir, 'alias.java'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'deep.php'), '');
    symlinkSync('sub', join(dir, 'subalias.kt'));
    assert.deepEqual(countSources(dir, none), {
      counts: { c: 1, java: 0, kotlin: 0, php: 1 },
      unreadable: [],
    });
  });
});

test('A missing root is skipped without being reported as unreadable', () => {
  withDir((dir) => {
    assert.deepEqual(countSources(join(dir, 'missing'), none), { counts: zeros, unreadable: [] });
  });
});

test('A root that is a file is reported as the unreadable path "."', () => {
  withDir((dir) => {
    const file = join(dir, 'root.c');
    writeFileSync(file, '');
    assert.deepEqual(countSources(file, none), { counts: zeros, unreadable: ['.'] });
  });
});
