// Computes the current disposition ruling for an anchor (monitor/anchor-disposition.mjs currentRuling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentRuling } from '../anchor-disposition.mjs';

test('returns unreviewed when doc has no rulings', () => {
  const r = currentRuling({}, 'a1', 'sha256:x');
  assert.deepEqual(r, { disposition: "unreviewed", stale: false, ruling: null });
});

test('returns unreviewed when rulings exist but none match anchor', () => {
  const r = currentRuling({ rulings: [{ anchor: 'other', disposition: 'approved', evidenceDigest: 'sha256:y' }] }, 'a1', 'sha256:x');
  assert.deepEqual(r, { disposition: "unreviewed", stale: false, ruling: null });
});

test('returns unreviewed when doc.rulings is undefined', () => {
  const r = currentRuling({ foo: 1 }, 'a1', 'sha256:x');
  assert.deepEqual(r, { disposition: "unreviewed", stale: false, ruling: null });
});

test('returns last ruling disposition when digest matches', () => {
  const r = currentRuling({ rulings: [{ anchor: 'a1', disposition: 'approved', evidenceDigest: 'sha256:abc' }] }, 'a1', 'sha256:abc');
  assert.deepEqual(r, { disposition: "approved", stale: false, ruling: { anchor: "a1", disposition: "approved", evidenceDigest: "sha256:abc" } });
});

test('returns stale unreviewed when digest differs from last evidenceDigest', () => {
  const r = currentRuling({ rulings: [{ anchor: 'a1', disposition: 'approved', evidenceDigest: 'sha256:old' }] }, 'a1', 'sha256:new');
  assert.deepEqual(r, { disposition: "unreviewed", stale: true, ruling: { anchor: "a1", disposition: "approved", evidenceDigest: "sha256:old" }, staleReason: "the code changed again after this ruling" });
});

test('returns last ruling when digest is null and last has no evidenceDigest', () => {
  const r = currentRuling({ rulings: [{ anchor: 'a1', disposition: 'rejected' }] }, 'a1', null);
  assert.deepEqual(r, { disposition: "rejected", stale: false, ruling: { anchor: "a1", disposition: "rejected" } });
});

test('returns last ruling when digest is null and last has evidenceDigest', () => {
  const r = currentRuling({ rulings: [{ anchor: 'a1', disposition: 'approved', evidenceDigest: 'sha256:z' }] }, 'a1', null);
  assert.deepEqual(r, { disposition: "approved", stale: false, ruling: { anchor: "a1", disposition: "approved", evidenceDigest: "sha256:z" } });
});

test('returns last ruling when digest is provided but last has no evidenceDigest', () => {
  const r = currentRuling({ rulings: [{ anchor: 'a1', disposition: 'approved' }] }, 'a1', 'sha256:whatever');
  assert.deepEqual(r, { disposition: "approved", stale: false, ruling: { anchor: "a1", disposition: "approved" } });
});

test('uses the last matching ruling when multiple match anchor', () => {
  const r = currentRuling({ rulings: [
    { anchor: 'a1', disposition: 'rejected', evidenceDigest: 'sha256:first' },
    { anchor: 'a1', disposition: 'approved', evidenceDigest: 'sha256:second' },
  ] }, 'a1', 'sha256:second');
  assert.deepEqual(r, { disposition: "approved", stale: false, ruling: { anchor: "a1", disposition: "approved", evidenceDigest: "sha256:second" } });
});

test('returns stale when multiple match and digest differs from last', () => {
  const r = currentRuling({ rulings: [
    { anchor: 'a1', disposition: 'rejected', evidenceDigest: 'sha256:first' },
    { anchor: 'a1', disposition: 'approved', evidenceDigest: 'sha256:second' },
  ] }, 'a1', 'sha256:third');
  assert.deepEqual(r, { disposition: "unreviewed", stale: true, ruling: { anchor: "a1", disposition: "approved", evidenceDigest: "sha256:second" }, staleReason: "the code changed again after this ruling" });
});
