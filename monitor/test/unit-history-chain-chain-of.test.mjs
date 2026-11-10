// Computes the SHA-256 chain hash for a commit event (monitor/history-chain.mjs chainOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainOf } from '../history-chain.mjs';

test('v1 event hashes the fixed field body', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: 's1', sliceId: 'sl1', source: 'src', sliceSha256: 'abc', by: 'alice' };
  const r = chainOf('prev1', e);
  assert.equal(r, "104a0473b7cd4d9972895965dd2faf43edd78edec17922a36023eb16da19f599");
});

test('v1 event without by field omits attribution from body', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: 's1', sliceId: 'sl1', source: 'src', sliceSha256: 'abc' };
  const r = chainOf('prev1', e);
  assert.equal(r, "4eb0e359151f12810ca8befe068366c17509136d9708929ad466ad6eda28cd5f");
});

test('v2 event hashes canonical JSON of all fields except prev and chain', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: 's1', sliceId: 'sl1', source: 'src', sliceSha256: 'abc', by: 'alice', chainVersion: 2, note: 'hello' };
  const r = chainOf('prev1', e);
  assert.equal(r, "f93354b2cb913f0b4f37dd806d486b249498a1a6c74875ef482ead2792236dd9");
});

test('v2 event with chainVersion exactly 2 uses canonical body', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: null, sliceId: null, source: null, sliceSha256: null, by: 'unattributed', chainVersion: 2 };
  const r = chainOf('prev2', e);
  assert.equal(r, "600ce3d3c1228fed0cd50e6e13d1830eb1887e3720f6a53c4d705375c29f441a");
});

test('event with chainVersion 1 uses fixed field body', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: 's1', sliceId: 'sl1', source: 'src', sliceSha256: 'abc', by: 'alice', chainVersion: 1 };
  const r = chainOf('prev1', e);
  assert.equal(r, "104a0473b7cd4d9972895965dd2faf43edd78edec17922a36023eb16da19f599");
});

test('event with chainVersion 3 uses canonical body', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: 's1', sliceId: 'sl1', source: 'src', sliceSha256: 'abc', by: 'alice', chainVersion: 3 };
  const r = chainOf('prev1', e);
  assert.equal(r, "97603e81deb78cade67e66591f946ae828c5c0c5442b343a814dc47ddd5679ac");
});

test('different prev values produce different chain hashes', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: 's1', sliceId: 'sl1', source: 'src', sliceSha256: 'abc', by: 'alice' };
  const r1 = chainOf('aaa', e);
  const r2 = chainOf('bbb', e);
  assert.notEqual(r1, r2);
});

test('v2 event with undefined note drops it from canonical body', () => {
  const e = { at: '2024-01-01T00:00:00Z', op: 'commit', stamp: 's1', sliceId: 'sl1', source: 'src', sliceSha256: 'abc', by: 'alice', chainVersion: 2, note: undefined };
  const r = chainOf('prev1', e);
  assert.equal(r, "984efb417ed707ed3f450840eb688a92a2093581a1b95ca9d85181ab67cc6ce0");
});
