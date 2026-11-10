// Aggregates comment stats by reason, file, and void status (admin/routes/comments.mjs summarize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../routes/comments.mjs';

test('returns zero counts and empty maps for empty items', () => {
  const c = { items: [], scanned: 0, files: 0, total: 0, saveable: 0 };
  const at = '2024-01-01T00:00:00Z';
  const r = summarize(c, at);
  assert.deepEqual(r, {
    at, scanned: 0, files: 0, blocks: 0,
    voids: 0, byReason: {}, candidates: 0, couldRemove: 0, topFiles: []
  });
});

test('counts void items by reason', () => {
  const c = {
    items: [
      { void: true, reason: 'dup', file: 'a.js' },
      { void: true, reason: 'dup', file: 'b.js' },
      { void: true, reason: 'stale', file: 'c.js' },
      { void: false, file: 'd.js' }
    ],
    scanned: 4, files: 4, total: 4, saveable: 2
  };
  const r = summarize(c, 't');
  assert.equal(r.voids, 3);
  assert.deepEqual(r.byReason, { dup: 2, stale: 1 });
  assert.equal(r.candidates, 1);
  assert.equal(r.couldRemove, 2);
});

test('aggregates blocks per file and sorts by count descending', () => {
  const c = {
    items: [
      { void: false, file: 'z.js' },
      { void: false, file: 'z.js' },
      { void: false, file: 'a.js' },
      { void: false, file: 'm.js' },
      { void: false, file: 'm.js' },
      { void: false, file: 'm.js' }
    ],
    scanned: 6, files: 3, total: 6, saveable: 0
  };
  const r = summarize(c, 't');
  assert.deepEqual(r.topFiles, [
    { file: 'm.js', blocks: 3 },
    { file: 'z.js', blocks: 2 },
    { file: 'a.js', blocks: 1 }
  ]);
});

test('breaks ties by file name ascending', () => {
  const c = {
    items: [
      { void: false, file: 'b.js' },
      { void: false, file: 'a.js' },
      { void: false, file: 'c.js' },
      { void: false, file: 'a.js' },
      { void: false, file: 'b.js' },
      { void: false, file: 'c.js' }
    ],
    scanned: 6, files: 3, total: 6, saveable: 0
  };
  const r = summarize(c, 't');
  assert.deepEqual(r.topFiles, [
    { file: 'a.js', blocks: 2 },
    { file: 'b.js', blocks: 2 },
    { file: 'c.js', blocks: 2 }
  ]);
});

test('limits topFiles to 10 entries', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    void: false, file: `f${i}.js`
  }));
  const c = { items, scanned: 12, files: 12, total: 12, saveable: 0 };
  const r = summarize(c, 't');
  assert.equal(r.topFiles.length, 10);
  assert.equal(r.blocks, 12);
});

test('computes candidates as total minus voids', () => {
  const c = {
    items: [
      { void: true, reason: 'x', file: 'a.js' },
      { void: true, reason: 'y', file: 'b.js' },
      { void: false, file: 'c.js' },
      { void: false, file: 'd.js' },
      { void: false, file: 'e.js' }
    ],
    scanned: 5, files: 5, total: 5, saveable: 1
  };
  const r = summarize(c, 't');
  assert.equal(r.voids, 2);
  assert.equal(r.candidates, 3);
  assert.equal(r.couldRemove, 1);
});

test('handles single item with void flag', () => {
  const c = {
    items: [{ void: true, reason: 'noise', file: 'only.js' }],
    scanned: 1, files: 1, total: 1, saveable: 1
  };
  const r = summarize(c, 't');
  assert.equal(r.voids, 1);
  assert.deepEqual(r.byReason, { noise: 1 });
  assert.equal(r.candidates, 0);
  assert.equal(r.couldRemove, 1);
  assert.deepEqual(r.topFiles, [{ file: 'only.js', blocks: 1 }]);
});

test('handles single non-void item', () => {
  const c = {
    items: [{ void: false, file: 'only.js' }],
    scanned: 1, files: 1, total: 1, saveable: 0
  };
  const r = summarize(c, 't');
  assert.equal(r.voids, 0);
  assert.deepEqual(r.byReason, {});
  assert.equal(r.candidates, 1);
  assert.equal(r.couldRemove, 0);
  assert.deepEqual(r.topFiles, [{ file: 'only.js', blocks: 1 }]);
});
