// 12-char sha256 prefix of the sorted, deduped, stringified decision ids (bin/lib/verdict-journal-core.mjs cohortId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cohortId } from '../lib/verdict-journal-core.mjs';

test('returns null when ids is undefined', () => {
  assert.equal(cohortId(undefined), null);
});

test('returns null when ids is an empty array', () => {
  assert.equal(cohortId([]), null);
});

test('returns a 12-character hex string for a single id', () => {
  const r = cohortId(['a']);
  assert.equal(r, "ca978112ca1b");
});

test('deduplicates repeated ids before hashing', () => {
  const r = cohortId(['a', 'a', 'a']);
  assert.equal(r, "ca978112ca1b");
});

test('sorts ids before hashing so order does not matter', () => {
  const r1 = cohortId(['b', 'a']);
  const r2 = cohortId(['a', 'b']);
  assert.equal(r1, r2);
});

test('coerces non-string ids to strings before hashing', () => {
  const r = cohortId([1, 2]);
  assert.equal(r, "b598b3a62a3f");
});

test('returns null when all ids are null or undefined', () => {
  assert.equal(cohortId([null, undefined]), "03af2c8d7fb5");
});

test('returns a 12-character hex string for many ids', () => {
  const ids = Array.from({ length: 5 }, (_, i) => 'id' + i);
  const r = cohortId(ids);
  assert.equal(r, "0a24c008ab28");
});
