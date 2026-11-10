// Integrity state of each data store against its latest off-tree anchor (bin/lib/verdict-journal-core.mjs verifyDataAnchors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDataAnchors } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const anchorRow = (row) => ({ identity: `${row.sliceId}\0${row.source}`, hash: sha(JSON.stringify(row)).slice(0, 32) });

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'verifyDataAnchors-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const writeAnchors = (dir, records) => {
  const path = join(dir, 'anchors.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r) + '\n').join(''));
  return path;
};

test('a missing or recordless anchor file yields no-anchors', () => withDir((dir) => {
  assert.deepEqual(verifyDataAnchors({ path: join(dir, 'absent.jsonl') }), { state: 'no-anchors', results: [] });
  const torn = join(dir, 'torn.jsonl');
  writeFileSync(torn, 'not json\n');
  assert.deepEqual(verifyDataAnchors({ path: torn }), { state: 'no-anchors', results: [] });
}));

test('an anchor path that is a directory fails closed with the error code as detail', () => withDir((dir) => {
  const path = join(dir, 'anchors.jsonl');
  mkdirSync(path);
  assert.deepEqual(verifyDataAnchors({ path }), { state: 'anchors-unreadable', detail: 'EISDIR', results: [] });
}));

test('records of other kinds or without a file are ignored', () => withDir((dir) => {
  const path = writeAnchors(dir, [
    { kind: 'verdict-anchor', file: join(dir, 'missing.log'), storeClass: 'append-only', bytes: 1, sha256: sha('x') },
    { kind: 'data-anchor', storeClass: 'append-only', bytes: 1, sha256: sha('x') },
  ]);
  assert.deepEqual(verifyDataAnchors({ path }), { state: 'ok', results: [] });
}));

test('a later retired record supersedes the anchor and is reported without reading the file', () => withDir((dir) => {
  const file = join(dir, 'gone.log');
  const path = writeAnchors(dir, [
    { kind: 'data-anchor', file, storeClass: 'append-only', bytes: 3, sha256: sha('abc') },
    { kind: 'data-anchor-retired', file, storeClass: 'append-only', reason: 'migrated', at: '2024-01-01T00:00:00Z' },
  ]);
  assert.deepEqual(verifyDataAnchors({ path }), {
    state: 'ok',
    results: [{ file, storeClass: 'append-only', state: 'retired', reason: 'migrated', at: '2024-01-01T00:00:00Z' }],
  });
}));

test('append-only stores report intact, TRUNCATED one byte short, REWRITTEN at equal length, gone and unreadable', () => withDir((dir) => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((n) => join(dir, `${n}.log`));
  writeFileSync(a, 'abc');
  writeFileSync(b, 'ab');
  writeFileSync(c, 'abd');
  mkdirSync(e);
  const anchor = (file) => ({ kind: 'data-anchor', file, storeClass: 'append-only', bytes: 3, sha256: sha('abc') });
  const path = writeAnchors(dir, [a, b, c, d, e].map(anchor));
  assert.deepEqual(verifyDataAnchors({ path }), {
    state: 'ALARM',
    results: [
      { file: a, storeClass: 'append-only', state: 'intact', bytes: 3 },
      { file: b, storeClass: 'append-only', state: 'TRUNCATED', anchoredBytes: 3, bytes: 2 },
      { file: c, storeClass: 'append-only', state: 'REWRITTEN', anchoredBytes: 3, bytes: 3 },
      { file: d, storeClass: 'append-only', state: 'JOURNAL-GONE', anchoredBytes: 3 },
      { file: e, storeClass: 'append-only', state: 'unreadable', anchoredBytes: 3 },
    ],
  });
}));

