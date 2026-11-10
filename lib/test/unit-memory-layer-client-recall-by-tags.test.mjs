// Memories recalled for a tag set from the memory-layer API, or a failure reason with null memories (lib/memory-layer-client.mjs recallByTags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallByTags } from '../memory-layer-client.mjs';

function stub(ok, status, payload, calls = []) {
  return async (url, opts) => {
    calls.push({ url, opts });
    return { ok, status, json: async () => payload };
  };
}

test('Returns the memories array from a successful response when an explicit key is given', async () => {
  const fetchImpl = stub(true, 200, { memories: [{ id: 1 }] });
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, memories: [{ id: 1 }] });
});

test('Falls back to the results array when the response has no memories field', async () => {
  const fetchImpl = stub(true, 200, { results: [{ id: 2 }] });
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, memories: [{ id: 2 }] });
});

test('Prefers memories over results when the response has both', async () => {
  const fetchImpl = stub(true, 200, { memories: [{ id: 1 }], results: [{ id: 2 }] });
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, memories: [{ id: 1 }] });
});

test('Returns an empty memories array when the successful response body is not JSON', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token'); },
  });
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, memories: [] });
});

test('Returns an empty memories array when the response has neither memories nor results', async () => {
  const fetchImpl = stub(true, 200, { other: [{ id: 9 }] });
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, memories: [] });
});

test('Reports the HTTP status and null memories when the server answers 500', async () => {
  const calls = [];
  const fetchImpl = stub(false, 500, { memories: [{ id: 1 }] }, calls);
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: 'HTTP 500', memories: null });
  assert.equal(calls.length, 1);
});

test('Reports the thrown message and null memories when fetch rejects', async () => {
  const fetchImpl = async () => { throw new Error('boom'); };
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: 'boom', memories: null });
});

test('Sends the expanded project tags, user id and limit as a POST to the recall endpoint', async () => {
  const calls = [];
  const fetchImpl = stub(true, 200, { memories: [] }, calls);
  const env = { VELD_API_URL: 'http://veld.test/', VELD_USER_ID: 'u1' };
  const tags = ['memory-layer-project:proj', 'other', 'veld-project:proj'];
  const r = await recallByTags(tags, { limit: 7, key: 'k', env, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, memories: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://veld.test/api/recall/tags');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(calls[0].opts.headers, { 'X-API-Key': 'k', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    user_id: 'u1',
    tags: ['memory-layer-project:proj', 'internal-c-project:proj', 'veld-project:proj', 'other'],
    limit: 7,
  });
});

test('Uses VELD_API_KEY from env with default url, user and limit when no explicit key is given', async () => {
  const calls = [];
  const fetchImpl = stub(true, 200, { memories: [{ id: 3 }] }, calls);
  const r = await recallByTags([':x'], { env: { VELD_API_KEY: 'envkey' }, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null, memories: [{ id: 3 }] });
  assert.equal(calls[0].url, 'http://127.0.0.1:3030/api/recall/tags');
  assert.deepEqual(calls[0].opts.headers, { 'X-API-Key': 'envkey', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].opts.body), { user_id: 'portll', tags: [':x'], limit: 50 });
});

test('Reports HTTP 404 with null memories without retrying', async () => {
  const calls = [];
  const fetchImpl = stub(false, 404, null, calls);
  const r = await recallByTags(['a'], { key: 'k', env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: 'HTTP 404', memories: null });
  assert.equal(calls.length, 1);
});
