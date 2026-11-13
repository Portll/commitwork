// Semantic recall via the VELD memory layer (lib/memory-layer-client.mjs recallSemantic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallSemantic } from '../memory-layer-client.mjs';

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
  const result = await recallSemantic('q', { env: {} });
  assert.deepEqual(result, { ok: false, reason: "VELD_API_KEY unresolvable", memories: null });
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

test('returns error when key provided but cred.ok forced false', async () => {
  const result = await recallSemantic('q', { key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ memories: [] }) }) });
  assert.deepEqual(result, { ok: true, reason: null, memories: [] });
});

test('returns ok true on successful response', async () => {
  const result = await recallSemantic('q', { key: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ memories: [] }) }) });
  assert.deepEqual(result, { ok: true, reason: null, memories: [] });
});
