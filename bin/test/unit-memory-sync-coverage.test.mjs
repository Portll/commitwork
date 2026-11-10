// Buckets slugs into present, absent and unknown by tag recall (bin/memory-sync.mjs coverage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage } from '../memory-sync.mjs';

test('returns empty buckets and a zero total for an empty slug list', async () => {
  const r = await coverage([], { recallImpl: async () => ({ ok: true, memories: [] }) });
  assert.deepEqual(r, { total: 0, present: [], absent: [], unknown: [] });
});

test('puts a slug whose recall returns one memory into present', async () => {
  const r = await coverage(['alpha'], { recallImpl: async () => ({ ok: true, memories: [{ id: 1 }] }) });
  assert.deepEqual(r, { total: 1, present: ['alpha'], absent: [], unknown: [] });
});

test('puts a slug whose recall returns zero memories into absent', async () => {
  const r = await coverage(['beta'], { recallImpl: async () => ({ ok: true, memories: [] }) });
  assert.deepEqual(r, { total: 1, present: [], absent: ['beta'], unknown: [] });
});

test('treats a successful recall with no memories field as absent', async () => {
  const r = await coverage(['theta'], { recallImpl: async () => ({ ok: true }) });
  assert.deepEqual(r, { total: 1, present: [], absent: ['theta'], unknown: [] });
});

test('puts a slug whose recall fails into unknown with the failure reason', async () => {
  const r = await coverage(['gamma'], { recallImpl: async () => ({ ok: false, reason: 'network down' }) });
  assert.deepEqual(r, { total: 1, present: [], absent: [], unknown: [{ slug: 'gamma', reason: 'network down' }] });
});

test('ignores memories on a failed recall and still reports it as unknown', async () => {
  const r = await coverage(['eps'], { recallImpl: async () => ({ ok: false, reason: 'boom', memories: [{ id: 2 }] }) });
  assert.deepEqual(r, { total: 1, present: [], absent: [], unknown: [{ slug: 'eps', reason: 'boom' }] });
});

test('asks the recall implementation for the prefixed tag with limit one and the given options', async () => {
  const calls = [];
  const env = { A: '1' };
  const fetchImpl = async () => null;
  const recallImpl = async (tags, opts) => { calls.push([tags, opts]); return { ok: true, memories: [] }; };
  await coverage(['delta'], { recallImpl, env, key: 'k1', fetchImpl });
  assert.deepEqual(calls, [[['memory:delta'], { limit: 1, env, key: 'k1', fetchImpl }]]);
});

test('passes a null key when no key is given', async () => {
  const calls = [];
  const env = {};
  const fetchImpl = async () => null;
  const recallImpl = async (tags, opts) => { calls.push(opts.key); return { ok: true, memories: [] }; };
  await coverage(['k'], { recallImpl, env, fetchImpl });
  assert.deepEqual(calls, [null]);
});

test('sorts a mix of present, absent and unknown slugs in input order', async () => {
  const r = await coverage(['p', 'a', 'u', 'p2'], {
    recallImpl: async (tags) => {
      if (tags[0] === 'memory:p' || tags[0] === 'memory:p2') return { ok: true, memories: [{ id: 1 }] };
      if (tags[0] === 'memory:a') return { ok: true, memories: [] };
      return { ok: false, reason: 'nope' };
    }
  });
  assert.deepEqual(r, { total: 4, present: ['p', 'p2'], absent: ['a'], unknown: [{ slug: 'u', reason: 'nope' }] });
});

test('counts every slug in the total and records each failure', async () => {
  const slugs = Array.from({ length: 5 }, (_, i) => `s${i}`);
  const r = await coverage(slugs, { recallImpl: async () => ({ ok: false, reason: 'down' }) });
  assert.deepEqual(r, { total: 5, present: [], absent: [], unknown: slugs.map((slug) => ({ slug, reason: 'down' })) });
});
