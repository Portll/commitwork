// Records from the memory store that carry every requested tag, in store order, capped at limit (lib/memory-store.mjs byTags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byTags } from '../memory-store.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EMPTY_MSG = 'byTags: at least one tag is required \u2014 an empty filter would return the whole store as if it had matched';
const SQL = 'SELECT * FROM memory_record ORDER BY updated_at DESC';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'byTags-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeDb(rows) {
  const calls = { sql: [], closed: 0 };
  const db = {
    prepare(sql) {
      calls.sql.push(sql);
      return { all: () => rows.map((r) => ({ ...r })) };
    },
    close() {
      calls.closed += 1;
    },
  };
  return { db, calls };
}

test('A null tag list is rejected because the filter would be empty', () => {
  withDir((dir) => {
    assert.throws(() => byTags(null, { path: join(dir, 'missing.db') }), { name: 'Error', message: EMPTY_MSG });
  });
});

test('An empty tag list is rejected before the supplied connection is queried', () => {
  withDir((dir) => {
    const { db, calls } = fakeDb([{ id: 1, tags: '["a"]' }]);
    assert.throws(() => byTags([], { db, path: join(dir, 'missing.db') }), { name: 'Error', message: EMPTY_MSG });
    assert.deepEqual(calls, { sql: [], closed: 0 });
  });
});

test('A missing store file yields an empty array', () => {
  withDir((dir) => {
    const r = byTags(['a'], { path: join(dir, 'missing.db') });
    assert.deepEqual(r, []);
  });
});

test('A zero-byte store file without the memory_record table surfaces the SQLite error', () => {
  withDir((dir) => {
    const p = join(dir, 'store.db');
    writeFileSync(p, Buffer.alloc(0));
    assert.throws(() => byTags(['a'], { path: p }), { name: 'Error', message: 'no such table: memory_record' });
  });
});

test('Only rows holding every requested tag are returned with parsed tags and duplicate request tags ignored', () => {
  withDir((dir) => {
    const { db, calls } = fakeDb([
      { id: 1, updated_at: 30, tags: '["a","b","c"]' },
      { id: 2, updated_at: 20, tags: '["a"]' },
      { id: 3, updated_at: 10, tags: null },
      { id: 4, updated_at: 5, tags: '["b","a"]' },
    ]);
    const r = byTags(['a', 'b', 'a'], { db, path: join(dir, 'missing.db') });
    assert.deepEqual(r, [
      { id: 1, updated_at: 30, tags: ['a', 'b', 'c'] },
      { id: 4, updated_at: 5, tags: ['b', 'a'] },
    ]);
    assert.deepEqual(calls, { sql: [SQL], closed: 0 });
  });
});

test('Numeric request tags are compared as strings against stored tags', () => {
  withDir((dir) => {
    const { db } = fakeDb([
      { id: 1, tags: '[7]' },
      { id: 2, tags: '["7"]' },
    ]);
    const r = byTags([7], { db, path: join(dir, 'missing.db') });
    assert.deepEqual(r, [{ id: 2, tags: ['7'] }]);
  });
});

test('An explicit limit stops the scan once that many rows have matched', () => {
  withDir((dir) => {
    const { db } = fakeDb([
      { id: 1, tags: '["a"]' },
      { id: 2, tags: '["a"]' },
      { id: 3, tags: '["a"]' },
    ]);
    const r = byTags(['a'], { db, limit: 2, path: join(dir, 'missing.db') });
    assert.deepEqual(r, [
      { id: 1, tags: ['a'] },
      { id: 2, tags: ['a'] },
    ]);
  });
});

test('A limit of zero stops after the first row even when a later row would match', () => {
  withDir((dir) => {
    const { db } = fakeDb([
      { id: 1, tags: '["b"]' },
      { id: 2, tags: '["a"]' },
    ]);
    const r = byTags(['a'], { db, limit: 0, path: join(dir, 'missing.db') });
    assert.deepEqual(r, []);
  });
});

test('Without a limit at most 50 matching rows are returned', () => {
  withDir((dir) => {
    const { db } = fakeDb(Array.from({ length: 51 }, (_, i) => ({ id: i, tags: '["k"]' })));
    const r = byTags(['k'], { db, path: join(dir, 'missing.db') });
    assert.deepEqual(r, Array.from({ length: 50 }, (_, i) => ({ id: i, tags: ['k'] })));
  });
});
