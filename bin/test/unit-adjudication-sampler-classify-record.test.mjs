// Maps a gate record to its stratum (clean, alarm, neither, or unclassified) (bin/adjudication-sampler.mjs classifyRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecord } from '../adjudication-sampler.mjs';

test('returns unclassified when gate is not in registry', () => {
  const result = classifyRecord('nonexistent-gate', { verdict: 'steady' });
  assert.deepEqual(result, { stratum: 'unclassified', verdict: null });
});

test('returns unclassified when record is null', () => {
  const result = classifyRecord('gate-tests', null);
  assert.deepEqual(result, { stratum: 'unclassified', verdict: null });
});

test('returns unclassified when verdict field is undefined', () => {
  const result = classifyRecord('gate-tests', { fail: 0, pass: 10 });
  assert.deepEqual(result, { stratum: 'unclassified', verdict: null });
});

test('returns unclassified when verdict field is null', () => {
  const result = classifyRecord('gate-tests', { verdict: null, fail: 0, pass: 10 });
  assert.deepEqual(result, { stratum: 'unclassified', verdict: null });
});

test('classifies clean verdict for gate-tests', () => {
  const result = classifyRecord('gate-tests', { verdict: 'steady', fail: 0, pass: 10 });
  assert.deepEqual(result, { stratum: 'clean', verdict: 'steady' });
});

test('classifies alarm verdict for gate-tests', () => {
  const result = classifyRecord('gate-tests', { verdict: 'regression-committed', fail: 3, pass: 7 });
  assert.deepEqual(result, { stratum: 'alarm', verdict: 'regression-committed' });
});

test('classifies neither verdict for gate-tests', () => {
  const result = classifyRecord('gate-tests', { verdict: 'no-tally', fail: null, pass: null });
  assert.deepEqual(result, { stratum: 'neither', verdict: 'no-tally' });
});

test('classifies unclassified for unknown verdict value', () => {
  const result = classifyRecord('gate-tests', { verdict: 'some-unknown-value', fail: 0, pass: 10 });
  assert.deepEqual(result, { stratum: 'unclassified', verdict: 'some-unknown-value' });
});

test('sets greyMismatch when grey is true and stratum is clean', () => {
  const result = classifyRecord('gate-spine', { verdict: 'below-threshold', grey: true, edits: 1, spineRecords: 5 });
  assert.deepEqual(result, { stratum: 'clean', verdict: 'below-threshold', greyMismatch: true });
});

test('does not set greyMismatch when grey is true and stratum is neither', () => {
  const result = classifyRecord('gate-spine', { verdict: 'sensor-absent', grey: true, edits: 0, spineRecords: 0 });
  assert.deepEqual(result, { stratum: 'neither', verdict: 'sensor-absent' });
});
