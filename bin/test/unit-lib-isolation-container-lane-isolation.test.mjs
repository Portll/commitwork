// Computes the container lane isolation level and reason from posture flags (bin/lib/isolation.mjs containerLaneIsolation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containerLaneIsolation } from '../lib/isolation.mjs';

test('returns fs-only when no posture flags are present', () => {
  const result = containerLaneIsolation({ local: ['echo hello'] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by the posture its script selects; host wrapper not applied'
  });
});

test('returns fs-only when check is undefined', () => {
  const result = containerLaneIsolation(undefined);
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by the posture its script selects; host wrapper not applied'
  });
});

test('returns fs-only when local is empty array', () => {
  const result = containerLaneIsolation({ local: [] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by the posture its script selects; host wrapper not applied'
  });
});

test('returns fs-only when posture value is not in POSTURES', () => {
  const result = containerLaneIsolation({ local: ['docker run --posture unknown-flag image'] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by posture unknown-flag; host wrapper not applied'
  });
});

test('returns fs-only when some posture values are known and some are not', () => {
  const result = containerLaneIsolation({ local: ['--posture strict --posture bogus'] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by posture strict, bogus; host wrapper not applied'
  });
});

test('returns fs-only when known posture has network not none', () => {
  const result = containerLaneIsolation({ local: ['--posture permissive'] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by posture permissive; host wrapper not applied'
  });
});

test('returns fs-only when single known posture has network none', () => {
  const result = containerLaneIsolation({ local: ['--posture strict'] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by posture strict; host wrapper not applied'
  });
});

test('returns fs-only when multiple identical known postures all have network none', () => {
  const result = containerLaneIsolation({ local: ['--posture strict --posture strict'] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by posture strict; host wrapper not applied'
  });
});

test('returns fs-only when multiple distinct known postures all have network none', () => {
  const result = containerLaneIsolation({ local: ['--posture strict --posture minimal'] });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by posture strict, minimal; host wrapper not applied'
  });
});

test('returns fs-only when local is null', () => {
  const result = containerLaneIsolation({ local: null });
  assert.deepEqual(result, {
    isolation: 'fs-only',
    isolationReason: 'container lane: confined by the posture its script selects; host wrapper not applied'
  });
});
