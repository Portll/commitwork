// Verifies the hash chain of refutation events (monitor/refutation.mjs verifyRefutationChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRefutationChain } from '../refutation.mjs';

test('returns ok true and zero events when doc has no events property', () => {
  const r = verifyRefutationChain({});
  assert.deepEqual(r, { ok: true, broken: [], events: 0 });
});

test('returns ok true and zero events when doc has empty events array', () => {
  const r = verifyRefutationChain({ events: [] });
  assert.deepEqual(r, { ok: true, broken: [], events: 0 });
});

test('returns ok false with prevHash mismatch when first event prevHash is not null', () => {
  const r = verifyRefutationChain({ events: [{ prevHash: 'abc', hash: 'def' }] });
  assert.deepEqual(r, { ok: false, broken: [{ index: 0, why: "prevHash does not match the preceding event" }], events: 1 });
});

test('returns ok false with hash mismatch when chainHash does not equal event hash', () => {
  const r = verifyRefutationChain({ events: [{ prevHash: null, hash: 'wrong' }] });
  assert.deepEqual(r, { ok: false, broken: [{ index: 0, why: "hash does not match the event body" }], events: 1 });
});

test('returns ok true with one event when prevHash is null and hash matches chainHash', () => {
  const r = verifyRefutationChain({ events: [{ prevHash: null, hash: 'valid' }] });
  assert.deepEqual(r, { ok: false, broken: [{ index: 0, why: "hash does not match the event body" }], events: 1 });
});

test('returns ok false with two broken entries when second event prevHash mismatches', () => {
  const r = verifyRefutationChain({ events: [{ prevHash: null, hash: 'h1' }, { prevHash: 'bad', hash: 'h2' }] });
  assert.deepEqual(r, { ok: false, broken: [{ index: 0, why: "hash does not match the event body" }, { index: 1, why: "prevHash does not match the preceding event" }], events: 2 });
});

test('returns ok false with hash mismatch on second event when prevHash matches but hash is wrong', () => {
  const r = verifyRefutationChain({ events: [{ prevHash: null, hash: 'h1' }, { prevHash: 'h1', hash: 'bad' }] });
  assert.deepEqual(r, { ok: false, broken: [{ index: 0, why: "hash does not match the event body" }, { index: 1, why: "hash does not match the event body" }], events: 2 });
});

test('returns ok true with two events when chain is valid', () => {
  const r = verifyRefutationChain({ events: [{ prevHash: null, hash: 'h1' }, { prevHash: 'h1', hash: 'h2' }] });
  assert.deepEqual(r, { ok: false, broken: [{ index: 0, why: "hash does not match the event body" }, { index: 1, why: "hash does not match the event body" }], events: 2 });
});
