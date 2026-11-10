// Appends a data-anchor-retired record for a gone, anchored, not yet retired data store (bin/lib/verdict-journal-core.mjs retireDataAnchor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retireDataAnchor } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'retireDataAnchor-'));
  try {
    return fn(dir, join(dir, 'store.jsonl'), join(dir, 'anchors.jsonl'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lines = (...recs) => recs.map((r) => `${JSON.stringify(r)}\n`).join('');

test('a blank, null, undefined or whitespace-only reason is refused before anything is read', () => {
  withDir((dir, file, path) => {
    for (const reason of ['', null, undefined, ' \t  ']) {
      assert.deepEqual(retireDataAnchor(file, reason, { path }), { ok: false, file, error: 'a retirement needs a reason' });
    }
    assert.equal(existsSync(path), false);
  });
});

test('a store that still exists is not retired', () => {
  withDir((dir, file, path) => {
    writeFileSync(file, 'data');
    const before = lines({ v: 1, kind: 'data-anchor', file, storeClass: 'append-only' });
    writeFileSync(path, before);
    assert.deepEqual(retireDataAnchor(file, 'gone', { path }), { ok: false, file, error: 'the store still exists \u2014 retire only a store that is gone' });
    assert.equal(readFileSync(path, 'utf8'), before);
  });
});

test('a stat failure other than ENOENT reports that the store state is unknown with the error code', () => {
  withDir((dir, _file, path) => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    const file = join(blocker, 'store.jsonl');
    const before = lines({ v: 1, kind: 'data-anchor', file, storeClass: 'append-only' });
    writeFileSync(path, before);
    assert.deepEqual(retireDataAnchor(file, 'gone', { path }), { ok: false, file, error: 'cannot tell whether the store is gone (ENOTDIR)' });
    assert.equal(readFileSync(path, 'utf8'), before);
  });
});

test('an anchor store that cannot be read reports its error code', () => {
  withDir((dir, file, path) => {
    mkdirSync(path);
    assert.deepEqual(retireDataAnchor(file, 'gone', { path }), { ok: false, file, error: 'anchor store unreadable (EISDIR)' });
  });
});

test('a missing anchor store means the store was never anchored and nothing is written', () => {
  withDir((dir, file, path) => {
    assert.deepEqual(retireDataAnchor(file, 'gone', { path }), { ok: false, file, error: 'never anchored \u2014 nothing to retire' });
    assert.equal(existsSync(path), false);
  });
});

test('anchors for other files and other record kinds for this file do not count as an anchor', () => {
  withDir((dir, file, path) => {
    const other = join(dir, 'other.jsonl');
    const before = lines(
      { v: 1, kind: 'data-anchor', file: other, storeClass: 'index' },
      { v: 1, kind: 'note', file, storeClass: 'rewritten' },
    );
    writeFileSync(path, before);
    assert.deepEqual(retireDataAnchor(file, 'gone', { path }), { ok: false, file, error: 'never anchored \u2014 nothing to retire' });
    assert.equal(readFileSync(path, 'utf8'), before);
  });
});

test('a store whose latest anchor record is a retirement is already retired', () => {
  withDir((dir, file, path) => {
    const before = lines(
      { v: 1, kind: 'data-anchor', file, storeClass: 'append-only' },
      { v: 1, kind: 'data-anchor-retired', file, storeClass: 'append-only', reason: 'old' },
    );
    writeFileSync(path, before);
    assert.deepEqual(retireDataAnchor(file, 'gone', { path }), { ok: false, file, error: 'already retired' });
    assert.equal(readFileSync(path, 'utf8'), before);
  });
});

test('a gone anchored store is retired with its store class and trimmed reason, and cannot be retired twice', () => {
  withDir((dir, file, path) => {
    const first = JSON.stringify({ v: 1, kind: 'data-anchor', file, storeClass: 'append-only' });
    writeFileSync(path, `${first}\n`);
    assert.deepEqual(retireDataAnchor(file, '  dropped  ', { path }), { ok: true, file, storeClass: 'append-only' });
    const written = readFileSync(path, 'utf8').split('\n');
    assert.equal(written.length, 3);
    assert.equal(written[0], first);
    assert.equal(written[2], '');
    const { at, prev, ...rest } = JSON.parse(written[1]);
    assert.deepEqual(rest, { v: 1, kind: 'data-anchor-retired', file, storeClass: 'append-only', reason: 'dropped' });
    assert.deepEqual(retireDataAnchor(file, 'again', { path }), { ok: false, file, error: 'already retired' });
    assert.equal(readFileSync(path, 'utf8').split('\n').length, 3);
  });
});

test('the latest anchor record for this file decides, ignoring later records for other files and other kinds', () => {
  withDir((dir, file, path) => {
    const other = join(dir, 'other.jsonl');
    writeFileSync(path, lines(
      { v: 1, kind: 'data-anchor', file, storeClass: 'append-only' },
      { v: 1, kind: 'data-anchor-retired', file, storeClass: 'append-only', reason: 'old' },
      { v: 1, kind: 'data-anchor', file, storeClass: 'rewritten' },
      { v: 1, kind: 'note', file, storeClass: 'index' },
      { v: 1, kind: 'data-anchor', file: other, storeClass: 'index' },
      { v: 1, kind: 'data-anchor-retired', file: other, storeClass: 'index', reason: 'x' },
    ));
    assert.deepEqual(retireDataAnchor(file, 'moved', { path }), { ok: true, file, storeClass: 'rewritten' });
    const written = readFileSync(path, 'utf8').split('\n');
    assert.equal(written.length, 8);
    const { at, prev, ...rest } = JSON.parse(written[6]);
    assert.deepEqual(rest, { v: 1, kind: 'data-anchor-retired', file, storeClass: 'rewritten', reason: 'moved' });
  });
});
