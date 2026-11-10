// Returns a Set of IDs for criteria where static is false (monitor/a11y-attestations.mjs attestableCriteria).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attestableCriteria } from '../a11y-attestations.mjs';

test('attestableCriteria returns the expected set of IDs (first call)', () => {
  const r = attestableCriteria();
  assert.deepEqual(r, new Set(["2.4.11", "2.5.8", "3.3.7", "1.4.11", "2.4.3", "1.3.2"]));
});

test('attestableCriteria returns the expected set of IDs (second call)', () => {
  const r = attestableCriteria();
  assert.deepEqual(r, new Set(["2.4.11", "2.5.8", "3.3.7", "1.4.11", "2.4.3", "1.3.2"]));
});

test('attestableCriteria returns the expected set of IDs (third call)', () => {
  const r = attestableCriteria();
  assert.deepEqual(r, new Set(["2.4.11", "2.5.8", "3.3.7", "1.4.11", "2.4.3", "1.3.2"]));
});

test('attestableCriteria returns the expected set of IDs (fourth call)', () => {
  const r = attestableCriteria();
  assert.deepEqual(r, new Set(["2.4.11", "2.5.8", "3.3.7", "1.4.11", "2.4.3", "1.3.2"]));
});
