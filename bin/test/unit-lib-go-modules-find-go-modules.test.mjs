// Directories containing a go.mod file, walked up to a depth limit (bin/lib/go-modules.mjs findGoModules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGoModules } from '../lib/go-modules.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'findGoModules-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns an empty array when no directory contains go.mod', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sub'));
    assert.deepEqual(findGoModules(dir), []);
  });
});

test('returns an empty array when the root does not exist', () => {
  withDir((dir) => {
    assert.deepEqual(findGoModules(join(dir, 'missing')), []);
  });
});

test('returns the root path when the root contains go.mod', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'go.mod'), 'module test');
    assert.deepEqual(findGoModules(dir), [dir]);
  });
});

test('finds the root before a nested module one level down', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'go.mod'), 'module root');
    mkdirSync(join(dir, 'pkg'));
    writeFileSync(join(dir, 'pkg', 'go.mod'), 'module pkg');
    assert.deepEqual(findGoModules(dir), [dir, join(dir, 'pkg')]);
  });
});

test('finds a module exactly at the default depth of four', () => {
  withDir((dir) => {
    const d4 = join(dir, 'a', 'b', 'c', 'd');
    mkdirSync(d4, { recursive: true });
    writeFileSync(join(d4, 'go.mod'), 'module deep');
    assert.deepEqual(findGoModules(dir), [d4]);
  });
});

test('does not find a module at depth five with the default depth', () => {
  withDir((dir) => {
    const d5 = join(dir, 'a', 'b', 'c', 'd', 'e');
    mkdirSync(d5, { recursive: true });
    writeFileSync(join(d5, 'go.mod'), 'module deeper');
    assert.deepEqual(findGoModules(dir), []);
  });
});

test('finds a module at depth one with maxDepth one but not at depth two', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'x', 'y'), { recursive: true });
    writeFileSync(join(dir, 'x', 'go.mod'), 'module x');
    writeFileSync(join(dir, 'x', 'y', 'go.mod'), 'module y');
    assert.deepEqual(findGoModules(dir, 1), [join(dir, 'x')]);
  });
});

test('skips vendor and hidden directories', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'vendor'));
    writeFileSync(join(dir, 'vendor', 'go.mod'), 'module vendored');
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, '.hidden', 'go.mod'), 'module hidden');
    assert.deepEqual(findGoModules(dir), []);
  });
});

test('ignores a directory named go.mod as a module marker', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'go.mod'));
    assert.deepEqual(findGoModules(dir), []);
  });
});

test('returns modules in code-unit order of directory names', () => {
  withDir((dir) => {
    for (const name of ['zeta', 'alpha', 'Zed']) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, 'go.mod'), 'module ' + name);
    }
    assert.deepEqual(findGoModules(dir), [join(dir, 'Zed'), join(dir, 'alpha'), join(dir, 'zeta')]);
  });
});
