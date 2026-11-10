// Verifies the hash chain of records (monitor/resolution-chain.mjs verifyChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChain } from '../resolution-chain.mjs';
import { createHash } from 'node:crypto';

const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const mk = (prev, extra = {}) => ({ prev, ...extra });

test('empty records returns intact true with zero count', () => {
  assert.deepEqual(verifyChain([]), { intact: true, records: 0 });
});

test('single valid record returns intact true with one count', () => {
  const r = mk('genesis', { data: 'a' });
  assert.deepEqual(verifyChain([r]), { intact: true, records: 1 });
});

test('two valid chained records returns intact true with two count', () => {
  const r0 = mk('genesis', { data: 'a' });
  const h0 = lineHash(JSON.stringify({ ...r0, hash: undefined }));
  const r1 = mk(h0, { data: 'b' });
  assert.deepEqual(verifyChain([r0, r1]), { intact: true, records: 2 });
});

test('broken chain at index zero returns intact false with genesis expected', () => {
  const r0 = mk('wrong', { data: 'a' });
  assert.deepEqual(verifyChain([r0]), { intact: false, brokeAt: 0, expected: "genesis", found: "wrong" });
});

test('broken chain at index one returns intact false with computed hash expected', () => {
  const r0 = mk('genesis', { data: 'a' });
  const h0 = lineHash(JSON.stringify({ ...r0, hash: undefined }));
  const r1 = mk('bad', { data: 'b' });
  assert.deepEqual(verifyChain([r0, r1]), { intact: false, brokeAt: 1, expected: "e6bf2064947a7a666fdd5d12fe97ab1d", found: "bad" });
});

test('record with null prev at index zero returns found null', () => {
  const r0 = mk(null, { data: 'a' });
  assert.deepEqual(verifyChain([r0]), { intact: false, brokeAt: 0, expected: "genesis", found: null });
});

test('three valid chained records returns intact true with three count', () => {
  const r0 = mk('genesis', { data: 'a' });
  const h0 = lineHash(JSON.stringify({ ...r0, hash: undefined }));
  const r1 = mk(h0, { data: 'b' });
  const h1 = lineHash(JSON.stringify({ ...r1, hash: undefined }));
  const r2 = mk(h1, { data: 'c' });
  assert.deepEqual(verifyChain([r0, r1, r2]), { intact: true, records: 3 });
});

test('broken chain at index two of three returns intact false with second hash expected', () => {
  const r0 = mk('genesis', { data: 'a' });
  const h0 = lineHash(JSON.stringify({ ...r0, hash: undefined }));
  const r1 = mk(h0, { data: 'b' });
  const h1 = lineHash(JSON.stringify({ ...r1, hash: undefined }));
  const r2 = mk('oops', { data: 'c' });
  assert.deepEqual(verifyChain([r0, r1, r2]), { intact: false, brokeAt: 2, expected: "997ef5103743a658984ac9b7f4c571ea", found: "oops" });
});
