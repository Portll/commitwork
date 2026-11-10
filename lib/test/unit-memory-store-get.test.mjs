// One memory record by external id with tags parsed from JSON (lib/memory-store.mjs get).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../memory-store.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeDb(row) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(['prepare', sql]);
      return { get(id) { calls.push(['get', id]); return row; } };
    },
    close() { calls.push(['close']); },
  };
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'get-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Returns null when no handle is given and the store file does not exist', () => {
  withDir((dir) => {
    const r = get('missing-id', { path: join(dir, 'memory.db') });
    assert.equal(r, null);
  });
});

test('Returns the row from a supplied handle with tags parsed and leaves the handle open', () => {
  withDir((dir) => {
    const db = fakeDb({ external_id: '42', body: 'hello', tags: '["a","b"]' });
    const r = get(42, { db, path: join(dir, 'memory.db') });
    assert.deepEqual(r, { external_id: '42', body: 'hello', tags: ['a', 'b'] });
    assert.deepEqual(db.calls, [
      ['prepare', 'SELECT * FROM memory_record WHERE external_id = ?'],
      ['get', '42'],
    ]);
  });
});

test('Returns null when the supplied handle finds no matching row', () => {
  withDir((dir) => {
    const db = fakeDb(undefined);
    const r = get('zzz', { db, path: join(dir, 'memory.db') });
    assert.equal(r, null);
    assert.deepEqual(db.calls, [
      ['prepare', 'SELECT * FROM memory_record WHERE external_id = ?'],
      ['get', 'zzz'],
    ]);
  });
});

test('Treats null tags as an empty tag list', () => {
  withDir((dir) => {
    const db = fakeDb({ external_id: 'n', tags: null });
    const r = get('n', { db, path: join(dir, 'memory.db') });
    assert.deepEqual(r, { external_id: 'n', tags: [] });
  });
});

test('Treats an empty tags string as an empty tag list', () => {
  withDir((dir) => {
    const db = fakeDb({ external_id: 'e', tags: '' });
    const r = get('e', { db, path: join(dir, 'memory.db') });
    assert.deepEqual(r, { external_id: 'e', tags: [] });
  });
});

test('Adds an empty tag list when the row has no tags column', () => {
  withDir((dir) => {
    const db = fakeDb({ external_id: 'u', body: 'x'.repeat(5) });
    const r = get('u', { db, path: join(dir, 'memory.db') });
    assert.deepEqual(r, { external_id: 'u', body: 'xxxxx', tags: [] });
  });
});

test('Throws when the store file exists but has no memory_record table', () => {
  withDir((dir) => {
    const p = join(dir, 'memory.db');
    writeFileSync(p, Buffer.alloc(0));
    assert.throws(() => get('abc', { path: p }), { message: 'no such table: memory_record' });
  });
});

test('Rethrows a stat failure that is not a missing file', () => {
  withDir((dir) => {
    const f = join(dir, 'f');
    writeFileSync(f, '');
    const p = join(f, 'memory.db');
    assert.throws(() => get('abc', { path: p }), {
      code: 'ENOTDIR',
      message: `ENOTDIR: not a directory, stat '${p}'`,
    });
  });
});
