// Maps a numeric score to a severity label (lib/judge-taxonomy.mjs severityFromScore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { severityFromScore } from '../judge-taxonomy.mjs';

test('returns null for null input', () => {
  const input = null;
  const result = severityFromScore(input);
  assert.equal(result, null);
});

test('returns null for undefined input', () => {
  const input = undefined;
  const result = severityFromScore(input);
  assert.equal(result, null);
});

test('returns null for empty string input', () => {
  const input = '';
  const result = severityFromScore(input);
  assert.equal(result, null);
});

test('returns null for boolean input', () => {
  const input = true;
  const result = severityFromScore(input);
  assert.equal(result, null);
});

test('returns null for negative score', () => {
  const input = -1;
  const result = severityFromScore(input);
  assert.equal(result, null);
});

test('returns null for score above ten', () => {
  const input = 11;
  const result = severityFromScore(input);
  assert.equal(result, null);
});

test('returns crit for score nine', () => {
  const input = 9;
  const result = severityFromScore(input);
  assert.equal(result, "crit");
});

test('returns high for score seven', () => {
  const input = 7;
  const result = severityFromScore(input);
  assert.equal(result, "high");
});

test('returns med for score four', () => {
  const input = 4;
  const result = severityFromScore(input);
  assert.equal(result, "med");
});

test('returns low for score zero', () => {
  const input = 0;
  const result = severityFromScore(input);
  assert.equal(result, "low");
});
