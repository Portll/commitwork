// Derives the defect owner and classification basis from a group (monitor/defect-classify.mjs deriveOwner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOwner } from '../defect-classify.mjs';

test('returns undetermined with evidence defect when group is unusable', () => {
  const r = deriveOwner({ unusable: true, sha: 'abc' }, { shaResolves: () => true });
  assert.deepEqual(r, { owner: "undetermined", basis: null, derived: false, why: "evidence is unrecoverable \u2014 the closure recorded no readable reason, so nothing can be derived and nothing should be judged from it", evidenceDefect: true });
});

test('returns instrument with commit basis when sha resolves', () => {
  const r = deriveOwner({ sha: 'abc' }, { shaResolves: (s) => s === 'abc' });
  assert.deepEqual(r, { owner: "instrument", basis: "commit", derived: true, why: "commitwork shipped the fix at abc \u2014 the classification is a lookup, not a judgement", evidenceDefect: false });
});

test('returns undetermined with no basis when sha does not resolve', () => {
  const r = deriveOwner({ sha: 'abc' }, { shaResolves: (s) => s === 'xyz' });
  assert.deepEqual(r, { owner: "undetermined", basis: null, derived: false, why: "evidence cites abc, which does not resolve in this repository \u2014 it may be an upstream commit, which is exactly what a human or a dual-model pass must decide", evidenceDefect: false });
});

test('returns undetermined with no basis when sha is missing', () => {
  const r = deriveOwner({}, { shaResolves: () => true });
  assert.deepEqual(r, { owner: "undetermined", basis: null, derived: false, why: "evidence carries no commit reference, so the owner is a judgement rather than a lookup", evidenceDefect: false });
});

test('returns undetermined when shaResolves is not a function and sha is present', () => {
  const r = deriveOwner({ sha: 'abc' }, { shaResolves: 'not-a-fn' });
  assert.deepEqual(r, { owner: "undetermined", basis: null, derived: false, why: "evidence cites abc, which does not resolve in this repository \u2014 it may be an upstream commit, which is exactly what a human or a dual-model pass must decide", evidenceDefect: false });
});

test('returns undetermined when shaResolves is undefined and sha is present', () => {
  const r = deriveOwner({ sha: 'abc' }, {});
  assert.deepEqual(r, { owner: "undetermined", basis: null, derived: false, why: "evidence cites abc, which does not resolve in this repository \u2014 it may be an upstream commit, which is exactly what a human or a dual-model pass must decide", evidenceDefect: false });
});

test('returns undetermined when shaResolves is null and sha is present', () => {
  const r = deriveOwner({ sha: 'abc' }, { shaResolves: null });
  assert.deepEqual(r, { owner: "undetermined", basis: null, derived: false, why: "evidence cites abc, which does not resolve in this repository \u2014 it may be an upstream commit, which is exactly what a human or a dual-model pass must decide", evidenceDefect: false });
});

test('returns undetermined when sha is empty string and shaResolves is a function', () => {
  const r = deriveOwner({ sha: '' }, { shaResolves: () => true });
  assert.deepEqual(r, { owner: "undetermined", basis: null, derived: false, why: "evidence carries no commit reference, so the owner is a judgement rather than a lookup", evidenceDefect: false });
});
