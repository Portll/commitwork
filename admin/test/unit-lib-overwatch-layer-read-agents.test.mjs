// Fetches agent fleet state from the overwatch layer and normalizes it (admin/lib/overwatch-layer-read.mjs agents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agents } from '../lib/overwatch-layer-read.mjs';

function fakeFetch(body) {
  return async () => ({ ok: true, status: 200, json: async () => body });
}

test('returns sessions, backends, slots, and operator from a well-formed envelope', async () => {
  const body = {
    data: {
      sessions: [{ id: 's1' }, { id: 's2' }],
      backends: [{ name: 'b1' }],
      slots: { free: 3 },
      operator: 'op1',
    },
    schemaVersion: 'v2',
  };
  const r = await agents({ fetchImpl: fakeFetch(body) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: 'v2',
    sessions: [{ id: 's1' }, { id: 's2' }],
    backends: [{ name: 'b1' }],
    slots: { free: 3 },
    operator: 'op1',
  });
});

test('returns empty arrays when sessions and backends keys are missing', async () => {
  const body = { data: { slots: 5, operator: 'op2' }, schemaVersion: 'v1' };
  const r = await agents({ fetchImpl: fakeFetch(body) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: 'v1',
    sessions: [],
    backends: [],
    slots: 5,
    operator: 'op2',
  });
});

test('returns null for slots and operator when those keys are absent', async () => {
  const body = { data: { sessions: [], backends: [] }, schemaVersion: null };
  const r = await agents({ fetchImpl: fakeFetch(body) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: null,
    sessions: [],
    backends: [],
    slots: null,
    operator: null,
  });
});

test('coerces non-array sessions and backends to empty arrays', async () => {
  const body = { data: { sessions: 'not-an-array', backends: 42 }, schemaVersion: 'v3' };
  const r = await agents({ fetchImpl: fakeFetch(body) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: 'v3',
    sessions: [],
    backends: [],
    slots: null,
    operator: null,
  });
});

test('preserves slots and operator values even when sessions is not an array', async () => {
  const body = { data: { sessions: null, backends: null, slots: { used: 1 }, operator: 'opX' }, schemaVersion: 'v4' };
  const r = await agents({ fetchImpl: fakeFetch(body) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: 'v4',
    sessions: [],
    backends: [],
    slots: { used: 1 },
    operator: 'opX',
  });
});

test('returns the error object unchanged when getJson fails', async () => {
  const errBody = { ok: false, why: 'overwatch layer unreachable at http://127.0.0.1:7980/api/v1/agents: boom' };
  const r = await agents({ fetchImpl: async () => { throw new Error('boom'); } });
  assert.equal(r.ok, false);
  assert.match(r.why, /unreachable/);
});

test('handles envelope without data key by using the whole body as payload', async () => {
  const body = { sessions: [{ id: 'a' }], backends: [], schemaVersion: 'v5' };
  const r = await agents({ fetchImpl: fakeFetch(body) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: 'v5',
    sessions: [{ id: 'a' }],
    backends: [],
    slots: null,
    operator: null,
  });
});

test('returns ok false when 200 response has null data key', async () => {
  const body = { data: null, schemaVersion: 'v6' };
  const r = await agents({ fetchImpl: fakeFetch(body) });
  assert.equal(r.ok, false);
  assert.match(r.why, /no readable payload/);
});
