// Moves an issue's anchor and logs the move in a capped history (monitor/issue-store.mjs recordAnchor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAnchor } from '../issue-store.mjs';

const SEED_WHY = 'first recorded position (seeded from the live anchor)';
const entry = (i) => ({ at: `t${i}`, sliceId: null, file: 'a.js', line: i, hash: `h${i}`, why: `why${i}` });
const historyOf = (n) => Array.from({ length: n }, (_, i) => entry(i));

test('a missing next anchor or a fractional line returns false and leaves the issue untouched', () => {
  const iss = { anchor: { file: 'a.js', line: 1, hash: 'h1' } };
  assert.equal(recordAnchor(iss, null, { at: 't1' }), false);
  assert.deepEqual(iss, { anchor: { file: 'a.js', line: 1, hash: 'h1' } });
  assert.equal(recordAnchor(iss, { file: 'b.js', line: 1.5, hash: 'h2' }, { at: 't1' }), false);
  assert.deepEqual(iss, { anchor: { file: 'a.js', line: 1, hash: 'h1' } });
});

test('an unchanged file, line and hash replaces the anchor but returns false and writes no history', () => {
  const iss = { anchor: { file: 'a.js', line: 4, hash: 'h4', col: 1 } };
  assert.equal(recordAnchor(iss, { file: 'a.js', line: 4, hash: 'h4', col: 9 }, { at: 't1' }), false);
  assert.deepEqual(iss, { anchor: { file: 'a.js', line: 4, hash: 'h4', col: 9 } });
});

test('a first anchor on line zero is recorded alone with default slice, reason and null hash', () => {
  const iss = {};
  assert.equal(recordAnchor(iss, { file: 'a.js', line: 0 }, { at: 't1' }), true);
  assert.deepEqual(iss, {
    anchor: { file: 'a.js', line: 0 },
    anchorHistory: [{ at: 't1', sliceId: null, file: 'a.js', line: 0, hash: null, why: 'observed' }],
  });
});

test('a move with no usable history seeds it from the previous anchor before the new entry', () => {
  const iss = { anchor: { file: 'a.js', line: 1 }, anchorHistory: 'not-an-array' };
  const r = recordAnchor(iss, { file: 'a.js', line: 2, hash: 'h2' }, { at: 't1', sliceId: 's1', why: 'moved' });
  assert.equal(r, true);
  assert.deepEqual(iss.anchor, { file: 'a.js', line: 2, hash: 'h2' });
  assert.deepEqual(iss.anchorHistory, [
    { at: 't1', sliceId: 's1', file: 'a.js', line: 1, hash: null, why: SEED_WHY },
    { at: 't1', sliceId: 's1', file: 'a.js', line: 2, hash: 'h2', why: 'moved' },
  ]);
});

test('a previous anchor without an integer line is not seeded into empty history', () => {
  const iss = { anchor: { file: 'a.js', line: null, hash: 'h' }, anchorHistory: [] };
  assert.equal(recordAnchor(iss, { file: 'a.js', line: 2, hash: 'h' }, { at: 't1' }), true);
  assert.deepEqual(iss.anchorHistory, [
    { at: 't1', sliceId: null, file: 'a.js', line: 2, hash: 'h', why: 'observed' },
  ]);
});

test('a move with existing history appends one entry and does not seed again', () => {
  const iss = { anchor: { file: 'a.js', line: 0, hash: 'h0' }, anchorHistory: historyOf(1) };
  assert.equal(recordAnchor(iss, { file: 'a.js', line: 1, hash: 'h1' }, { at: 't1', why: 'why1' }), true);
  assert.deepEqual(iss.anchorHistory, historyOf(2));
});

test('a different file or a different hash on the same line counts as movement', () => {
  const byFile = { anchor: { file: 'a.js', line: 5, hash: 'h5' } };
  assert.equal(recordAnchor(byFile, { file: 'b.js', line: 5, hash: 'h5' }, { at: 't1' }), true);
  assert.deepEqual(byFile.anchorHistory, [
    { at: 't1', sliceId: null, file: 'a.js', line: 5, hash: 'h5', why: SEED_WHY },
    { at: 't1', sliceId: null, file: 'b.js', line: 5, hash: 'h5', why: 'observed' },
  ]);
  const byHash = { anchor: { file: 'a.js', line: 5, hash: 'h5' } };
  assert.equal(recordAnchor(byHash, { file: 'a.js', line: 5, hash: 'h6' }, { at: 't2' }), true);
  assert.deepEqual(byHash.anchorHistory, [
    { at: 't2', sliceId: null, file: 'a.js', line: 5, hash: 'h5', why: SEED_WHY },
    { at: 't2', sliceId: null, file: 'a.js', line: 5, hash: 'h6', why: 'observed' },
  ]);
});

test('history that reaches exactly twelve entries keeps every entry unannotated', () => {
  const iss = { anchor: { file: 'a.js', line: 10, hash: 'h10' }, anchorHistory: historyOf(11) };
  assert.equal(recordAnchor(iss, { file: 'a.js', line: 11, hash: 'h11' }, { at: 't11', why: 'why11' }), true);
  assert.deepEqual(iss.anchorHistory, historyOf(12));
});

test('thirteen entries keep the first and newest eleven and note one drop on the second entry', () => {
  const iss = { anchor: { file: 'a.js', line: 11, hash: 'h11' }, anchorHistory: historyOf(12) };
  assert.equal(recordAnchor(iss, { file: 'a.js', line: 12, hash: 'h12' }, { at: 't12', why: 'why12' }), true);
  assert.deepEqual(iss.anchorHistory, [
    entry(0),
    { ...entry(2), why: 'why2 \u00b7 1 earlier position(s) dropped at the 12-entry cap' },
    ...Array.from({ length: 10 }, (_, i) => entry(i + 3)),
  ]);
});

test('fifteen entries keep the first and newest eleven and note three drops on the second entry', () => {
  const iss = { anchor: { file: 'a.js', line: 13, hash: 'h13' }, anchorHistory: historyOf(14) };
  assert.equal(recordAnchor(iss, { file: 'a.js', line: 14, hash: 'h14' }, { at: 't14', why: 'why14' }), true);
  assert.deepEqual(iss.anchorHistory, [
    entry(0),
    { ...entry(4), why: 'why4 \u00b7 3 earlier position(s) dropped at the 12-entry cap' },
    ...Array.from({ length: 10 }, (_, i) => entry(i + 5)),
  ]);
});
