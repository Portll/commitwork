// Go module directories under a root plus directories left unexplored at the depth limit (bin/lib/go-modules.mjs walkGoModules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkGoModules } from '../lib/go-modules.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'walkGoModules-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function goMod(dir, ...parts) {
  mkdirSync(join(dir, ...parts), { recursive: true });
  writeFileSync(join(dir, ...parts, 'go.mod'), 'module m\n');
}

test('An empty, missing, or file root yields no modules and nothing unexplored', () => {
  withTmp((dir) => {
    assert.deepEqual(walkGoModules(dir), { modules: [], unexplored: [] });
    assert.deepEqual(walkGoModules(join(dir, 'missing')), { modules: [], unexplored: [] });
    writeFileSync(join(dir, 'f.txt'), 'x');
    assert.deepEqual(walkGoModules(join(dir, 'f.txt')), { modules: [], unexplored: [] });
  });
});

test('A root holding a go.mod file is listed as a module', () => {
  withTmp((dir) => {
    goMod(dir);
    assert.deepEqual(walkGoModules(dir), { modules: [dir], unexplored: [] });
  });
});

test('Ordinary files and a directory named go.mod do not make a module', () => {
  withTmp((dir) => {
    writeFileSync(join(dir, 'main.go'), 'package main\n');
    mkdirSync(join(dir, 'go.mod'));
    assert.deepEqual(walkGoModules(dir), { modules: [], unexplored: [] });
  });
});

test('Skip-listed and dot-prefixed directories are not searched', () => {
  withTmp((dir) => {
    const names = ['.git', 'vendor', 'node_modules', 'testdata', 'reports', 'reference', '.hidden', 'src'];
    for (const n of names) goMod(dir, n);
    assert.deepEqual(walkGoModules(dir), { modules: [join(dir, 'src')], unexplored: [] });
  });
});

test('Modules are listed in code-unit order so uppercase names come first', () => {
  withTmp((dir) => {
    goMod(dir, 'beta');
    goMod(dir, 'alpha');
    goMod(dir, 'Zeta');
    assert.deepEqual(walkGoModules(dir), {
      modules: [join(dir, 'Zeta'), join(dir, 'alpha'), join(dir, 'beta')],
      unexplored: [],
    });
  });
});

test('The default depth limit of 4 checks a depth-4 directory but leaves its subdirectories unexplored', () => {
  withTmp((dir) => {
    goMod(dir, 'a', 'b', 'c', 'd', 'e');
    goMod(dir, 'a', 'b', 'c', 'd');
    const d = join(dir, 'a', 'b', 'c', 'd');
    assert.deepEqual(walkGoModules(dir), { modules: [d], unexplored: [d] });
  });
});

test('At maxDepth 2 only depth-2 directories that still have subdirectories are unexplored', () => {
  withTmp((dir) => {
    mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true });
    goMod(dir, 'x', 'y');
    assert.deepEqual(walkGoModules(dir, 2), {
      modules: [join(dir, 'x', 'y')],
      unexplored: [join(dir, 'a', 'b')],
    });
  });
});

test('At maxDepth 0 only the root is checked and it is unexplored only when it has subdirectories', () => {
  withTmp((dir) => {
    const p = join(dir, 'p');
    const q = join(dir, 'q');
    goMod(dir, 'p');
    goMod(dir, 'p', 'a');
    goMod(dir, 'q');
    assert.deepEqual(walkGoModules(p, 0), { modules: [p], unexplored: [p] });
    assert.deepEqual(walkGoModules(q, 0), { modules: [q], unexplored: [] });
  });
});
