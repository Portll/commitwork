// Verifies the hash chain of events (bin/upstream-fetch.mjs verifyChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChain, chainOf, eventBody } from '../upstream-fetch.mjs';
import { createHash } from 'node:crypto';

const GENESIS = '0'.repeat(64);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function makeEvent(prev, id) {
  const e = { at: '2024-01-01T00:00:00Z', id, repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: 'p' };
  e.prev = prev;
  e.chain = chainOf(prev, e);
  return e;
}

test('returns ok true with tip and length for a valid chain', () => {
  const e1 = makeEvent(GENESIS, 'id1');
  const e2 = makeEvent(e1.chain, 'id2');
  const r = verifyChain([e1, e2]);
  assert.deepEqual(r, { ok: true, tip: "fe5ff2dea0d7ba2a2acee42664e4de283171fc4e5b52e5f95298c8d29099c3c3", length: 2 });
});

test('returns ok false when prev does not bind the first line', () => {
  const e1 = makeEvent(GENESIS, 'id1');
  e1.prev = 'wrong';
  const r = verifyChain([e1]);
  assert.deepEqual(r, { ok: false, at: 1, why: "prev does not bind line 0" });
});

test('returns ok false when prev does not bind the second line', () => {
  const e1 = makeEvent(GENESIS, 'id1');
  const e2 = makeEvent(e1.chain, 'id2');
  e2.prev = 'wrong';
  const r = verifyChain([e1, e2]);
  assert.deepEqual(r, { ok: false, at: 2, why: "prev does not bind line 1" });
});

test('returns ok false when chain hash does not match the record body on the first line', () => {
  const e1 = makeEvent(GENESIS, 'id1');
  e1.chain = 'badhash';
  const r = verifyChain([e1]);
  assert.deepEqual(r, { ok: false, at: 1, why: "chain hash does not match the record body" });
});

test('returns ok false when chain hash does not match the record body on the second line', () => {
  const e1 = makeEvent(GENESIS, 'id1');
  const e2 = makeEvent(e1.chain, 'id2');
  e2.chain = 'badhash';
  const r = verifyChain([e1, e2]);
  assert.deepEqual(r, { ok: false, at: 2, why: "chain hash does not match the record body" });
});

test('returns ok true with tip equal to genesis and length zero for empty input', () => {
  const r = verifyChain([]);
  assert.deepEqual(r, { ok: true, tip: "0000000000000000000000000000000000000000000000000000000000000000", length: 0 });
});

test('returns ok false when prev does not bind a later line in a longer chain', () => {
  const e1 = makeEvent(GENESIS, 'id1');
  const e2 = makeEvent(e1.chain, 'id2');
  const e3 = makeEvent(e2.chain, 'id3');
  e3.prev = 'wrong';
  const r = verifyChain([e1, e2, e3]);
  assert.deepEqual(r, { ok: false, at: 3, why: "prev does not bind line 2" });
});

test('returns ok false when chain hash does not match on a later line in a longer chain', () => {
  const e1 = makeEvent(GENESIS, 'id1');
  const e2 = makeEvent(e1.chain, 'id2');
  const e3 = makeEvent(e2.chain, 'id3');
  e3.chain = 'badhash';
  const r = verifyChain([e1, e2, e3]);
  assert.deepEqual(r, { ok: false, at: 3, why: "chain hash does not match the record body" });
});
