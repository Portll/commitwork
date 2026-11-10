// Computes a stage-1 divergence pair record from a row (monitor/divergence-kappa.mjs stage1Pair).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stage1Pair } from '../divergence-kappa.mjs';

test('returns null when row is null', () => {
  assert.equal(stage1Pair(null), null);
});

test('returns null when detail is missing', () => {
  assert.equal(stage1Pair({ subject: 's1', ts: 't1' }), null);
});

test('returns null when source is wrong', () => {
  assert.equal(stage1Pair({ subject: 's1', ts: 't1', detail: { source: 'wrong', basis: 'stage-1 independent analyses', local: { classification: 'a', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'b', answeredBy: { provider: 'p', model: 'm' } } } }), null);
});

test('returns null when basis is wrong', () => {
  assert.equal(stage1Pair({ subject: 's1', ts: 't1', detail: { source: 'codeql-remediation', basis: 'wrong', local: { classification: 'a', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'b', answeredBy: { provider: 'p', model: 'm' } } } }), null);
});

test('returns null when local classification is not a string', () => {
  assert.equal(stage1Pair({ subject: 's1', ts: 't1', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 123, answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'b', answeredBy: { provider: 'p', model: 'm' } } } }), null);
});

test('returns null when opus classification is not a string', () => {
  assert.equal(stage1Pair({ subject: 's1', ts: 't1', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: null, answeredBy: { provider: 'p', model: 'm' } } } }), null);
});

test('returns null when subject is missing', () => {
  assert.equal(stage1Pair({ ts: 't1', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'b', answeredBy: { provider: 'p', model: 'm' } } } }), null);
});

test('returns the pair record for a valid row', () => {
  assert.deepEqual(stage1Pair({ subject: 's1', ts: 't1', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', sampling: 'stratified', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'b', answeredBy: { provider: 'p', model: 'm' } } } }), { subject: "s1", pair: "p:m \u00d7 p:m", sampling: "stratified", a: "a", b: "b", ts: "t1" });
});

test('returns the pair record when sampling is unrecorded', () => {
  assert.deepEqual(stage1Pair({ subject: 's1', ts: 't1', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'b', answeredBy: { provider: 'p', model: 'm' } } } }), { subject: "s1", pair: "p:m \u00d7 p:m", sampling: "unrecorded", a: "a", b: "b", ts: "t1" });
});

test('returns null when pair key is null due to missing engine info', () => {
  assert.equal(stage1Pair({ subject: 's1', ts: 't1', detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', local: { classification: 'a' }, opus: { classification: 'b' } } }), null);
});
