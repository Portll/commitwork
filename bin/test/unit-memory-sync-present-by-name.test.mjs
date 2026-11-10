// Whether a memory tagged with the slug's name exists, via tag recall (bin/memory-sync.mjs presentByName).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentByName } from '../memory-sync.mjs';

test('a failed recall returns ok false with present null and the recall reason', async () => {
  const recallImpl = async () => ({ ok: false, reason: 'network error' });
  const r = await presentByName('alpha', { recallImpl });
  assert.deepEqual(r, { ok: false, present: null, reason: 'network error' });
});

test('a failed recall without a reason returns ok false with reason undefined', async () => {
  const recallImpl = async () => ({ ok: false });
  const r = await presentByName('alpha', { recallImpl });
  assert.deepEqual(r, { ok: false, present: null, reason: undefined });
});

test('a successful recall with exactly one memory reports present true', async () => {
  const recallImpl = async () => ({ ok: true, memories: [{ id: 42 }] });
  const r = await presentByName('eta', { recallImpl });
  assert.deepEqual(r, { ok: true, present: true, reason: null });
});

test('a successful recall with two memories reports present true', async () => {
  const recallImpl = async () => ({ ok: true, memories: Array.from({ length: 2 }, (_, i) => ({ id: i })) });
  const r = await presentByName('beta', { recallImpl });
  assert.deepEqual(r, { ok: true, present: true, reason: null });
});

test('a successful recall with an empty memories array reports present false', async () => {
  const recallImpl = async () => ({ ok: true, memories: [] });
  const r = await presentByName('gamma', { recallImpl });
  assert.deepEqual(r, { ok: true, present: false, reason: null });
});

test('a successful recall with no memories field reports present false', async () => {
  const recallImpl = async () => ({ ok: true });
  const r = await presentByName('delta', { recallImpl });
  assert.deepEqual(r, { ok: true, present: false, reason: null });
});

test('a successful recall with null memories reports present false', async () => {
  const recallImpl = async () => ({ ok: true, memories: null });
  const r = await presentByName('theta', { recallImpl });
  assert.deepEqual(r, { ok: true, present: false, reason: null });
});

test('recall receives the prefixed tag and limit 1 with env key and fetchImpl passed through', async () => {
  const calls = [];
  const recallImpl = async (tags, opts) => {
    calls.push({ tags, opts });
    return { ok: true, memories: [] };
  };
  const env = { FOO: 'bar' };
  const key = 'secret';
  const fetchImpl = () => {};
  await presentByName('zeta', { recallImpl, env, key, fetchImpl });
  assert.deepEqual(calls, [{ tags: ['memory:zeta'], opts: { limit: 1, env, key, fetchImpl } }]);
});

test('recall receives key null by default', async () => {
  const calls = [];
  const recallImpl = async (tags, opts) => {
    calls.push(opts.key);
    return { ok: true, memories: [] };
  };
  await presentByName('epsilon', { recallImpl, env: {} });
  assert.deepEqual(calls, [null]);
});
