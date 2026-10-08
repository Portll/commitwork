// Computes a 0-1 divergence score between two triage verdicts (monitor/divergence.mjs divergenceScore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divergenceScore } from '../divergence.mjs';

test('returns null score when one verdict is absent', () => {
  const result = divergenceScore(null, { findings: [] });
  assert.deepEqual(result, { score: null, why: 'one side absent \u2014 undefined, not 0 and not 1' });
});

test('returns zero score for identical verdicts with no correlation', () => {
  const v = { verdict: 'real', findings: [{ id: '1', classification: 'real' }] };
  const result = divergenceScore(v, v, { correlation: 0 });
  assert.deepEqual(result, {
    score: 0,
    components: { perFinding: 0, verdictMismatch: 0, coveragePenalty: 0 },
    coverage: { both: 1, onlyOne: 0, total: 1 },
    correlation: 0,
  });
});

test('returns 0.7 score when classifications differ but verdicts match', () => {
  const a = { verdict: 'real', findings: [{ id: '1', classification: 'real' }] };
  const b = { verdict: 'real', findings: [{ id: '1', classification: 'false-positive' }] };
  const result = divergenceScore(a, b, { correlation: 0 });
  assert.deepEqual(result, {
    score: 0.7,
    components: { perFinding: 1, verdictMismatch: 0, coveragePenalty: 0 },
    coverage: { both: 1, onlyOne: 0, total: 1 },
    correlation: 0,
  });
});

test('returns 0.2 score when verdicts differ but findings match', () => {
  const a = { verdict: 'real', findings: [{ id: '1', classification: 'real' }] };
  const b = { verdict: 'false-positive', findings: [{ id: '1', classification: 'real' }] };
  const result = divergenceScore(a, b, { correlation: 0 });
  assert.deepEqual(result, {
    score: 0.2,
    components: { perFinding: 0, verdictMismatch: 1, coveragePenalty: 0 },
    coverage: { both: 1, onlyOne: 0, total: 1 },
    correlation: 0,
  });
});

test('returns 0.8 score when findings are disjoint but verdicts match', () => {
  const a = { verdict: 'real', findings: [{ id: '1', classification: 'real' }] };
  const b = { verdict: 'real', findings: [{ id: '2', classification: 'real' }] };
  const result = divergenceScore(a, b, { correlation: 0 });
  assert.deepEqual(result, {
    score: 0.8,
    components: { perFinding: 1, verdictMismatch: 0, coveragePenalty: 1 },
    coverage: { both: 0, onlyOne: 2, total: 2 },
    correlation: 0,
  });
});

test('returns 1 score when everything disagrees with no correlation', () => {
  const a = { verdict: 'real', findings: [{ id: '1', classification: 'real' }] };
  const b = { verdict: 'false-positive', findings: [{ id: '2', classification: 'false-positive' }] };
  const result = divergenceScore(a, b, { correlation: 0 });
  assert.deepEqual(result, {
    score: 1,
    components: { perFinding: 1, verdictMismatch: 1, coveragePenalty: 1 },
    coverage: { both: 0, onlyOne: 2, total: 2 },
    correlation: 0,
  });
});

test('reduces score when correlation is 1 and base is 0.7', () => {
  const a = { verdict: 'real', findings: [{ id: '1', classification: 'real' }] };
  const b = { verdict: 'real', findings: [{ id: '1', classification: 'false-positive' }] };
  const result = divergenceScore(a, b, { correlation: 1 });
  assert.deepEqual(result, {
    score: 1,
    components: { perFinding: 1, verdictMismatch: 0, coveragePenalty: 0 },
    coverage: { both: 1, onlyOne: 0, total: 1 },
    correlation: 1,
  });
});

test('handles needs-human classification as adjacent distance 0.5', () => {
  const a = { verdict: 'real', findings: [{ id: '1', classification: 'needs-human' }] };
  const b = { verdict: 'real', findings: [{ id: '1', classification: 'real' }] };
  const result = divergenceScore(a, b, { correlation: 0 });
  assert.deepEqual(result, {
    score: 0.35,
    components: { perFinding: 0.5, verdictMismatch: 0, coveragePenalty: 0 },
    coverage: { both: 1, onlyOne: 0, total: 1 },
    correlation: 0,
  });
});
