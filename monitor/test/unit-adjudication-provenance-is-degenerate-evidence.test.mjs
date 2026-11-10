// Detects whether evidence is degenerate (null, empty, or all parts are stringified objects) (monitor/adjudication-provenance.mjs isDegenerateEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDegenerateEvidence } from '../adjudication-provenance.mjs';

test('returns true for null input', () => {
  assert.equal(isDegenerateEvidence(null), true);
});

test('returns true for undefined input', () => {
  assert.equal(isDegenerateEvidence(undefined), true);
});

test('returns true for empty string', () => {
  assert.equal(isDegenerateEvidence(''), true);
});

test('returns true for whitespace-only string', () => {
  assert.equal(isDegenerateEvidence('   '), true);
});

test('returns true when all comma-separated parts are stringified objects', () => {
  assert.equal(isDegenerateEvidence('[object Object],[object Object]'), true);
});

test('returns false when at least one part is not a stringified object', () => {
  assert.equal(isDegenerateEvidence('[object Object],real-data'), false);
});

test('returns false for a single non-object part', () => {
  assert.equal(isDegenerateEvidence('hello'), false);
});

test('returns true for a single stringified object part', () => {
  assert.equal(isDegenerateEvidence('[object Object]'), true);
});
