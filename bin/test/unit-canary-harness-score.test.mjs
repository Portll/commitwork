// Maps a gate exit code and last-run verdict to a truth label and observation string (bin/canary-harness.mjs score).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../canary-harness.mjs';

test('claim with exit 2 and matching attribution returns true-alarm with correct attribution', () => {
  const r = score('claim', { code: 2, last: { verdict: 'v', attribution: { claim: 'c' } } }, { expectClaim: 'c' });
  assert.deepEqual(r, { truth: 'true-alarm', attributionCorrect: true, observed: 'exit 2 \u00b7 v \u00b7 claim c (expected c)' });
});

test('claim with exit 0 returns false-clean with undefined attribution', () => {
  const r = score('claim', { code: 0, last: { verdict: 'v', attribution: { claim: 'c' } } }, { expectClaim: 'c' });
  assert.deepEqual(r, { truth: 'false-clean', attributionCorrect: undefined, observed: 'exit 0 \u00b7 v \u00b7 claim c (expected c)' });
});

test('alarm with exit 2 returns true-alarm', () => {
  const r = score('alarm', { code: 2, last: { verdict: 'v' } });
  assert.deepEqual(r, { truth: 'true-alarm', observed: 'exit 2 \u00b7 v' });
});

test('alarm with exit 0 returns false-clean', () => {
  const r = score('alarm', { code: 0, last: { verdict: 'v' } });
  assert.deepEqual(r, { truth: 'false-clean', observed: 'exit 0 \u00b7 v' });
});

test('alarm with ledgerAbsent returns false-clean with reader disagreement note', () => {
  const r = score('alarm', { code: 2, last: { verdict: 'v' } }, { ledgerAbsent: true });
  assert.deepEqual(r, { truth: 'false-clean', observed: 'exit 2 \u00b7 v \u00b7 THE READER FOUND NO LEDGER at the writer\'s own default \u2014 reader and writer disagree on where it lives (N1)' });
});

test('quiet with exit 0 and non-null non-refusal verdict returns true-clean', () => {
  const r = score('quiet', { code: 0, last: { verdict: 'ok' } });
  assert.deepEqual(r, { truth: 'true-clean', observed: 'exit 0 \u00b7 ok' });
});

test('quiet with exit 0 and null verdict returns false-alarm', () => {
  const r = score('quiet', { code: 0, last: { verdict: null } });
  assert.deepEqual(r, { truth: 'false-alarm', observed: 'exit 0 \u00b7 null' });
});

test('quiet with exit 0 and refusal verdict returns false-alarm', () => {
  const r = score('quiet', { code: 0, last: { verdict: 'no-tally' } });
  assert.deepEqual(r, { truth: 'false-alarm', observed: 'exit 0 \u00b7 no-tally' });
});

test('quiet with provenanceMissing returns false-clean with provenance note', () => {
  const r = score('quiet', { code: 0, last: { verdict: 'ok' } }, { provenanceMissing: true });
  assert.deepEqual(r, { truth: 'false-clean', observed: 'exit 0 \u00b7 ok \u00b7 NO MEASUREMENT PROVENANCE \u2014 the record cannot show whether the source ran' });
});

test('refuse with refusal verdict and no banking returns true-alarm', () => {
  const r = score('refuse', { code: 1, last: { verdict: 'no-tally' } });
  assert.deepEqual(r, { truth: 'true-alarm', observed: 'exit 1 \u00b7 no-tally' });
});

test('refuse with refusal verdict and banking returns false-clean with banking note', () => {
  const r = score('refuse', { code: 1, last: { verdict: 'no-tally' } }, { banked: true });
  assert.deepEqual(r, { truth: 'false-clean', observed: 'exit 1 \u00b7 no-tally \u00b7 BANKED A NEW BASELINE OVER CORRUPT INPUT' });
});

test('refuse with non-refusal verdict returns false-clean', () => {
  const r = score('refuse', { code: 1, last: { verdict: 'ok' } });
  assert.deepEqual(r, { truth: 'false-clean', observed: 'exit 1 \u00b7 ok' });
});
