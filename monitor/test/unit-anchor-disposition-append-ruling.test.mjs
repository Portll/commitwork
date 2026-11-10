// Appends a hash-chained ruling entry to a document (monitor/anchor-disposition.mjs appendRuling).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRuling } from '../anchor-disposition.mjs';

test('rejects a disposition that is not in the allowed list', () => {
  const doc = { rulings: [] };
  assert.throws(
    () => appendRuling(doc, { anchor: 'a1', disposition: 'bogus', reason: 'r', at: 1 }),
    { name: 'Error', message: 'disposition must be one of remediated|still-present|moot|unreviewed' }
  );
});

test('rejects a missing anchor', () => {
  const doc = { rulings: [] };
  assert.throws(
    () => appendRuling(doc, { anchor: '', disposition: 'moot', reason: 'r', at: 1 }),
    { name: 'Error', message: 'anchor is required' }
  );
});

test('rejects a reason that is only whitespace', () => {
  const doc = { rulings: [] };
  assert.throws(
    () => appendRuling(doc, { anchor: 'a1', disposition: 'moot', reason: '   ', at: 1 }),
    { name: 'Error', message: 'reason is required \u2014 a ruling with no stated basis is not a ruling' }
  );
});

test('rejects a reason that is undefined', () => {
  const doc = { rulings: [] };
  assert.throws(
    () => appendRuling(doc, { anchor: 'a1', disposition: 'moot', reason: undefined, at: 1 }),
    { name: 'Error', message: 'reason is required \u2014 a ruling with no stated basis is not a ruling' }
  );
});

test('appends a ruling with a null previous hash on an empty document', () => {
  const doc = { rulings: [] };
  const r = appendRuling(doc, { anchor: 'a1', disposition: 'remediated', evidenceDigest: 'sha256:abc', by: 'alice', reason: 'fixed it', at: 100 });
  assert.deepEqual(r, { anchor: "a1", disposition: "remediated", evidenceDigest: "sha256:abc", by: "alice", reason: "fixed it", at: 100, prevHash: null, hash: "f6ded8bc5a293c1c52010e1ff63056fb0176a07d02c2ccab0eff8da15d5f9d74" });
});

test('appends a second ruling whose previous hash is the first ruling hash', () => {
  const doc = { rulings: [] };
  const first = appendRuling(doc, { anchor: 'a1', disposition: 'remediated', reason: 'fixed', at: 1 });
  const second = appendRuling(doc, { anchor: 'a2', disposition: 'moot', reason: 'no longer applies', at: 2 });
  assert.deepEqual(second, { anchor: "a2", disposition: "moot", evidenceDigest: null, by: null, reason: "no longer applies", at: 2, prevHash: "a23e94bed4d63928dcb00607234b845584bdb985dc551fa6b08219d0b755de83", hash: "fa343becc1e61383128fc37345dc404385015e63dd2268c0fdaa30c98917391b" });
});

test('uses the last existing ruling hash as previous hash when document is non-empty', () => {
  const doc = { rulings: [{ anchor: 'x', disposition: 'moot', evidenceDigest: null, by: null, reason: 'old', at: 0, prevHash: null, hash: 'deadbeef' }] };
  const r = appendRuling(doc, { anchor: 'y', disposition: 'still-present', reason: 'still here', at: 5 });
  assert.deepEqual(r, { anchor: "y", disposition: "still-present", evidenceDigest: null, by: null, reason: "still here", at: 5, prevHash: "deadbeef", hash: "868ab88545f4187db1e453398bd1c1fba16fbdbc3ef7809fd3406c58fc02021d" });
});

test('trims the reason and stores it in the ruling', () => {
  const doc = { rulings: [] };
  const r = appendRuling(doc, { anchor: 'a1', disposition: 'unreviewed', reason: '  needs review  ', at: 42 });
  assert.deepEqual(r, { anchor: "a1", disposition: "unreviewed", evidenceDigest: null, by: null, reason: "needs review", at: 42, prevHash: null, hash: "8c87e6b479c05ee9cb133b20506bd8a5b1317e8d6d9da7e5e324d95d4df45540" });
});
