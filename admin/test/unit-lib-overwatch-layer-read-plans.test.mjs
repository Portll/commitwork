// Fetches and normalizes the spine plan listing from the overwatch layer (admin/lib/overwatch-layer-read.mjs plans).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plans } from '../lib/overwatch-layer-read.mjs';

const okFetch = (payload) => async () => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

const errFetch = (msg, name = 'Error') => async () => {
  const e = new Error(msg);
  e.name = name;
  throw e;
};

test('returns ok false with why when fetch throws a network error', async () => {
  const r = await plans({ fetchImpl: errFetch('ECONNREFUSED') });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer unreachable at http://127.0.0.1:7980/api/v1/spine: ECONNREFUSED' });
});

test('returns ok false with why when fetch throws an AbortError', async () => {
  const r = await plans({ fetchImpl: errFetch('aborted', 'AbortError') });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer did not answer /api/v1/spine within 6000ms \u2014 slow, not necessarily down' });
});

test('returns ok false when response is not ok', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const r = await plans({ fetchImpl });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered HTTP 503 for /api/v1/spine' });
});

test('returns ok false when 200 body is null', async () => {
  const r = await plans({ fetchImpl: okFetch(null) });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered 200 for /api/v1/spine with no readable payload' });
});

test('returns ok false when 200 body is a string', async () => {
  const r = await plans({ fetchImpl: okFetch('garbage') });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered 200 for /api/v1/spine with no readable payload' });
});

test('returns ok false when 200 body has data key explicitly null', async () => {
  const r = await plans({ fetchImpl: okFetch({ data: null, schemaVersion: 2 }) });
  assert.deepEqual(r, { ok: false, why: 'overwatch layer answered 200 for /api/v1/spine with no readable payload' });
});

test('returns normalized shape when body is a plain object without data key', async () => {
  const payload = { store: 's1', plans: [1, 2], byProject: { a: 1 }, unattributed: 3, taskCount: 5, schemaVersion: 7 };
  const r = await plans({ fetchImpl: okFetch(payload) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: 7,
    store: 's1',
    plans: [1, 2],
    byProject: { a: 1 },
    unattributed: 3,
    taskCount: 5,
  });
});

test('uses body.data when data key is present and is an object', async () => {
  const payload = { data: { store: 's2', plans: ['x'], taskCount: 1 }, schemaVersion: 9 };
  const r = await plans({ fetchImpl: okFetch(payload) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: 9,
    store: 's2',
    plans: ['x'],
    byProject: null,
    unattributed: null,
    taskCount: 1,
  });
});

test('defaults missing optional fields to null and empty plans array', async () => {
  const r = await plans({ fetchImpl: okFetch({}) });
  assert.deepEqual(r, {
    ok: true,
    schemaVersion: null,
    store: null,
    plans: [],
    byProject: null,
    unattributed: null,
    taskCount: null,
  });
});

test('coerces non-array plans to empty array', async () => {
  const r = await plans({ fetchImpl: okFetch({ plans: 'not-an-array', store: 's3' }) });
  assert.equal(r.plans.length, 0);
  assert.equal(r.store, 's3');
});
