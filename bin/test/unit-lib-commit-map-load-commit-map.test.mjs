// Parses a commit map file into an old-to-new sha Map with its row count (bin/lib/commit-map.mjs loadCommitMap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCommitMap } from '../lib/commit-map.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a missing commit map file gives ok false with the rebuild hint at the given path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'missing.txt');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    const reason = `no commit map at ${p} \u2014 run \`node bin/resolve-sha.mjs --rebuild\` while the old objects are still in the object store`;
    assert.deepEqual(r, { ok: false, path: p, reason });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a path that is a directory gives ok false with the EISDIR read error code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.d');
    mkdirSync(p);
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: false, path: p, reason: `commit map at ${p} could not be read: EISDIR` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty file is ok with an empty map and zero rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.txt');
    writeFileSync(p, '');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: true, path: p, map: new Map(), rows: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file of only comments and blank lines is ok with zero rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.txt');
    writeFileSync(p, '# only comments\n\n# old new\n');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: true, path: p, map: new Map(), rows: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pairs are parsed while blank and comment lines are skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.txt');
    writeFileSync(p, 'obj1 new1\n\n# comment line\nobj2 new2\n');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: true, path: p, map: new Map([['obj1', 'new1'], ['obj2', 'new2']]), rows: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a line with only an old sha and no new sha is skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.txt');
    writeFileSync(p, 'obj1\nobj2 new2\n');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: true, path: p, map: new Map([['obj2', 'new2']]), rows: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extra tokens are ignored and tabs or repeated spaces separate the pair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.txt');
    writeFileSync(p, 'obj1  new1  extra\nobj2\tnew2\r\n');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: true, path: p, map: new Map([['obj1', 'new1'], ['obj2', 'new2']]), rows: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hash is a comment only at column zero and whitespace-only lines add nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.txt');
    writeFileSync(p, '  a1 b1\n   \n  # x y\n');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: true, path: p, map: new Map([['a1', 'b1'], ['#', 'x']]), rows: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a repeated old sha keeps the last new sha and counts as one row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadCommitMap-'));
  try {
    const p = join(dir, 'map.txt');
    writeFileSync(p, 'a b\na c\n');
    const r = loadCommitMap(join(dir, 'repo'), { path: p });
    assert.deepEqual(r, { ok: true, path: p, map: new Map([['a', 'c']]), rows: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
