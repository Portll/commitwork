// Renders a human-readable verdict for a set-difference result (monitor/set-difference.mjs render).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../set-difference.mjs';

test('returns undetermined message when unknown is true', () => {
  const r = render({ unknown: true, unknownReason: 'no data', unknownDetail: 'timeout' });
  assert.equal(r, "undetermined (no data) \u2014 timeout: NOT clean, NOT a finding");
});

test('returns saturated message when saturated is true', () => {
  const r = render({ saturated: true, complement: ['a', 'b', 'c'], denominator: 10, label: 'feature', complementFraction: 0.3 });
  assert.equal(r, "3 of 10 lack 'feature' \u2014 a 30.0% complement is a DEFECT SIGNATURE of the check itself, not a finding about the fleet");
});

test('returns tier 1 clean message when complement is empty and tier is 1', () => {
  const r = render({ complement: [], denominator: 5, label: 'invariant', tier: 1 });
  assert.equal(r, "all 5 members satisfy the declared invariant 'invariant'");
});

test('returns tier 2 nothing stands out message when complement is empty and tier is 2', () => {
  const r = render({ complement: [], denominator: 5, label: 'invariant', tier: 2 });
  assert.equal(r, "all 5 members share 'invariant' \u2014 tier 2: necessity not established, so this is \"nothing stands out\", not \"clean\"");
});

test('returns single outlier message when complement has one element', () => {
  const r = render({ complement: [{ key: 'repo-a' }], denominator: 10, label: 'feature', tier: 1 });
  assert.equal(r, "repo-a is the only one of 10 without 'feature' its 9 peers have \u2014 tier 1, a place to look, not a verdict");
});

test('returns multiple outliers message when complement has two elements', () => {
  const r = render({ complement: [{ key: 'repo-a' }, { key: 'repo-b' }], denominator: 10, label: 'feature', tier: 1 });
  assert.equal(r, "2 of 10 lack 'feature' the other 8 have \u2014 tier 1, a place to look, not a verdict");
});

test('returns multiple outliers message when complement has three elements', () => {
  const r = render({ complement: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], denominator: 10, label: 'feature', tier: 2 });
  assert.equal(r, "3 of 10 lack 'feature' the other 7 have \u2014 tier 2, a place to look, not a verdict");
});

test('returns undetermined message without detail when unknownDetail is empty', () => {
  const r = render({ unknown: true, unknownReason: 'error', unknownDetail: '' });
  assert.equal(r, "undetermined (error): NOT clean, NOT a finding");
});
