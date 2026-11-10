// Fetches a JSON endpoint with timeout and validates the payload shape (admin/lib/overwatch-layer-read.mjs getJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJson } from '../lib/overwatch-layer-read.mjs';

const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
const errRes = (status) => ({ ok: false, status, json: async () => { throw new Error('no body'); } });

test('returns ok false with why when the HTTP status is not ok', async () => {
  const r = await getJson('/x', { fetchImpl: async () => errRes(503), base: 'http://b' });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered HTTP 503 for /x' });
});

test('returns ok false when the 200 body is null', async () => {
  const r = await getJson('/x', { fetchImpl: async () => okRes(null), base: 'http://b' });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered 200 for /x with no readable payload' });
});

test('returns ok false when the 200 body is a string', async () => {
  const r = await getJson('/x', { fetchImpl: async () => okRes('hi'), base: 'http://b' });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered 200 for /x with no readable payload' });
});

test('returns ok false when the envelope data key is present but null', async () => {
  const r = await getJson('/x', { fetchImpl: async () => okRes({ data: null, schemaVersion: 2 }), base: 'http://b' });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered 200 for /x with no readable payload' });
});

test('returns ok false when the envelope data key is present but a string', async () => {
  const r = await getJson('/x', { fetchImpl: async () => okRes({ data: 'oops' }), base: 'http://b' });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered 200 for /x with no readable payload' });
});

test('returns ok true with the data object when the envelope has a data object', async () => {
  const r = await getJson('/x', { fetchImpl: async () => okRes({ data: { a: 1 }, schemaVersion: 3 }), base: 'http://b' });
  assert.deepEqual(r, { ok: true, data: { a: 1 }, schemaVersion: 3, envelope: { data: { a: 1 }, schemaVersion: 3 } });
});

test('returns ok true with the whole body when there is no data key', async () => {
  const r = await getJson('/x', { fetchImpl: async () => okRes({ a: 1, schemaVersion: 1 }), base: 'http://b' });
  assert.deepEqual(r, { ok: true, data: { a: 1, schemaVersion: 1 }, schemaVersion: 1, envelope: { a: 1, schemaVersion: 1 } });
});

test('returns ok false with a timeout why when the fetch rejects with AbortError', async () => {
  const e = new Error('aborted'); e.name = 'AbortError';
  const r = await getJson('/x', { fetchImpl: async () => { throw e; }, base: 'http://b' });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer did not answer /x within 6000ms \u2014 slow, not necessarily down' });
});

test('returns ok false with an unreachable why when the fetch rejects with a generic error', async () => {
  const r = await getJson('/x', { fetchImpl: async () => { throw new Error('boom'); }, base: 'http://b' });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer unreachable at http://b/x: boom' });
});
