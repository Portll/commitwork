// Tier C — the veld bridge. No network: every test injects its own fetch.
//
// The two properties that matter are not about ranking quality. They are:
//   1. a dry run SENDS NOTHING, proved by a fetch that throws if it is ever called;
//   2. when veld cannot answer, the fallback says `via: 'local'` rather than presenting a substring
//      scan as a semantic one. A degraded answer that does not announce the degradation is the
//      grey-as-green failure this repository exists to refuse, in miniature.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { records, recordFor, externalIdFor, publish, search, SUMMARY_WORD_BUDGET } from '../veld.mjs';
import { index } from '../query.mjs';

const REPO = 'https://example.invalid/repo.git';

const graph = () => ({
  v: 1,
  generatedAt: '2026-09-04T00:00:00.000Z',
  source: 'worktree',
  dynamicallyImported: [],
  namespaceImported: [],
  files: { input: 2, analysed: ['lib.mjs', 'app.mjs'], partial: [], unreadable: [] },
  nodes: [
    { v: 1, id: 'mod:lib.mjs', kind: 'module', path: 'lib.mjs', exports: ['used'], surfaceComplete: true, starReexports: [] },
    { v: 1, id: 'mod:app.mjs', kind: 'module', path: 'app.mjs', exports: [], surfaceComplete: true, starReexports: [] },
    { v: 1, id: 'sym:lib.mjs#used', kind: 'symbol', path: 'lib.mjs', name: 'used', symbolKind: 'function', line: 7, exported: true, witness: 'both' },
    { v: 1, id: 'sym:lib.mjs#helper', kind: 'symbol', path: 'lib.mjs', name: 'helper', symbolKind: 'function', line: 3, exported: false, witness: 'lexical' },
  ],
  edges: [{ v: 1, from: 'mod:app.mjs', to: 'sym:lib.mjs#used', kind: 'binds', witness: 'both', existence: 'confirmed', evidence: null }],
  summary: {},
});

const refuseFetch = () => { throw new Error('a dry run must not touch the network'); };

test('a record identity excludes the line — a symbol that moves is the same symbol', () => {
  const g = graph();
  const ix = index(g);
  const at7 = recordFor(g, g.nodes[2], ix, { repo: REPO });
  const moved = { ...g.nodes[2], line: 900 };
  const at900 = recordFor(g, moved, ix, { repo: REPO });
  assert.equal(at7.external_id, at900.external_id);
  assert.equal(at7.external_id, externalIdFor(REPO, 'lib.mjs', 'used'));
  assert.ok(!at7.external_id.includes('7'), 'no line number anywhere in the identity');
});

test('the locator survives the summariser, and the record says whether it does', () => {
  const g = graph();
  const r = recordFor(g, g.nodes[2], index(g), { repo: REPO, commit: 'a'.repeat(40) });
  const head = r.content.split('\n')[0];
  assert.ok(head.split(/\s+/).filter(Boolean).length <= SUMMARY_WORD_BUDGET,
    'the layer keeps ~50 words; a locator past that point is not stored');
  assert.equal(r.survives, true);
  assert.ok(head.includes('lib.mjs'), 'the path must be inside the surviving words');
  assert.ok(head.includes(REPO), 'and so must the repository');
  assert.ok(/LOCATOR not content/.test(head), 'a reader must not mistake this for the source');
});

test('records default to the exported surface, and `all` is opt-in', () => {
  const g = graph();
  assert.deepEqual(records(g, { repo: REPO }).map((r) => r.external_id),
    [externalIdFor(REPO, 'lib.mjs', 'used')]);
  assert.equal(records(g, { repo: REPO, only: 'all' }).length, 2);
});

test('a locator without a repository is refused rather than published', () => {
  assert.throws(() => records(graph(), {}), /repo identifier is required/);
});

test('publish is a DRY RUN unless applied — proved by a fetch that would throw', async () => {
  const r = await publish(graph(), { repo: REPO, fetchImpl: refuseFetch, env: {} });
  assert.equal(r.applied, false);
  assert.equal(r.planned, 1);
  assert.equal(r.receipts, null, 'null, not [] — nothing was observed because nothing was sent');
});

test('publish --apply sends one upsert per record and returns receipts', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ id: 'mem-1', was_update: false, version: 1 }) };
  };
  const env = { VELD_API_KEY: 'test-key', CW_VELD_VERIFY: '0', VELD_API_URL: 'http://127.0.0.1:9' };
  const r = await publish(graph(), { repo: REPO, apply: true, fetchImpl, env });
  assert.equal(r.applied, true);
  assert.equal(seen.length, 1, 'one record, one write');
  assert.match(seen[0].url, /\/api\/upsert$/);
  assert.equal(seen[0].body.external_id, externalIdFor(REPO, 'lib.mjs', 'used'));
  assert.ok(seen[0].body.tags.includes('codegraph-path:lib.mjs'), 'tagged so it can be enumerated later');
  assert.ok(seen[0].body.tags.includes('scope:commitwork-codegraph'), 'and scoped by the client, not by the caller');
  assert.equal(r.receipts.length, 1);
});

