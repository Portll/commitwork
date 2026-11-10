// Sealed archive of batch report files plus a self-describing manifest (monitor/archive-batches.mjs buildArchive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArchive } from '../archive-batches.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const KEY = Buffer.alloc(32, 1);
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

function withDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'buildArchive-'));
  try {
    for (const [rel, data] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), data);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function counter() {
  const state = { calls: 0 };
  state.anchors = {
    toJSON() {
      state.calls++;
      if (state.calls > 12) throw new Error('runaway resealing');
      return 'a';
    },
  };
  return state;
}

const shape = (r) => r.manifest.entries.map((e) => ({ path: e.path, size: e.size }));
const one = (anchors) => [{ name: 'b1', area: 'east', manifest: { anchors } }];

test('a raw build lists every file of every batch with its size, its anchors and the secret-bearing count', () => {
  withDir({ 'b1/gitleaks.json': '{"a":1}', 'b1/notes.txt': 'hi there', 'b2/sub/x.txt': 'xyz', 'b3/z.txt': 'z' }, (root) => {
    const r = buildArchive({ root, key: KEY, now: NOW, batches: [
      { name: 'b1', area: 'east', manifest: { anchors: ['r1'] } },
      { name: 'b2', area: 'west', manifest: { repos: ['r2'] } },
      { name: 'b3', area: 'north', manifest: {} },
    ] });
    assert.equal(r.manifest.v, 1);
    assert.equal(r.manifest.fidelity, 'raw');
    assert.equal(r.manifest.redaction, null);
    assert.equal(r.manifest.secretBearingFiles, 1);
    assert.equal(r.entryCount, 4);
    assert.deepEqual(shape(r), [
      { path: 'b1/gitleaks.json', size: 7 },
      { path: 'b1/notes.txt', size: 8 },
      { path: 'b2/sub/x.txt', size: 3 },
      { path: 'b3/z.txt', size: 1 },
    ]);
    assert.deepEqual(r.manifest.batches, [
      { batch: 'b1', area: 'east', files: 2, anchors: ['r1'] },
      { batch: 'b2', area: 'west', files: 1, anchors: ['r2'] },
      { batch: 'b3', area: 'north', files: 1, anchors: null },
    ]);
  });
});

test('a redacted build rewrites parseable JSON and records every file it could not redact', () => {
  let why;
  try { JSON.parse('{oops'); } catch (e) { why = `unparseable (${e.message.slice(0, 60)})`; }
  withDir({ 'b1/notes.txt': 'hi there', 'b1/secret-bad.json': '{oops', 'b1/secret-list.json': '[ 1, 2 ]' }, (root) => {
    const r = buildArchive({ root, key: KEY, now: NOW, redact: true, batches: one(['r1']) });
    assert.equal(r.manifest.fidelity, 'redacted');
    assert.equal(r.manifest.secretBearingFiles, 2);
    assert.equal(r.entryCount, 3);
    assert.deepEqual(shape(r), [
      { path: 'b1/notes.txt', size: 8 },
      { path: 'b1/secret-bad.json', size: 5 },
      { path: 'b1/secret-list.json', size: 5 },
    ]);
    assert.deepEqual(r.manifest.redaction, {
      fields: ['Secret', 'Match', 'Raw', 'RawV2', 'snippet'],
      notRedacted: [
        { path: 'b1/notes.txt', why: 'not a JSON-shaped report', secretBearing: false },
        { path: 'b1/secret-bad.json', why, secretBearing: true },
      ],
    });
  });
});

test('no batches at all yields a manifest that lists nothing and counts zero secret-bearing files', () => {
  withDir({}, (root) => {
    const r = buildArchive({ root, key: KEY, now: NOW, batches: [] });
    assert.equal(r.entryCount, 0);
    assert.deepEqual(r.manifest.entries, []);
    assert.deepEqual(r.manifest.batches, []);
    assert.equal(r.manifest.secretBearingFiles, 0);
    assert.equal(r.manifest.fidelity, 'raw');
    assert.equal(r.manifest.redaction, null);
    assert.equal(r.manifest.v, 1);
  });
});

test('a symlink inside a batch is skipped and only the regular file is archived', () => {
  withDir({ 'b1/a.txt': 'abc' }, (root) => {
    symlinkSync('a.txt', join(root, 'b1', 'link'));
    const r = buildArchive({ root, key: KEY, now: NOW, batches: one(['r1']) });
    assert.equal(r.entryCount, 1);
    assert.deepEqual(shape(r), [{ path: 'b1/a.txt', size: 3 }]);
    assert.deepEqual(r.manifest.batches, [{ batch: 'b1', area: 'east', files: 1, anchors: ['r1'] }]);
    assert.equal(r.manifest.secretBearingFiles, 0);
  });
});

test('omitting the level seals exactly as many bytes as an explicit level of 3', () => {
  const vocab = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
  let x = 7;
  const text = Array.from({ length: 120000 }, () => { x = (x * 48271) % 2147483647; return vocab[x % 10] + (x % 97); }).join(' ');
  withDir({ 'b1/data.txt': text }, (root) => {
    const args = { root, key: KEY, now: NOW, batches: one(['r1']) };
    const a = buildArchive(args);
    const b = buildArchive({ ...args, level: 3 });
    assert.deepEqual(a.manifest, b.manifest);
    assert.equal(a.buf.length, b.buf.length);
  });
});

test('a frame count that already matches on the second seal stops after exactly two seals', () => {
  const s = counter();
  withDir({ 'b1/a.txt': 'x' }, (root) => {
    const r = buildArchive({ root, key: KEY, now: NOW, batches: one(s.anchors) });
    assert.equal(s.calls, 2);
    assert.equal(r.entryCount, 1);
    assert.deepEqual(shape(r), [{ path: 'b1/a.txt', size: 1 }]);
  });
});
