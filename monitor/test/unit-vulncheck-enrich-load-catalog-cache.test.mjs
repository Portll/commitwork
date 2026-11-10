// Reads and validates the vulncheck KEV catalog cache JSON, or null when absent (monitor/vulncheck-enrich.mjs loadCatalogCache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogCache } from '../vulncheck-enrich.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withCache(name, content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadCatalogCache-'));
  const prev = process.env.CW_VULNCHECK_KEV_CACHE;
  try {
    const p = join(dir, name);
    if (content !== undefined) writeFileSync(p, content);
    process.env.CW_VULNCHECK_KEV_CACHE = p;
    fn(p);
  } finally {
    if (prev === undefined) delete process.env.CW_VULNCHECK_KEV_CACHE;
    else process.env.CW_VULNCHECK_KEV_CACHE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns null when the cache file is missing', () => {
  withCache('missing.json', undefined, () => {
    const result = loadCatalogCache();
    assert.equal(result, null);
  });
});

test('returns the parsed object when the cache is well formed', () => {
  const entries = Array.from({ length: 3 }, (_, i) => ({ id: i }));
  const body = { entries, fetchedAt: '2024-01-01T00:00:00Z', extra: 'kept' };
  withCache('cache.json', JSON.stringify(body), () => {
    const result = loadCatalogCache();
    assert.deepEqual(result, {
      entries: [{ id: 0 }, { id: 1 }, { id: 2 }],
      fetchedAt: '2024-01-01T00:00:00Z',
      extra: 'kept',
    });
  });
});

test('returns the parsed object when entries is empty and fetchedAt is an empty string', () => {
  withCache('empty.json', JSON.stringify({ entries: [], fetchedAt: '' }), () => {
    const result = loadCatalogCache();
    assert.deepEqual(result, { entries: [], fetchedAt: '' });
  });
});

test('rethrows the read error when the cache path is a directory', () => {
  withCache('subdir', undefined, (p) => {
    mkdirSync(p);
    assert.throws(() => loadCatalogCache(), {
      name: 'Error',
      code: 'EISDIR',
      message: 'EISDIR: illegal operation on a directory, read',
    });
  });
});

test('throws a syntax error when the cache file contains invalid JSON', () => {
  withCache('bad.json', '{not json', () => {
    assert.throws(() => loadCatalogCache(), {
      name: 'SyntaxError',
      message: "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    });
  });
});

test('throws malformed when the entries field is a string', () => {
  withCache('noarr.json', JSON.stringify({ entries: 'nope', fetchedAt: '2024-01-01T00:00:00Z' }), (p) => {
    assert.throws(() => loadCatalogCache(), { name: 'Error', message: `vulncheck KEV cache at ${p} is malformed` });
  });
});

test('throws malformed when the fetchedAt field is a number', () => {
  withCache('nostr.json', JSON.stringify({ entries: [], fetchedAt: 123 }), (p) => {
    assert.throws(() => loadCatalogCache(), { name: 'Error', message: `vulncheck KEV cache at ${p} is malformed` });
  });
});

test('throws malformed when the cache file contains a JSON null', () => {
  withCache('null.json', 'null', (p) => {
    assert.throws(() => loadCatalogCache(), { name: 'Error', message: `vulncheck KEV cache at ${p} is malformed` });
  });
});

test('throws malformed when entries is an array but fetchedAt is missing', () => {
  withCache('nofetched.json', JSON.stringify({ entries: [] }), (p) => {
    assert.throws(() => loadCatalogCache(), { name: 'Error', message: `vulncheck KEV cache at ${p} is malformed` });
  });
});

test('throws malformed when entries is missing but fetchedAt is a string', () => {
  withCache('noentries.json', JSON.stringify({ fetchedAt: '2024-01-01T00:00:00Z' }), (p) => {
    assert.throws(() => loadCatalogCache(), { name: 'Error', message: `vulncheck KEV cache at ${p} is malformed` });
  });
});
