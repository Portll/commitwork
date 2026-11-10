// Byte count, sha256 and index row hashes of a data store, journaled as an anchor record (bin/lib/verdict-journal-core.mjs anchorDataStore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorDataStore } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'anchorDataStore-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function firstAnchor(path) {
  const rec = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]);
  delete rec.at;
  return rec;
}

test('a missing store returns ok false with the ENOENT code and writes no anchor', () => withDir((dir) => {
  const file = join(dir, 'missing.json');
  const anchors = join(dir, 'anchors.jsonl');
  const r = anchorDataStore(file, 'append-only', { path: anchors });
  assert.deepEqual(r, { ok: false, file, storeClass: 'append-only', error: 'ENOENT' });
  assert.equal(existsSync(anchors), false);
}));

test('an unreadable store returns ok false with the EACCES code', () => withDir((dir) => {
  const file = join(dir, 'locked.json');
  writeFileSync(file, 'x', { mode: 0o000 });
  const r = anchorDataStore(file, 'append-only', { path: join(dir, 'anchors.jsonl') });
  assert.deepEqual(r, { ok: false, file, storeClass: 'append-only', error: 'EACCES' });
}));

test('a read error without a code reports the bare error message', () => withDir((dir) => {
  const boom = new Error('boom');
  const file = { get href() { throw boom; }, valueOf() { throw boom; }, toString() { throw boom; } };
  const r = anchorDataStore(file, 'index', { path: join(dir, 'anchors.jsonl') });
  assert.deepEqual(r, { ok: false, file, storeClass: 'index', error: 'boom' });
}));

test('an append-only store journals its byte count and sha256 with a genesis prev', () => withDir((dir) => {
  const file = join(dir, 'data.jsonl');
  const anchors = join(dir, 'anchors.jsonl');
  writeFileSync(file, 'hello world');
  const r = anchorDataStore(file, 'append-only', { path: anchors });
  assert.deepEqual(r, { ok: true, file, storeClass: 'append-only', bytes: 11, rows: undefined });
  assert.deepEqual(firstAnchor(anchors), {
    v: 1, kind: 'data-anchor', file, storeClass: 'append-only', bytes: 11, sha256: sha('hello world'), prev: 'genesis',
  });
}));

test('an append-only store counts bytes not characters and records no rows for a JSON array', () => withDir((dir) => {
  const file = join(dir, 'data.json');
  const anchors = join(dir, 'anchors.jsonl');
  const text = JSON.stringify(['\u00e9'.repeat(3)]);
  writeFileSync(file, text);
  const r = anchorDataStore(file, 'append-only', { path: anchors });
  assert.deepEqual(r, { ok: true, file, storeClass: 'append-only', bytes: 10, rows: undefined });
  assert.deepEqual(firstAnchor(anchors), {
    v: 1, kind: 'data-anchor', file, storeClass: 'append-only', bytes: 10, sha256: sha(text), prev: 'genesis',
  });
}));

test('an index store hashes each row under its sliceId and source identity', () => withDir((dir) => {
  const file = join(dir, 'index.json');
  const anchors = join(dir, 'anchors.jsonl');
  const text = JSON.stringify([{ sliceId: 's0', source: 'src0' }, { sliceId: 's1' }, null]);
  writeFileSync(file, text);
  const r = anchorDataStore(file, 'index', { path: anchors });
  assert.deepEqual(r, { ok: true, file, storeClass: 'index', bytes: 56, rows: 3 });
  assert.deepEqual(firstAnchor(anchors), {
    v: 1, kind: 'data-anchor', file, storeClass: 'index', bytes: 56, sha256: sha(text),
    rows: [
      { identity: 's0\u0000src0', hash: sha('{"sliceId":"s0","source":"src0"}').slice(0, 32) },
      { identity: 's1\u0000', hash: sha('{"sliceId":"s1"}').slice(0, 32) },
      { identity: '\u0000', hash: sha('null').slice(0, 32) },
    ],
    prev: 'genesis',
  });
}));

test('an index store holding an empty array reports zero rows', () => withDir((dir) => {
  const file = join(dir, 'index.json');
  const anchors = join(dir, 'anchors.jsonl');
  writeFileSync(file, '[]');
  const r = anchorDataStore(file, 'index', { path: anchors });
  assert.deepEqual(r, { ok: true, file, storeClass: 'index', bytes: 2, rows: 0 });
  assert.deepEqual(firstAnchor(anchors), {
    v: 1, kind: 'data-anchor', file, storeClass: 'index', bytes: 2, sha256: sha('[]'), rows: [], prev: 'genesis',
  });
}));

test('an index store holding a JSON object or invalid JSON records no rows', () => withDir((dir) => {
  const objAnchors = join(dir, 'obj-anchors.jsonl');
  const badAnchors = join(dir, 'bad-anchors.jsonl');
  const obj = join(dir, 'object.json');
  const bad = join(dir, 'bad.json');
  writeFileSync(obj, JSON.stringify({ not: 'an array' }));
  writeFileSync(bad, '[not json');
  const r1 = anchorDataStore(obj, 'index', { path: objAnchors });
  const r2 = anchorDataStore(bad, 'index', { path: badAnchors });
  assert.deepEqual(r1, { ok: true, file: obj, storeClass: 'index', bytes: 18, rows: undefined });
  assert.deepEqual(r2, { ok: true, file: bad, storeClass: 'index', bytes: 9, rows: undefined });
  assert.equal('rows' in firstAnchor(objAnchors), false);
  assert.equal('rows' in firstAnchor(badAnchors), false);
}));

test('a rewritten store returns its byte count and journals no rows', () => withDir((dir) => {
  const file = join(dir, 'rollup.json');
  const anchors = join(dir, 'anchors.jsonl');
  writeFileSync(file, 'rewritten content');
  const r = anchorDataStore(file, 'rewritten', { path: anchors });
  assert.deepEqual(r, { ok: true, file, storeClass: 'rewritten', bytes: 17, rows: undefined });
  assert.deepEqual(firstAnchor(anchors), {
    v: 1, kind: 'data-anchor', file, storeClass: 'rewritten', bytes: 17, sha256: sha('rewritten content'), prev: 'genesis',
  });
}));

test('a failed anchor append returns ok false with the append error code', () => withDir((dir) => {
  const file = join(dir, 'rollup.json');
  const anchors = join(dir, 'anchors');
  mkdirSync(anchors);
  writeFileSync(file, 'abc');
  const r = anchorDataStore(file, 'rewritten', { path: anchors });
  assert.deepEqual(r, { ok: false, file, storeClass: 'rewritten', bytes: 3, rows: undefined, error: 'EISDIR' });
}));
