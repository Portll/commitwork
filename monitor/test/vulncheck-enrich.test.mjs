// monitor/vulncheck-enrich.mjs — fixtures under fixtures/vulncheck-kev-*.json are REAL captured
// responses (2026-09-01, community-tier key, CVE-2023-22527 / CVE-2020-99999 / a deliberately bad
// token), not synthesized shapes — this repo's own rule for every parser here, paid or not.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchKevCatalog, saveCatalogCache, loadCatalogCache, enrichWithKev,
} from '../vulncheck-enrich.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8'));

function withCache(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-vulncheck-'));
  const prev = process.env.CW_VULNCHECK_KEV_CACHE;
  process.env.CW_VULNCHECK_KEV_CACHE = join(dir, 'cache.json');
  try { return fn(dir); } finally {
    if (prev === undefined) delete process.env.CW_VULNCHECK_KEV_CACHE; else process.env.CW_VULNCHECK_KEV_CACHE = prev;
  }
}

afterEach(() => { delete process.env.CW_VULNCHECK_KEV_CACHE; delete process.env.CW_NOW; });

// A fetchImpl double that replays captured fixture bodies by page/status, so fetchKevCatalog's HTTP
// handling (status codes, pagination stop condition) is exercised without a real network call.
function fixtureFetch({ page1 = fixture('vulncheck-kev-found.json'), status = 200 } = {}) {
  let calls = 0;
  return async () => {
    calls++;
    return { status, json: async () => (calls === 1 ? page1 : { data: [], _meta: { total_pages: 1 } }) };
  };
}

