// Computes attribution claim from mine, theirs, shared lists and since flag (bin/gate-ratchet-core.mjs attributionClaim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionClaim } from '../gate-ratchet-core.mjs';

test('returns standing when since is truthy', () => {
  const r = attributionClaim({ mine: ['a'], theirs: ['b'], shared: ['c'] }, '2024-01-01');
  assert.equal(r, "standing");
});

test('returns mixed when shared is non-empty', () => {
  const r = attributionClaim({ mine: [], theirs: [], shared: ['x'] });
  assert.equal(r, "mixed");
});

test('returns mixed when both mine and theirs are non-empty', () => {
  const r = attributionClaim({ mine: ['a'], theirs: ['b'], shared: [] });
  assert.equal(r, "mixed");
});

test('returns mine when only mine is non-empty', () => {
  const r = attributionClaim({ mine: ['a'], theirs: [], shared: [] });
  assert.equal(r, "mine");
});

test('returns theirs when only theirs is non-empty', () => {
  const r = attributionClaim({ mine: [], theirs: ['b'], shared: [] });
  assert.equal(r, "theirs");
});

test('returns unknown when all lists are empty', () => {
  const r = attributionClaim({ mine: [], theirs: [], shared: [] });
  assert.equal(r, "unknown");
});

test('returns mixed when mine and theirs have multiple entries', () => {
  const mine = Array.from({ length: 3 }, (_, i) => 'm' + i);
  const theirs = Array.from({ length: 2 }, (_, i) => 't' + i);
  const r = attributionClaim({ mine, theirs, shared: [] });
  assert.equal(r, "mixed");
});

test('returns mine when mine has one entry and theirs is empty', () => {
  const r = attributionClaim({ mine: ['only'], theirs: [], shared: [] });
  assert.equal(r, "mine");
});
