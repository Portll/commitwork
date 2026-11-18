// Semantic recall via the VELD memory layer (lib/memory-layer-client.mjs recallSemantic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallSemantic } from '../memory-layer-client.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejects a non-string query', async () => {
  const result = await recallSemantic(42, { key: 'k' });
  assert.deepEqual(result, { ok: false, reason: "an empty query is not a query", memories: null });
});

test('rejects an empty string query', async () => {
  const result = await recallSemantic('', { key: 'k' });
  assert.deepEqual(result, { ok: false, reason: "an empty query is not a query", memories: null });
});

test('rejects a whitespace-only query', async () => {
  const result = await recallSemantic('   ', { key: 'k' });
  assert.deepEqual(result, { ok: false, reason: "an empty query is not a query", memories: null });
});

test('rejects a null query', async () => {
  const result = await recallSemantic(null, { key: 'k' });
  assert.deepEqual(result, { ok: false, reason: "an empty query is not a query", memories: null });
});

test('rejects when the api key is unresolvable', async () => {
  const saved = process.env.CW_SECRETS_FILE;
  const dir = mkdtempSync(join(tmpdir(), 'cw-secrets-'));
  process.env.CW_SECRETS_FILE = join(dir, 'secrets.json');
  try {
    const result = await recallSemantic('q', { env: {}, fetchImpl: async () => { throw new Error('fetch must not be reached'); } });
    assert.deepEqual(result, { ok: false, reason: "VELD_API_KEY unresolvable", memories: null });
  } finally {
    if (saved === undefined) delete process.env.CW_SECRETS_FILE;
    else process.env.CW_SECRETS_FILE = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('posts the query to /api/recall with the env key', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ memories: [] }) }; };
  const env = { VELD_API_KEY: 'from-env', VELD_API_URL: 'http://veld.test/', VELD_USER_ID: 'u1' };
  const result = await recallSemantic('q', { env, limit: 5, mode: 'semantic', fetchImpl });
  assert.deepEqual(result, { ok: true, reason: null, memories: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://veld.test/api/recall');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-API-Key'], 'from-env');
  assert.deepEqual(JSON.parse(calls[0].init.body), { user_id: 'u1', query: 'q', limit: 5, mode: 'semantic' });
});

test('returns error when fetch throws', async () => {
  const result = await recallSemantic('q', { key: 'k', fetchImpl: async () => { throw new Error('boom'); } });
  assert.deepEqual(result, { ok: false, reason: "boom", memories: null });
});

test('returns error on a non-ok http response', async () => {
  const result = await recallSemantic('q', { key: 'k', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.deepEqual(result, { ok: false, reason: "HTTP 500", memories: null });
});

test('returns memories from the json payload', async () => {
  const result = await recallSemantic('q', { key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ memories: [{ id: 1 }] }) }) });
  assert.deepEqual(result, { ok: true, reason: null, memories: [{ id: 1 }] });
});

test('falls back to results when memories is absent', async () => {
  const result = await recallSemantic('q', { key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ results: [{ id: 2 }] }) }) });
  assert.deepEqual(result, { ok: true, reason: null, memories: [{ id: 2 }] });
});

test('returns an empty array when the payload has neither memories nor results', async () => {
  const result = await recallSemantic('q', { key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  assert.deepEqual(result, { ok: true, reason: null, memories: [] });
});
