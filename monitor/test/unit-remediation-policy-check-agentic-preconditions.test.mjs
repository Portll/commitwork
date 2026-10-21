// Checks whether an agentic policy mode is permitted based on the freshness of the corpus-replay witness (monitor/remediation-policy.mjs checkAgenticPreconditions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAgenticPreconditions } from '../remediation-policy.mjs';

test('returns ok true with null mode and witness when policy is undefined', () => {
  const result = checkAgenticPreconditions({});
  assert.deepEqual(result, { ok: true, mode: null, witness: null, errors: [] });
});

test('returns ok true with null mode and witness when policy is null', () => {
  const result = checkAgenticPreconditions({ policy: null });
  assert.deepEqual(result, { ok: true, mode: null, witness: null, errors: [] });
});

test('returns ok true with mode and null witness when mode is not agentic', () => {
  const result = checkAgenticPreconditions({ policy: { mode: 'manual' } });
  assert.deepEqual(result, { ok: true, mode: 'manual', witness: null, errors: [] });
});

test('returns ok true with null mode and witness when mode is missing from policy object', () => {
  const result = checkAgenticPreconditions({ policy: {} });
  assert.deepEqual(result, { ok: true, mode: null, witness: null, errors: [] });
});

test('returns ok true with empty string mode and null witness when mode is empty string', () => {
  const result = checkAgenticPreconditions({ policy: { mode: '' } });
  assert.deepEqual(result, { ok: true, mode: '', witness: null, errors: [] });
});

test('returns ok false with witness state absent when mode is hitl-agentic and witness file is missing', () => {
  const wp = '/tmp/nonexistent-witness.json';
  const result = checkAgenticPreconditions({ policy: { mode: 'hitl-agentic' }, witnessPath: wp });
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'hitl-agentic');
  assert.equal(result.witness.state, 'absent');
  assert.equal(result.witness.path, wp);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /mode=hitl-agentic is refused/);
  assert.match(result.errors[0], /absent/);
  assert.match(result.errors[0], new RegExp(wp));
});

test('returns ok false with witness state absent when mode is full-agentic and witness file is missing', () => {
  const wp = '/tmp/nonexistent-witness.json';
  const result = checkAgenticPreconditions({ policy: { mode: 'full-agentic' }, witnessPath: wp });
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'full-agentic');
  assert.equal(result.witness.state, 'absent');
  assert.equal(result.witness.path, wp);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /mode=full-agentic is refused/);
  assert.match(result.errors[0], /absent/);
  assert.match(result.errors[0], new RegExp(wp));
});
