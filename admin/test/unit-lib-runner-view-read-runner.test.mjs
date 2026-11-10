// Reads every runner route through the reader and maps each route key to its result (admin/lib/runner-view.mjs readRunner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRunner } from '../lib/runner-view.mjs';

test('each route key maps to the url and an empty opts object when only a reader is given', async () => {
  const read = (url, opts) => ({ url, opts });
  const result = await readRunner({ read });
  assert.deepEqual(result, {
    health: { url: '/v1/health', opts: {} },
    slots: { url: '/v1/runner/slots', opts: {} },
    decisions: { url: '/v1/runner/decisions?limit=50', opts: {} },
    jobs: { url: '/v1/runner/jobs?limit=50', opts: {} },
    now: { url: '/v1/resources/now', opts: {} },
  });
});

test('extra options are passed to every read without the read function itself', async () => {
  const read = (url, opts) => ({ url, opts });
  const result = await readRunner({ read, token: 'abc123', flag: true });
  const opts = { token: 'abc123', flag: true };
  assert.deepEqual(result, {
    health: { url: '/v1/health', opts },
    slots: { url: '/v1/runner/slots', opts },
    decisions: { url: '/v1/runner/decisions?limit=50', opts },
    jobs: { url: '/v1/runner/jobs?limit=50', opts },
    now: { url: '/v1/resources/now', opts },
  });
});

test('primitive results from the reader are stored under the matching route key', async () => {
  const read = (url) => url.length;
  const result = await readRunner({ read });
  assert.deepEqual(result, { health: 10, slots: 16, decisions: 29, jobs: 24, now: 17 });
});

test('result keys appear in route declaration order', async () => {
  const read = (url) => url;
  const result = await readRunner({ read });
  assert.deepEqual(Object.keys(result), ['health', 'slots', 'decisions', 'jobs', 'now']);
});

test('the reader is called once per route in declaration order', async () => {
  const calls = [];
  const read = (url) => {
    calls.push(url);
    return calls.length - 1;
  };
  const result = await readRunner({ read });
  assert.deepEqual(calls, [
    '/v1/health',
    '/v1/runner/slots',
    '/v1/runner/decisions?limit=50',
    '/v1/runner/jobs?limit=50',
    '/v1/resources/now',
  ]);
  assert.deepEqual(result, { health: 0, slots: 1, decisions: 2, jobs: 3, now: 4 });
});

test('every read receives the same opts object', async () => {
  const seen = [];
  const read = (url, opts) => {
    seen.push(opts);
    return null;
  };
  const result = await readRunner({ read, limit: 7 });
  assert.equal(seen.length, 5);
  assert.equal(seen[0], seen[4]);
  assert.equal(seen[1], seen[3]);
  assert.deepEqual(seen[2], { limit: 7 });
  assert.deepEqual(result, { health: null, slots: null, decisions: null, jobs: null, now: null });
});

test('promises returned by the reader are awaited before being stored', async () => {
  const read = (url) => Promise.resolve([url, url.length]);
  const result = await readRunner({ read });
  assert.deepEqual(result, {
    health: ['/v1/health', 10],
    slots: ['/v1/runner/slots', 16],
    decisions: ['/v1/runner/decisions?limit=50', 29],
    jobs: ['/v1/runner/jobs?limit=50', 24],
    now: ['/v1/resources/now', 17],
  });
});

test('an error thrown by the reader for one route rejects the whole read', async () => {
  const read = (url) => {
    if (url.includes('decisions')) throw new TypeError('bad route');
    return url;
  };
  await assert.rejects(() => readRunner({ read }), { name: 'TypeError', message: 'bad route' });
});
