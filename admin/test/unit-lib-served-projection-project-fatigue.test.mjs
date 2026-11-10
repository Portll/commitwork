// Computes the fatigue projection state and sanitized targets from a journal and report (admin/lib/served-projection.mjs projectFatigue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFatigue } from '../lib/served-projection.mjs';

test('returns no-journal state when journal is present and marked absent', () => {
  const result = projectFatigue({ absent: true }, { targets: [] });
  assert.deepEqual(result, { state: 'no-journal' });
});

test('returns no-journal state when journal is present and marked absent even with targets', () => {
  const result = projectFatigue({ absent: true }, { targets: [{ target: 'a', count: 1, labels: 1, everExpiring: false }] });
  assert.deepEqual(result, { state: 'no-journal' });
});

test('returns zero-unreinforced when no targets and no suppression-label records in journal', () => {
  const result = projectFatigue({ records: [{ kind: 'other' }] }, { targets: [] });
  assert.deepEqual(result, { state: 'zero-unreinforced' });
});

test('returns zero-unreinforced when no targets and journal is null', () => {
  const result = projectFatigue(null, { targets: [] });
  assert.deepEqual(result, { state: 'zero-unreinforced' });
});

test('returns zero-corroborated when no targets but suppression-label record exists in journal', () => {
  const result = projectFatigue({ records: [{ kind: 'suppression-label' }] }, { targets: [] });
  assert.deepEqual(result, { state: 'zero-corroborated' });
});

test('returns ok state with sanitized targets when targets are present', () => {
  const result = projectFatigue(null, { targets: [{ target: 'x', count: 5, labels: 2, everExpiring: true }] });
  assert.equal(result.state, 'ok');
  assert.equal(result.empty, false);
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].target, 'x');
  assert.equal(result.targets[0].count, 5);
  assert.equal(result.targets[0].labels, 2);
  assert.equal(result.targets[0].everExpiring, true);
});

test('truncates target string to 200 characters', () => {
  const longTarget = 'a'.repeat(250);
  const result = projectFatigue(null, { targets: [{ target: longTarget, count: 1, labels: 1, everExpiring: false }] });
  assert.equal(result.targets[0].target, 'a'.repeat(200));
});

test('defaults count and labels to 0 when not finite numbers', () => {
  const result = projectFatigue(null, { targets: [{ target: 't', count: 'bad', labels: NaN, everExpiring: false }] });
  assert.equal(result.targets[0].count, 0);
  assert.equal(result.targets[0].labels, 0);
});

test('coerces everExpiring to boolean', () => {
  const result = projectFatigue(null, { targets: [{ target: 't', count: 1, labels: 1, everExpiring: 1 }] });
  assert.equal(result.targets[0].everExpiring, true);
});

test('handles empty targets array with null journal', () => {
  const result = projectFatigue(null, { targets: [] });
  assert.deepEqual(result, { state: 'zero-unreinforced' });
});
