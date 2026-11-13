// Computes a SARIF remediation property object from a finding (lib/sarif-remediation.mjs remediationProperty).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remediationProperty } from '../sarif-remediation.mjs';

test('returns null when there are no candidates', () => {
  const input = {};
  const result = remediationProperty(input);
  assert.equal(result, null);
});

test('returns object with tier, fixStatus and sorted witness lanes when verification and witness are present', () => {
  const input = {
    candidates: [
      {
        tier: 'medium',
        verification: {
          status: 'verified',
          witness: {
            lanes: ['z', 'a', 'm'],
            before: 'old',
            after: 'new',
            digest: 'abc123',
          },
        },
      },
    ],
  };
  const result = remediationProperty(input);
  assert.deepEqual(result, { tier: "medium", fixStatus: "verified", witness: { lanes: ["a", "m", "z"], before: "old", after: "new", digest: "abc123" }, undeterminedReason: null });
});

test('uses null defaults when verification or witness fields are missing', () => {
  const input = {
    candidates: [
      {
        tier: 'low',
      },
    ],
  };
  const result = remediationProperty(input);
  assert.deepEqual(result, { tier: "low", fixStatus: undefined, witness: { lanes: [], before: null, after: null, digest: null }, undeterminedReason: null });
});

test('includes undeterminedReason when status is undetermined and reason is provided', () => {
  const input = {
    candidates: [
      {
        tier: 'high',
        verification: {
          status: 'undetermined',
          reason: 'needs review',
          witness: {},
        },
      },
    ],
  };
  const result = remediationProperty(input);
  assert.deepEqual(result, { tier: "high", fixStatus: "undetermined", witness: { lanes: [], before: null, after: null, digest: null }, undeterminedReason: "needs review" });
});

test('fallback sorting uses tier string comparison when tier rank and status rank are equal', () => {
  const input = {
    candidates: [
      {
        tier: 'alpha',
        id: '2',
        verification: { status: 'same' },
      },
      {
        tier: 'beta',
        id: '1',
        verification: { status: 'same' },
      },
    ],
  };
  const result = remediationProperty(input);
  assert.deepEqual(result, { tier: "alpha", fixStatus: "same", witness: { lanes: [], before: null, after: null, digest: null }, undeterminedReason: null });
});
