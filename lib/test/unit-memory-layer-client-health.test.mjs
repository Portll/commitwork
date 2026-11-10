// Reports whether the VELD API /health endpoint is reachable and its HTTP status (lib/memory-layer-client.mjs health).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { health } from '../memory-layer-client.mjs';

test('returns ok true and null reason when the endpoint responds 200', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200 });
  const r = await health({ env: {}, fetchImpl });
  assert.deepEqual(r, { ok: true, reason: null });
});

test('returns ok false and an HTTP status reason when the endpoint responds 503', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const r = await health({ env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: "HTTP 503" });
});

test('returns ok false and the error message when fetch rejects', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const r = await health({ env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: "ECONNREFUSED" });
});

test('returns ok false and the error message when fetch rejects with a network error', async () => {
  const fetchImpl = async () => { throw new Error('fetch failed'); };
  const r = await health({ env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: "fetch failed" });
});

test('returns ok false and the error message when fetch rejects with a timeout error', async () => {
  const fetchImpl = async () => { throw new Error('The operation was aborted due to timeout'); };
  const r = await health({ env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: "The operation was aborted due to timeout" });
});

test('returns ok false and the error message when fetch rejects with an empty message', async () => {
  const fetchImpl = async () => { throw new Error(''); };
  const r = await health({ env: {}, fetchImpl });
  assert.deepEqual(r, { ok: false, reason: "" });
});
