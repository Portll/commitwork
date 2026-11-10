// Upserts a record into the local SQLite store and returns a read-back-verified receipt (lib/memory-store.mjs put).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { put } from '../memory-store.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AT = '2026-01-02T03:04:05.000Z';
process.env.CW_NOW = AT;
const HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const WORLD = '486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7';
const TAGS = ['memory-layer-project:commitwork', 'scope:s'];
const NO_ID = 'no external_id \u2014 identity is external_id, and a record without one can never be updated or superseded';
const NO_SCOPE = 'no writer scope \u2014 an unscoped record is invisible to a scoped search: it does not fail, it never comes back';

const FAILED = {
  adapter: 'local', at: AT, state: 'failed', storedForm: 'unknown', storedCoverage: null,
  contentSha256: null, storedSha256: null, tagsSent: [], tagsStoredCount: null,
  truncated: false, version: null, wasUpdate: null,
};

const verified = (sha, version, wasUpdate, truncated = false) => ({
  external_id: 'id1', adapter: 'local', at: AT, state: 'verified', reason: null,
  storedForm: 'full', storedCoverage: 1, contentSha256: sha, storedSha256: sha,
  tagsSent: TAGS, tagsStoredCount: 2, truncated, version, wasUpdate,
});

const withDb = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'put-'));
  try {
    fn(join(dir, 'db.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('A record without an external_id is refused before anything is written', () => {
  withDb((p) => {
    assert.deepEqual(put({ content: 'hello' }, { scope: 's', path: p }), { ...FAILED, external_id: null, reason: NO_ID });
    assert.deepEqual(put(null, { scope: 's', path: p }), { ...FAILED, external_id: null, reason: NO_ID });
    assert.deepEqual(put({ external_id: '', content: 'hello' }, { scope: 's', path: p }), { ...FAILED, external_id: null, reason: NO_ID });
  });
});

test('A record without a writer scope is refused with the unscoped reason', () => {
  withDb((p) => {
    assert.deepEqual(put({ external_id: 'id1', content: 'hello' }, { path: p }), { ...FAILED, external_id: 'id1', reason: NO_SCOPE });
    assert.deepEqual(put({ external_id: 'id1', content: 'hello' }, { scope: '', path: p }), { ...FAILED, external_id: 'id1', reason: NO_SCOPE });
  });
});

test('A first write stores the record at version 1 and reports it verified and not an update', () => {
  withDb((p) => {
    const r = put({ external_id: 'id1', content: 'hello' }, { scope: 's', path: p });
    assert.deepEqual(r, verified(HELLO, 1, false));
    const file = readFileSync(p);
    assert.equal(file.subarray(0, 16).toString('latin1'), 'SQLite format 3\u0000');
    assert.equal(file.includes('hello'), true);
  });
});

test('Re-writing identical content keeps the same version and reports an update', () => {
  withDb((p) => {
    put({ external_id: 'id1', content: 'hello' }, { scope: 's', path: p });
    const r = put({ external_id: 'id1', content: 'hello' }, { scope: 's', path: p });
    assert.deepEqual(r, verified(HELLO, 1, true));
  });
});

test('Changing the content advances the version by exactly one per change', () => {
  withDb((p) => {
    put({ external_id: 'id1', content: 'hello' }, { scope: 's', path: p });
    const second = put({ external_id: 'id1', content: 'world' }, { scope: 's', path: p });
    assert.deepEqual(second, verified(WORLD, 2, true));
    const third = put({ external_id: 'id1', content: 'hello' }, { scope: 's', path: p });
    assert.deepEqual(third, verified(HELLO, 3, true));
  });
});

test('The truncated option is carried into the receipt as a boolean', () => {
  withDb((p) => {
    const r = put({ external_id: 'id1', content: 'hello' }, { scope: 's', path: p, truncated: 1 });
    assert.deepEqual(r, verified(HELLO, 1, false, true));
  });
});

test('A numeric external_id is stored and reported as its string form', () => {
  withDb((p) => {
    const r = put({ external_id: 7, content: 'hello' }, { scope: 's', path: p });
    assert.deepEqual(r, { ...verified(HELLO, 1, false), external_id: '7' });
  });
});