describe('fetchKevCatalog — HTTP states', () => {
  test('no key at all is state:no-key, no network call attempted', async () => {
    let called = false;
    const r = await fetchKevCatalog({ apiKey: undefined, fetchImpl: async () => { called = true; return { status: 200, json: async () => ({}) }; } });
    assert.equal(r.state, 'no-key');
    assert.equal(called, false);
  });

  test('a real 401 body (captured, bad token) reads as auth-failed, never as zero findings', async () => {
    const body = fixture('vulncheck-kev-badauth.json');
    const r = await fetchKevCatalog({ apiKey: 'bad', fetchImpl: fixtureFetch({ status: 401, page1: body }) });
    assert.equal(r.state, 'auth-failed');
    assert.equal(r.detail, 'unauthorized');
  });

  test('a network throw is fetch-failed, not a silent empty catalog', async () => {
    const r = await fetchKevCatalog({ apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.equal(r.state, 'fetch-failed');
    assert.match(r.detail, /ECONNRESET/);
  });

  test('a real found-CVE page (captured) is parsed into a trimmed entry', async () => {
    const r = await fetchKevCatalog({ apiKey: 'k', fetchImpl: fixtureFetch() });
    assert.equal(r.state, 'ok');
    assert.equal(r.entries.length, 1);
    const e = r.entries[0];
    assert.deepEqual(e.cve, ['CVE-2023-22527']);
    assert.equal(e.dateAdded, '2024-01-19T00:00:00Z');
    assert.equal(e.cisaDateAdded, '2024-01-24T00:00:00Z');
    assert.equal(e.knownRansomwareCampaignUse, 'Known');
    // the xdb payload (dozens of exploit repo entries) is NOT carried — enrichment needs the CVE
    // and the date, not a per-repo exploit-PoC catalog
    assert.equal('vulncheck_xdb' in e, false);
  });

  test('pagination stops when a page returns fewer than the limit (the real notfound shape, data:[])', async () => {
    const r = await fetchKevCatalog({ apiKey: 'k', fetchImpl: fixtureFetch({ page1: fixture('vulncheck-kev-notfound.json') }) });
    assert.equal(r.state, 'ok');
    assert.equal(r.entries.length, 0);
  });

  test('a malformed 200 body is fetch-failed rather than an empty-but-ok catalog', async () => {
    const r = await fetchKevCatalog({ apiKey: 'k', fetchImpl: async () => ({ status: 200, json: async () => ({ notData: true }) }) });
    assert.equal(r.state, 'fetch-failed');
  });
});

describe('cache — fail closed, same discipline as every other store in this tree', () => {
  test('no cache file yet: loadCatalogCache returns null, not an error', () => {
    withCache(() => { assert.equal(loadCatalogCache(), null); });
  });

  test('saveCatalogCache refuses a non-ok fetch result', () => {
    withCache(() => {
      assert.throws(() => saveCatalogCache({ state: 'auth-failed', detail: 'x' }), /refusing to cache/);
    });
  });

  test('a saved catalog round-trips through load', () => {
    withCache(() => {
      process.env.CW_NOW = '2026-09-01T10:00:00.000Z';
      const saved = saveCatalogCache({ state: 'ok', entries: [{ cve: ['CVE-2023-22527'], dateAdded: '2024-01-19T00:00:00Z' }], fetchedAt: '2026-09-01T10:00:00.000Z' });
      assert.equal(saved.count, 1);
      const loaded = loadCatalogCache();
      assert.equal(loaded.fetchedAt, '2026-09-01T10:00:00.000Z');
      assert.equal(loaded.entries.length, 1);
    });
  });

  test('a corrupt cache file throws rather than reading as empty', () => {
    withCache((dir) => {
      writeFileSync(join(dir, 'cache.json'), 'not json');
      assert.throws(() => loadCatalogCache());
    });
  });

  test('a well-formed-JSON-but-wrong-shape cache also throws', () => {
    withCache((dir) => {
      writeFileSync(join(dir, 'cache.json'), JSON.stringify({ nope: true }));
      assert.throws(() => loadCatalogCache(), /malformed/);
    });
  });
});

describe('enrichWithKev — additive, three-state, never a guess', () => {
  const catalog = { entries: [{ cve: ['CVE-2023-22527'], dateAdded: '2024-01-19T00:00:00Z', knownRansomwareCampaignUse: 'Known' }] };

  test('a matching id is flagged true, with the KEV date and ransomware flag carried', () => {
    const rows = [{ id: 'CVE-2023-22527', aliases: [] }];
    enrichWithKev(rows, catalog);
    assert.equal(rows[0].activelyExploited, true);
    assert.equal(rows[0].kevDateAdded, '2024-01-19T00:00:00Z');
    assert.equal(rows[0].kevRansomware, true);
  });

  test('a non-matching id is flagged false — the catalog WAS checked and said no', () => {
    const rows = [{ id: 'CVE-2020-99999', aliases: [] }];
    enrichWithKev(rows, catalog);
    assert.equal(rows[0].activelyExploited, false);
    assert.equal('kevDateAdded' in rows[0], false);
  });

  test('a match via ALIASES counts too, not just the primary id — npm-style GHSA rows carry the CVE as an alias', () => {
    const rows = [{ id: 'GHSA-something', aliases: ['CVE-2023-22527'] }];
    enrichWithKev(rows, catalog);
    assert.equal(rows[0].activelyExploited, true);
  });

  test('id matching is case-insensitive', () => {
    const rows = [{ id: 'cve-2023-22527', aliases: [] }];
    enrichWithKev(rows, catalog);
    assert.equal(rows[0].activelyExploited, true);
  });

  test('NO CACHE means every row is null (unknown), never false (not-exploited) — unknown is neither a pass nor a finding', () => {
    const rows = [{ id: 'CVE-2023-22527', aliases: [] }];
    enrichWithKev(rows, null);
    assert.equal(rows[0].activelyExploited, null);
  });

  test('rows with no id/aliases are untouched beyond activelyExploited:false — no throw on a malformed row', () => {
    const rows = [{}];
    enrichWithKev(rows, catalog);
    assert.equal(rows[0].activelyExploited, false);
  });

  test('identity-shaped fields are never touched — additive only, same rule as corroborate.mjs', () => {
    const rows = [{ id: 'CVE-2023-22527', aliases: [], tool: 'osv', package: 'body-parser' }];
    enrichWithKev(rows, catalog);
    assert.equal(rows[0].tool, 'osv');
    assert.equal(rows[0].package, 'body-parser');
  });

  test('empty and absent findings are tolerated', () => {
    assert.deepEqual(enrichWithKev([], catalog), []);
    assert.deepEqual(enrichWithKev(null, catalog) || [], []);
  });
});