test('search says `local` when veld cannot answer, and never dresses it as semantic', async () => {
  const down = async () => { throw new Error('ECONNREFUSED'); };
  const r = await search(graph(), 'used', { repo: REPO, fetchImpl: down, env: { VELD_API_KEY: 'k', VELD_API_URL: 'http://127.0.0.1:9' } });
  assert.equal(r.via, 'local');
  assert.match(r.reason, /substring scan, not a semantic one/);
  assert.deepEqual(r.hits.map((h) => h.name), ['used']);
  assert.equal(r.hits[0].veldScore, null, 'a substring match has no score, and must not invent one');
  assert.match(r.scoreNote, /no ranking at all/);
});

test('the MEASURED /api/recall shape resolves — experience, score, no external_id, no tags', async () => {
  // Pinned against veld 0.7.39+229 on 2026-09-04, and pinned because the first version of these
  // tests invented a friendlier shape ({ content, tags, similarity }) and passed while the live
  // search returned five hits and resolved none of them. A fake that is kinder than the server
  // tests the fake.
  const g = graph();
  const record = records(g, { repo: REPO })[0];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      memories: [{
        id: 'mem-1',
        experience: { content: record.content, metadata: {} },
        score: 0.9496,
        importance: 0.5,
        created_at: '2026-09-04T00:00:00Z',
        tier: 'working',
      }],
    }),
  });
  const r = await search(g, 'anything', { repo: REPO, fetchImpl, env: { VELD_API_KEY: 'k', VELD_API_URL: 'http://127.0.0.1:9' } });
  assert.equal(r.via, 'veld');
  assert.equal(r.hits.length, 1, 'a hit whose only identity is its own text must still resolve');
  assert.equal(r.hits[0].stale, false);
  assert.equal(r.hits[0].name, 'used');
  assert.equal(r.hits[0].veldScore, 0.9496, '`score` is the field veld sends; `similarity` is not');
  assert.equal(r.hits[0].rank, 1);
  assert.match(r.scoreNote, /NOT a similarity/,
    'every veld-ranked answer must carry what its number is not — measured: a nonsense query scores 0.9496 at rank 1 too');
});

test('search asks for `semantic`, never veld\'s non-deterministic `hybrid` default', async () => {
  // Measured 2026-09-04 over 2,615 records: four identical hybrid queries returned four different
  // result sets, zero names common to all four. Same inputs, same outputs is a house invariant, and
  // a search nobody can re-run to the same answer cannot be checked — including by whoever is
  // deciding whether it works at all.
  let body = null;
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ memories: [] }) };
  };
  await search(graph(), 'anything', { repo: REPO, fetchImpl, env: { VELD_API_KEY: 'k', VELD_API_URL: 'http://127.0.0.1:9' } });
  assert.equal(body.mode, 'semantic');
});

test('the record identifies itself, and a URL in the id cannot mis-delimit it', () => {
  const g = graph();
  const record = records(g, { repo: 'https://github.com/Portll/commitwork.git' })[0];
  assert.ok(record.content.includes(`[${record.external_id}]`),
    'the id is IN the text: the semantic endpoint returns no other identity');
  assert.match(record.external_id, /https:\/\/github\.com\/Portll\/commitwork\.git/,
    'and the repo URL — dots, slashes and colons — survives inside it');
});

test('a veld hit naming a symbol the graph no longer has is STALE, not a location', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      memories: [
        { id: 'm1', content: 'x', similarity: 0.9, tags: [externalIdFor(REPO, 'lib.mjs', 'used')] },
        { id: 'm2', content: 'x', similarity: 0.8, tags: [externalIdFor(REPO, 'gone.mjs', 'removed')] },
        { id: 'm3', content: 'someone elses memory', similarity: 0.7, tags: ['unrelated'] },
      ],
    }),
  });
  const r = await search(graph(), 'anything', { repo: REPO, fetchImpl, env: { VELD_API_KEY: 'k', VELD_API_URL: 'http://127.0.0.1:9' } });
  assert.equal(r.via, 'veld');
  assert.equal(r.hits.length, 2, 'a memory belonging to another writer is dropped — recall ignores tag filters');
  assert.equal(r.hits[0].stale, false);
  assert.equal(r.hits[0].name, 'used');
  assert.equal(r.hits[1].stale, true, 'the graph is the source of truth; veld only ranked it');
  assert.deepEqual(r.hits.map((h) => h.rank), [1, 2], 'rank is the position, and it is always present');
  assert.equal(r.hits[1].path, null, 'and a stale hit must not be rendered as a live location');
});