test('rewritten stores report intact on a hash match and drift-report otherwise without alarming', () => withDir((dir) => {
  const same = join(dir, 'same.json');
  const shrunk = join(dir, 'shrunk.json');
  writeFileSync(same, '[1]');
  writeFileSync(shrunk, '[2]');
  const path = writeAnchors(dir, [
    { kind: 'data-anchor', file: same, storeClass: 'rewritten', bytes: 3, sha256: sha('[1]') },
    { kind: 'data-anchor', file: shrunk, storeClass: 'rewritten', bytes: 9, sha256: sha('[1, 2, 3]') },
  ]);
  assert.deepEqual(verifyDataAnchors({ path }), {
    state: 'ok',
    results: [
      { file: same, storeClass: 'rewritten', state: 'intact', bytes: 3 },
      { file: shrunk, storeClass: 'rewritten', state: 'drift-report', anchoredBytes: 9, bytes: 3 },
    ],
  });
}));

test('index stores report intact when rows match and intact-extended when rows were only added', () => withDir((dir) => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ sliceId: `s${i}`, source: 'src', n: i }));
  const [exact, grown, empty] = ['exact', 'grown', 'empty'].map((n) => join(dir, `${n}.json`));
  writeFileSync(exact, JSON.stringify(rows.slice(0, 2)));
  writeFileSync(grown, JSON.stringify(rows));
  writeFileSync(empty, '[]');
  const path = writeAnchors(dir, [
    { kind: 'data-anchor', file: exact, storeClass: 'index', rows: rows.slice(0, 2).map(anchorRow) },
    { kind: 'data-anchor', file: grown, storeClass: 'index', rows: rows.slice(0, 2).map(anchorRow) },
    { kind: 'data-anchor', file: empty, storeClass: 'index' },
  ]);
  assert.deepEqual(verifyDataAnchors({ path }), {
    state: 'ok',
    results: [
      { file: empty, storeClass: 'index', state: 'intact', anchoredRows: 0, rows: 0 },
      { file: exact, storeClass: 'index', state: 'intact', anchoredRows: 2, rows: 2 },
      { file: grown, storeClass: 'index', state: 'intact-extended', anchoredRows: 2, rows: 3 },
    ],
  });
}));

test('index stores alarm ROW-REMOVED on a missing identity and drift-report an upserted row', () => withDir((dir) => {
  const base = { sliceId: 's1', source: 'src', n: 1 };
  const other = { sliceId: 's2', source: 'src', n: 2 };
  const removed = join(dir, 'removed.json');
  const upserted = join(dir, 'upserted.json');
  writeFileSync(removed, JSON.stringify([base]));
  writeFileSync(upserted, JSON.stringify([{ ...base, n: 5 }, other]));
  const path = writeAnchors(dir, [
    { kind: 'data-anchor', file: removed, storeClass: 'index', rows: [base, other].map(anchorRow) },
    { kind: 'data-anchor', file: upserted, storeClass: 'index', rows: [base].map(anchorRow) },
  ]);
  assert.deepEqual(verifyDataAnchors({ path }), {
    state: 'ALARM',
    results: [
      { file: removed, storeClass: 'index', state: 'ROW-REMOVED', removed: 1, anchoredRows: 2, rows: 1 },
      { file: upserted, storeClass: 'index', state: 'drift-report', changed: 1, anchoredRows: 1, rows: 2 },
    ],
  });
}));

test('index stores that do not parse to an array read TRUNCATED when shorter, else unreadable', () => withDir((dir) => {
  const [p, q, r] = ['p', 'q', 'r'].map((n) => join(dir, `${n}.json`));
  writeFileSync(p, '{bad');
  writeFileSync(q, '{bad');
  writeFileSync(r, '{}');
  const path = writeAnchors(dir, [
    { kind: 'data-anchor', file: p, storeClass: 'index', bytes: 5, rows: [] },
    { kind: 'data-anchor', file: q, storeClass: 'index', bytes: 4, rows: [] },
    { kind: 'data-anchor', file: r, storeClass: 'index', bytes: 2, rows: [] },
  ]);
  assert.deepEqual(verifyDataAnchors({ path }), {
    state: 'ALARM',
    results: [
      { file: p, storeClass: 'index', state: 'TRUNCATED', anchoredBytes: 5, bytes: 4 },
      { file: q, storeClass: 'index', state: 'unreadable', detail: 'unparseable JSON' },
      { file: r, storeClass: 'index', state: 'unreadable', detail: 'not a JSON array' },
    ],
  });
}));
