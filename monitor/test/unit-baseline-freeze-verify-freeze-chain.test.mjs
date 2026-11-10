// Verifies the hash chain of freeze records (monitor/baseline-freeze.mjs verifyFreezeChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFreezeChain, freezeHash } from '../baseline-freeze.mjs';

test('returns an empty array when records is null', () => {
  assert.deepEqual(verifyFreezeChain(null), []);
});

test('returns an empty array when records is undefined', () => {
  assert.deepEqual(verifyFreezeChain(undefined), []);
});

test('returns an empty array when records is an empty array', () => {
  assert.deepEqual(verifyFreezeChain([]), []);
});

test('returns an empty array for a single valid record with null prevHash', () => {
  const rec = { at: 't1', laneSet: 'L', sampling: 'S', adjudicationProtocol: 'A', interRaterPlan: 'I', by: 'B', note: 'N', prevHash: null };
  rec.hash = freezeHash(null, rec);
  assert.deepEqual(verifyFreezeChain([rec]), []);
});

test('returns a prevHash mismatch problem when the chain is broken', () => {
  const rec1 = { at: 't1', laneSet: 'L', sampling: 'S', adjudicationProtocol: 'A', interRaterPlan: 'I', by: 'B', note: 'N', prevHash: null };
  rec1.hash = freezeHash(null, rec1);
  const rec2 = { at: 't2', laneSet: 'L', sampling: 'S', adjudicationProtocol: 'A', interRaterPlan: 'I', by: 'B', note: 'N', prevHash: 'wrong' };
  rec2.hash = freezeHash('wrong', rec2);
  assert.deepEqual(verifyFreezeChain([rec1, rec2]), ["freeze[1]: prevHash mismatch"]);
});

test('returns a hash mismatch problem when the record hash is wrong', () => {
  const rec = { at: 't1', laneSet: 'L', sampling: 'S', adjudicationProtocol: 'A', interRaterPlan: 'I', by: 'B', note: 'N', prevHash: null };
  rec.hash = 'badhash';
  assert.deepEqual(verifyFreezeChain([rec]), ["freeze[0]: hash mismatch (at t1)"]);
});

test('returns both problems when prevHash and hash are wrong', () => {
  const rec = { at: 't1', laneSet: 'L', sampling: 'S', adjudicationProtocol: 'A', interRaterPlan: 'I', by: 'B', note: 'N', prevHash: 'wrong' };
  rec.hash = 'badhash';
  assert.deepEqual(verifyFreezeChain([rec]), ["freeze[0]: prevHash mismatch", "freeze[0]: hash mismatch (at t1)"]);
});

test('returns an empty array for two valid chained records', () => {
  const rec1 = { at: 't1', laneSet: 'L', sampling: 'S', adjudicationProtocol: 'A', interRaterPlan: 'I', by: 'B', note: 'N', prevHash: null };
  rec1.hash = freezeHash(null, rec1);
  const rec2 = { at: 't2', laneSet: 'L', sampling: 'S', adjudicationProtocol: 'A', interRaterPlan: 'I', by: 'B', note: 'N', prevHash: rec1.hash };
  rec2.hash = freezeHash(rec1.hash, rec2);
  assert.deepEqual(verifyFreezeChain([rec1, rec2]), []);
});
