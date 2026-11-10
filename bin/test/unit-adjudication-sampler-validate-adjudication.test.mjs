// Validates that an adjudication's truth agrees with the record's classified stratum (bin/adjudication-sampler.mjs validateAdjudication).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdjudication } from '../adjudication-sampler.mjs';

test('returns ok when adjudication is null', () => {
  const result = validateAdjudication(null, { verdict: 'steady' });
  assert.deepEqual(result, { ok: true, reason: 'not an adjudication \u2014 nothing to check' });
});

test('returns ok when kind is not adjudication', () => {
  const result = validateAdjudication({ kind: 'other', gate: 'gate-tests', truth: 'true-clean' }, { verdict: 'steady' });
  assert.deepEqual(result, { ok: true, reason: 'not an adjudication \u2014 nothing to check' });
});

test('returns ok when truth is null', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: null }, { verdict: 'steady' });
  assert.deepEqual(result, { ok: true, reason: 'no truth asserted, so nothing contradicts the record' });
});

test('returns ok when record is null', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'true-clean' }, null);
  assert.deepEqual(result, { ok: true, reason: 'no live record to compare against (canary, retrospective or unresolvable)' });
});

test('returns ok with unverifiable when record verdict is unclassified', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'true-clean' }, { verdict: 'unknown-verdict' });
  assert.equal(result.ok, true);
  assert.equal(result.unverifiable, true);
  assert.match(result.reason, /UNVERIFIED/);
});

test('returns ok when truth matches clean stratum', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'true-clean' }, { verdict: 'steady' });
  assert.deepEqual(result, { ok: true, reason: 'truth agrees with the record\'s clean verdict' });
});

test('returns ok when truth matches alarm stratum', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'true-alarm' }, { verdict: 'regression-committed' });
  assert.deepEqual(result, { ok: true, reason: 'truth agrees with the record\'s alarm verdict' });
});

test('returns ok when false-clean matches clean stratum', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'false-clean' }, { verdict: 'steady' });
  assert.deepEqual(result, { ok: true, reason: 'truth agrees with the record\'s clean verdict' });
});

test('returns ok when false-alarm matches alarm stratum', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'false-alarm' }, { verdict: 'regression-committed' });
  assert.deepEqual(result, { ok: true, reason: 'truth agrees with the record\'s alarm verdict' });
});

test('returns ok when truth matches neither stratum', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'true-clean' }, { verdict: 'no-tally' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /NO clean-or-alarm claim/);
});

test('returns ok when truth contradicts stratum', () => {
  const result = validateAdjudication({ kind: 'adjudication', gate: 'gate-tests', truth: 'true-clean' }, { verdict: 'regression-committed' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /one of the two is wrong/);
});
