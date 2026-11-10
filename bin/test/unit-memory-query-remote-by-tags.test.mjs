// Remote tag-recall state with match count, sorted unique external ids and unidentified count (bin/memory-query.mjs remoteByTags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteByTags } from '../memory-query.mjs';

const noFetch = async () => { throw new Error('fetch must not run'); };
const withKey = { credentialImpl: () => ({ ok: true, key: 'test-key' }) };
const reply = (body) => async () => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
const unreachable = (reason) => ({ state: 'unreachable', matches: null, ids: null, unidentified: null, reason });

test('An unresolvable credential is reported as a local configuration fault and the remote is never asked', async () => {
  const env = { VELD_API_KEY: '' };
  const seen = [];
  const r = await remoteByTags(['t'], {
    env,
    fetchImpl: noFetch,
    credentialImpl: (args) => { seen.push(args); return { ok: false }; },
  });
  assert.deepEqual(seen, [{ env, report: false }]);
  assert.deepEqual(r, {
    state: 'no-credential',
    matches: null,
    ids: null,
    unidentified: null,
    reason: 'VELD_API_KEY unresolvable \u2014 a configuration failure on this box, not the remote being down',
  });
});

test('An error thrown while issuing the recall makes the state unreachable with that error message', async () => {
  const r = await remoteByTags(['t'], {
    fetchImpl: noFetch,
    credentialImpl: () => ({ ok: true, get key() { throw new Error('boom'); } }),
  });
  assert.deepEqual(r, unreachable('boom'));
});

test('A thrown value without a message falls back to the fixed tag recall threw reason', async () => {
  for (const thrown of [null, new Error('')]) {
    const r = await remoteByTags(['t'], {
      fetchImpl: noFetch,
      credentialImpl: () => ({ ok: true, get key() { throw thrown; } }),
    });
    assert.deepEqual(r, unreachable('tag recall threw'));
  }
});

test('A genuine empty answer is ok with zero matches, no ids and zero unidentified', async () => {
  const r = await remoteByTags(['t'], { ...withKey, fetchImpl: reply({ memories: [], count: 0 }) });
  assert.deepEqual(r, { state: 'ok', matches: 0, ids: [], unidentified: 0, reason: null });
});

test('A single memory without an external id counts as exactly one unidentified match', async () => {
  const r = await remoteByTags(['t'], { ...withKey, fetchImpl: reply({ memories: [{ id: 'm0' }], count: 1 }) });
  assert.deepEqual(r, { state: 'ok', matches: 1, ids: [], unidentified: 1, reason: null });
});

test('Ids from all three locations are deduplicated and sorted while id-less memories are counted', async () => {
  const memories = [
    { id: 'm0', external_id: 'b' },
    { id: 'm1', experience: { external_id: 'a' } },
    { id: 'm2', metadata: { external_id: 'c' } },
    { id: 'm3', external_id: 'b' },
    { id: 'm4', external_id: '' },
    { id: 'm5' },
    { id: 'm6', external_id: 7 },
  ];
  const r = await remoteByTags(['t'], { ...withKey, fetchImpl: reply({ memories, count: memories.length }) });
  assert.deepEqual(r, { state: 'ok', matches: 7, ids: ['a', 'b', 'c'], unidentified: 3, reason: null });
});

test('Ids are returned in sorted order regardless of the order the remote sent them', async () => {
  const memories = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, external_id: `x${4 - i}` }));
  const r = await remoteByTags(['t'], { ...withKey, fetchImpl: reply({ memories, count: memories.length }) });
  assert.deepEqual(r, { state: 'ok', matches: 5, ids: ['x0', 'x1', 'x2', 'x3', 'x4'], unidentified: 0, reason: null });
});
