// Which relative imports are broken now or would break HEAD once committed (bin/worktree-imports.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../worktree-imports.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMPORT_B = "import { b } from './b.mjs';\n";
const EMPTY = { brokenNow: [], wouldBreakHead: [], stagedDeletion: [], unreadable: [] };

function withDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'classify-'));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return fn(dir, {
      read: (f) => readFileSync(join(dir, f), 'utf8'),
      exists: (f) => existsSync(join(dir, f)),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('A file that cannot be read is listed as unreadable with its error code.', () => {
  withDir({}, (dir, io) => {
    const r = classify(['gone.mjs'], { index: new Set(['gone.mjs']), head: new Set() }, io);
    assert.deepEqual(r, { ...EMPTY, unreadable: [{ file: 'gone.mjs', reason: 'ENOENT' }] });
  });
});

test('A read error without a code is listed as unreadable with its string form.', () => {
  withDir({}, (dir) => {
    const read = (f) => { if (f === 'x.mjs') throw new Error('boom'); throw 'nope'; };
    const r = classify(['x.mjs', 'y.mjs'], { index: new Set(), head: new Set() }, { read, exists: () => true });
    assert.deepEqual(r, {
      ...EMPTY,
      unreadable: [{ file: 'x.mjs', reason: 'Error: boom' }, { file: 'y.mjs', reason: 'nope' }],
    });
  });
});

test('An indexed file importing an untracked file on disk would break HEAD.', () => {
  withDir({ 'a.mjs': IMPORT_B, 'b.mjs': '' }, (dir, io) => {
    const r = classify(['a.mjs'], { index: new Set(['a.mjs']), head: new Set() }, io);
    assert.deepEqual(r, { ...EMPTY, wouldBreakHead: [{ file: 'a.mjs', spec: './b.mjs', target: 'b.mjs' }] });
  });
});

test('A file only in HEAD importing an untracked file on disk would break HEAD.', () => {
  withDir({ 'a.mjs': IMPORT_B, 'b.mjs': '' }, (dir, io) => {
    const r = classify(['a.mjs'], { index: new Set(), head: new Set(['a.mjs']) }, io);
    assert.deepEqual(r, { ...EMPTY, wouldBreakHead: [{ file: 'a.mjs', spec: './b.mjs', target: 'b.mjs' }] });
  });
});

test('An untracked file importing another untracked file on disk reports nothing.', () => {
  withDir({ 'a.mjs': IMPORT_B, 'b.mjs': '' }, (dir, io) => {
    const r = classify(['a.mjs'], { index: new Set(), head: new Set() }, io);
    assert.deepEqual(r, EMPTY);
  });
});

test('A tracked file importing a file that is in the index reports nothing.', () => {
  withDir({ 'a.mjs': IMPORT_B, 'b.mjs': '' }, (dir, io) => {
    const r = classify(['a.mjs'], { index: new Set(['a.mjs', 'b.mjs']), head: new Set(['a.mjs']) }, io);
    assert.deepEqual(r, EMPTY);
  });
});

test('A tracked file importing a file in HEAD but removed from the index is a staged deletion.', () => {
  withDir({ 'a.mjs': IMPORT_B, 'b.mjs': '' }, (dir, io) => {
    const r = classify(['a.mjs'], { index: new Set(['a.mjs']), head: new Set(['a.mjs', 'b.mjs']) }, io);
    assert.deepEqual(r, { ...EMPTY, stagedDeletion: [{ file: 'a.mjs', spec: './b.mjs', target: 'b.mjs' }] });
  });
});

test('An import with no candidate on disk is broken now even for an untracked importer.', () => {
  withDir({ 'a.mjs': "import { m } from './missing.mjs';\n" }, (dir, io) => {
    const calls = [];
    const exists = (p) => { calls.push(p); return io.exists(p); };
    const r = classify(['a.mjs'], { index: new Set(), head: new Set() }, { read: io.read, exists });
    assert.deepEqual(r, { ...EMPTY, brokenNow: [{ file: 'a.mjs', spec: './missing.mjs', candidates: calls }] });
  });
});
