// selects the best verified candidate according to tier priority (lib/remediation-contract.mjs chosenCandidate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenCandidate } from '../remediation-contract.mjs';

test('returns null when finding has no candidates property', () => {
  const input = {};
  const result = chosenCandidate(input);
  assert.equal(result, null);
});

test('returns null when candidates array is empty', () => {
  const input = { candidates: [] };
  const result = chosenCandidate(input);
  assert.equal(result, null);
});

test('filters out candidates that are not verified', () => {
  const input = {
    candidates: [
      { verification: { status: 'unverified' }, tier: 'deterministic' },
      { verification: { status: 'pending' }, tier: 'rule' },
    ],
  };
  const result = chosenCandidate(input);
  assert.equal(result, null);
});

test('filters out candidates with tier not in TIERS', () => {
  const input = {
    candidates: [
      { verification: { status: 'verified' }, tier: 'unknown' },
    ],
  };
  const result = chosenCandidate(input);
  assert.equal(result, null);
});

test('selects deterministic over rule when both are verified', () => {
  const input = {
    candidates: [
      { verification: { status: 'verified' }, tier: 'rule' },
      { verification: { status: 'verified' }, tier: 'deterministic' },
    ],
  };
  const result = chosenCandidate(input);
  assert.deepEqual(result, { verification: { status: "verified" }, tier: "deterministic" });
});

test('selects rule over codemod when deterministic is absent', () => {
  const input = {
    candidates: [
      { verification: { status: 'verified' }, tier: 'codemod' },
      { verification: { status: 'verified' }, tier: 'rule' },
    ],
  };
  const result = chosenCandidate(input);
  assert.deepEqual(result, { verification: { status: "verified" }, tier: "rule" });
});

test('when two candidates have same tier, original picks the first (detects <= change)', () => {
  const input = {
    candidates: [
      { verification: { status: 'verified' }, tier: 'rule' },
      { verification: { status: 'verified' }, tier: 'rule' },
    ],
  };
  const result = chosenCandidate(input);
  assert.deepEqual(result, { verification: { status: "verified" }, tier: "rule" });
});

test('ignores falsy candidate entries and continues processing', () => {
  const input = {
    candidates: [
      null,
      { verification: { status: 'verified' }, tier: 'deterministic' },
    ],
  };
  const result = chosenCandidate(input);
  assert.deepEqual(result, { verification: { status: "verified" }, tier: "deterministic" });
});

test('ignores candidate with missing verification status', () => {
  const input = {
    candidates: [
      { tier: 'deterministic' },
      { verification: { status: 'verified' }, tier: 'rule' },
    ],
  };
  const result = chosenCandidate(input);
  assert.deepEqual(result, { verification: { status: "verified" }, tier: "rule" });
});
