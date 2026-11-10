// Computes defect-signature rate and min-repos thresholds from env vars (monitor/defect-signature.mjs thresholds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thresholds } from '../defect-signature.mjs';

test('returns defaults when env is empty', () => {
  const r = thresholds({});
  assert.deepEqual(r, { rate: 0.95, minRepos: 20 });
});

test('accepts rate of 1 as valid', () => {
  const r = thresholds({ CW_DEFECT_SIGNATURE_RATE: '1' });
  assert.deepEqual(r, { rate: 1, minRepos: 20 });
});

test('accepts rate of 0.5 as valid', () => {
  const r = thresholds({ CW_DEFECT_SIGNATURE_RATE: '0.5' });
  assert.deepEqual(r, { rate: 0.5, minRepos: 20 });
});

test('rejects rate of 0 with RangeError', () => {
  assert.throws(() => thresholds({ CW_DEFECT_SIGNATURE_RATE: '0' }), { name: "RangeError", message: "CW_DEFECT_SIGNATURE_RATE=\"0\" is not a usable threshold" });
});

test('rejects rate of 1.5 with RangeError', () => {
  assert.throws(() => thresholds({ CW_DEFECT_SIGNATURE_RATE: '1.5' }), { name: "RangeError", message: "CW_DEFECT_SIGNATURE_RATE=\"1.5\" is not a usable threshold" });
});

test('accepts minRepos of 1 as valid', () => {
  const r = thresholds({ CW_DEFECT_SIGNATURE_MIN_REPOS: '1' });
  assert.deepEqual(r, { rate: 0.95, minRepos: 1 });
});

test('rejects minRepos of 0 with RangeError', () => {
  assert.throws(() => thresholds({ CW_DEFECT_SIGNATURE_MIN_REPOS: '0' }), { name: "RangeError", message: "CW_DEFECT_SIGNATURE_MIN_REPOS=\"0\" is not a usable threshold" });
});

test('rejects non-integer minRepos with RangeError', () => {
  assert.throws(() => thresholds({ CW_DEFECT_SIGNATURE_MIN_REPOS: '1.5' }), { name: "RangeError", message: "CW_DEFECT_SIGNATURE_MIN_REPOS=\"1.5\" is not a usable threshold" });
});
