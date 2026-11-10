// Maps observations to adjudicated findings using identity-based overrides (bin/lib/pattern-core.mjs adjudicate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicate } from '../lib/pattern-core.mjs';

test('returns accepted for false-alarm adjudication', () => {
  const obs = [{ identity: 'id1', confidence: 'low' }];
  const adj = { id1: { truth: 'false-alarm', adjudicatedBy: 'alice', basis: 'b1' } };
  const r = adjudicate(obs, adj);
  assert.deepEqual(r, [{ identity: "id1", confidence: "low", adjudication: "accepted", adjudicatedBy: "alice", basis: "b1" }]);
});

test('returns finding for true-alarm adjudication', () => {
  const obs = [{ identity: 'id1', confidence: 'low' }];
  const adj = { id1: { truth: 'true-alarm', adjudicatedBy: 'bob', basis: 'b2' } };
  const r = adjudicate(obs, adj);
  assert.deepEqual(r, [{ identity: "id1", confidence: "low", adjudication: "finding", adjudicatedBy: "bob", basis: "b2" }]);
});

test('returns finding for structural confidence without adjudication', () => {
  const obs = [{ identity: 'id1', confidence: 'structural' }];
  const r = adjudicate(obs, {});
  assert.deepEqual(r, [{ identity: "id1", confidence: "structural", adjudication: "finding", adjudicatedBy: null, basis: null }]);
});

test('returns undetermined for non-structural confidence without adjudication', () => {
  const obs = [{ identity: 'id1', confidence: 'low' }];
  const r = adjudicate(obs, {});
  assert.deepEqual(r, [{ identity: "id1", confidence: "low", adjudication: "undetermined", adjudicatedBy: null, basis: null }]);
});

test('returns null for empty observations', () => {
  const r = adjudicate([], {});
  assert.deepEqual(r, []);
});

test('returns finding for true-alarm with missing adjudicatedBy and basis', () => {
  const obs = [{ identity: 'id1', confidence: 'low' }];
  const adj = { id1: { truth: 'true-alarm' } };
  const r = adjudicate(obs, adj);
  assert.deepEqual(r, [{ identity: "id1", confidence: "low", adjudication: "finding", adjudicatedBy: null, basis: null }]);
});

test('returns accepted for false-alarm with missing adjudicatedBy and basis', () => {
  const obs = [{ identity: 'id1', confidence: 'low' }];
  const adj = { id1: { truth: 'false-alarm' } };
  const r = adjudicate(obs, adj);
  assert.deepEqual(r, [{ identity: "id1", confidence: "low", adjudication: "accepted", adjudicatedBy: null, basis: null }]);
});

test('returns undetermined for unknown truth value with adjudication present', () => {
  const obs = [{ identity: 'id1', confidence: 'low' }];
  const adj = { id1: { truth: 'unknown', adjudicatedBy: 'carol', basis: 'b3' } };
  const r = adjudicate(obs, adj);
  assert.deepEqual(r, [{ identity: "id1", confidence: "low", adjudication: "undetermined", adjudicatedBy: null, basis: null }]);
});
