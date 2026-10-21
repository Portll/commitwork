// Computes the join key for a record (bin/rater-accuracy.mjs subjectKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectKey } from '../rater-accuracy.mjs';

test('returns gate and recordAt joined by @ when both are present', () => {
  const r = { gate: 'g1', recordAt: '2024-01-01T00:00:00Z' };
  assert.equal(subjectKey(r), 'g1@2024-01-01T00:00:00Z');
});

test('returns canary prefixed with canary: when canary is present and gate is absent', () => {
  const r = { canary: 'c1' };
  assert.equal(subjectKey(r), 'canary:c1');
});

test('returns null when neither gate nor canary is present', () => {
  const r = {};
  assert.equal(subjectKey(r), null);
});

test('returns null when gate is present but recordAt is missing', () => {
  const r = { gate: 'g1' };
  assert.equal(subjectKey(r), null);
});

test('returns null when recordAt is present but gate is missing', () => {
  const r = { recordAt: '2024-01-01T00:00:00Z' };
  assert.equal(subjectKey(r), null);
});

test('returns gate and recordAt joined by @ when canary is also present', () => {
  const r = { gate: 'g1', recordAt: '2024-01-01T00:00:00Z', canary: 'c1' };
  assert.equal(subjectKey(r), 'g1@2024-01-01T00:00:00Z');
});

test('returns canary prefixed with canary: when gate is falsy but canary is present', () => {
  const r = { gate: '', canary: 'c1' };
  assert.equal(subjectKey(r), 'canary:c1');
});

test('returns null when gate is falsy and recordAt is present', () => {
  const r = { gate: '', recordAt: '2024-01-01T00:00:00Z' };
  assert.equal(subjectKey(r), null);
});

test('returns null when all fields are falsy', () => {
  const r = { gate: '', recordAt: '', canary: '' };
  assert.equal(subjectKey(r), null);
});

test('returns gate and recordAt joined by @ when gate and recordAt are truthy strings', () => {
  const r = { gate: 'main', recordAt: '2024-06-15T12:00:00Z' };
  assert.equal(subjectKey(r), 'main@2024-06-15T12:00:00Z');
});
