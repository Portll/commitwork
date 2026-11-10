// Upsert receipts per parsed memory, each tagged with its slug (bin/memory-sync.mjs syncAll).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncAll } from '../memory-sync.mjs';

const env = {};
const fetchImpl = () => null;
const capture = async (rec, opts) => ({ rec, opts });

test('returns an empty array when there is nothing to sync', async () => {
  const r = await syncAll([], { project: 'p', env, fetchImpl, upsertImpl: capture });
  assert.deepEqual(r, []);
});

test('uses the explicit project in the external id and adds no group tag for a null group', async () => {
  const parsed = [{ name: 'a', type: 't', description: 'd', body: 'b', group: null }];
  const r = await syncAll(parsed, { project: 'myproj', env, fetchImpl, upsertImpl: capture });
  assert.deepEqual(r, [{
    slug: 'a',
    rec: {
      external_id: 'claude-memory/myproj/a',
      content: 'd\n\nb',
      tags: ['memory:a', 'harness-memory', 'memory-type:t'],
      memory_type: 'Context',
    },
    opts: { scope: 'claude-code', env, key: null, fetchImpl },
  }]);
});

test('a single character project is used as given', async () => {
  const parsed = [{ name: 'z', type: 'u', description: 'x', body: 'y' }];
  const r = await syncAll(parsed, { project: 'x', env, fetchImpl, upsertImpl: async (rec) => ({ id: rec.external_id }) });
  assert.deepEqual(r, [{ slug: 'z', id: 'claude-memory/x/z' }]);
});

test('a non-empty group adds a normalised group tag', async () => {
  const parsed = [{ name: 'g', type: 'feedback', description: 'D', body: 'B', group: '--Foo__Bar 9--' }];
  const r = await syncAll(parsed, { project: 'proj', env, fetchImpl, upsertImpl: async (rec) => ({ tags: rec.tags }) });
  assert.deepEqual(r, [{ slug: 'g', tags: ['memory:g', 'harness-memory', 'memory-type:feedback', 'memory-group:foo-bar-9'] }]);
});

test('an empty string group adds no group tag', async () => {
  const parsed = [{ name: 'e', type: 'k', description: 'D', body: 'B', group: '' }];
  const r = await syncAll(parsed, { project: 'proj', env, fetchImpl, upsertImpl: async (rec) => ({ tags: rec.tags }) });
  assert.deepEqual(r, [{ slug: 'e', tags: ['memory:e', 'harness-memory', 'memory-type:k'] }]);
});

test('every parsed memory yields one receipt in input order', async () => {
  const parsed = Array.from({ length: 3 }, (_, i) => ({ name: `n${i}`, type: 't', description: `d${i}`, body: `b${i}` }));
  const r = await syncAll(parsed, { project: 'q', env, fetchImpl, upsertImpl: async (rec) => ({ id: rec.external_id, content: rec.content }) });
  assert.deepEqual(r, [
    { slug: 'n0', id: 'claude-memory/q/n0', content: 'd0\n\nb0' },
    { slug: 'n1', id: 'claude-memory/q/n1', content: 'd1\n\nb1' },
    { slug: 'n2', id: 'claude-memory/q/n2', content: 'd2\n\nb2' },
  ]);
});

test('fields returned by upsert override the slug in the receipt', async () => {
  const parsed = [{ name: 'orig', type: 't', description: 'd', body: 'b' }];
  const r = await syncAll(parsed, { project: 'p', env, fetchImpl, upsertImpl: async () => ({ slug: 'other', status: 'verified' }) });
  assert.deepEqual(r, [{ slug: 'other', status: 'verified' }]);
});

test('the key, env and fetch implementation are passed through to upsert with the claude-code scope', async () => {
  const parsed = [{ name: 'k', type: 't', description: 'd', body: 'b' }];
  const myEnv = { A: '1' };
  const r = await syncAll(parsed, { project: 'p', env: myEnv, key: 'k1', fetchImpl, upsertImpl: async (rec, opts) => ({ opts }) });
  assert.deepEqual(r, [{ slug: 'k', opts: { scope: 'claude-code', env: myEnv, key: 'k1', fetchImpl } }]);
});
