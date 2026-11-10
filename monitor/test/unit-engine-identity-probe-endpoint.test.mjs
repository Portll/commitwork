// Computes a 32-char fingerprint of an LLM endpoint's /v1/models and 404 responses (monitor/engine-identity.mjs probeEndpoint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeEndpoint } from '../engine-identity.mjs';

test('returns absent when fetch rejects with ECONNREFUSED in cause', async () => {
  const fetchImpl = async () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { absent: true });
});

test('returns absent when fetch rejects with ECONNREFUSED directly on error', async () => {
  const fetchImpl = async () => {
    const err = new Error('fetch failed');
    err.code = 'ECONNREFUSED';
    throw err;
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { absent: true });
});

test('returns absent when fetch rejects with ECONNREFUSED as error name', async () => {
  const fetchImpl = async () => {
    const err = new Error('fetch failed');
    err.name = 'ECONNREFUSED';
    throw err;
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { absent: true });
});

test('returns unknown tool-failed when fetch rejects with non-ECONNREFUSED code', async () => {
  const fetchImpl = async () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNRESET' };
    throw err;
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { unknown: true, unknownReason: "tool-failed", unknownDetail: "probe: ECONNRESET" });
});

test('returns unknown tool-failed when fetch rejects with no code or name', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { unknown: true, unknownReason: "tool-failed", unknownDetail: "probe: Error" });
});

test('returns fingerprint and modelCount when models response has data array', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/models')) {
      return {
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }),
      };
    }
    return {
      status: 404,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'not found',
    };
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { fingerprint: "c56cdd93ee7f1153a2bcdf608b561c2d", modelCount: 2 });
});

test('returns fingerprint and modelCount when models response has models array', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/models')) {
      return {
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ models: [{ id: 'a' }] }),
      };
    }
    return {
      status: 404,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'not found',
    };
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { fingerprint: "17851816f58e241b5b9d686ce05f911d", modelCount: 1 });
});

test('returns fingerprint with null modelCount when models body is non-JSON', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/models')) {
      return {
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<html>no json</html>',
      };
    }
    return {
      status: 404,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'not found',
    };
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { fingerprint: "83668327e38b27fe239693d75bb10e25", modelCount: null });
});

test('returns fingerprint with no-404-probe when 404 probe rejects', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/models')) {
      return {
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify({ data: [] }),
      };
    }
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  const result = await probeEndpoint('http://localhost:9999', { fetchImpl });
  assert.deepEqual(result, { fingerprint: "de10ae55382a7384d099e9f5c424a4da", modelCount: 0 });
});
