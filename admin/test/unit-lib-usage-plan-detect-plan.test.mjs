// Classifies a usage cache as metered, subscription, or unknown (admin/lib/usage-plan.mjs detectPlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlan } from '../lib/usage-plan.mjs';

test('returns unknown when cache is null', () => {
  const result = detectPlan(null);
  assert.deepEqual(result, { kind: 'unknown', why: 'no utilisation window reported a reading' });
});

test('returns unknown when cache has no utilization key', () => {
  const result = detectPlan({});
  assert.deepEqual(result, { kind: 'unknown', why: 'no utilisation window reported a reading' });
});

test('returns unknown when utilization is empty object', () => {
  const result = detectPlan({ utilization: {} });
  assert.deepEqual(result, { kind: 'unknown', why: 'no utilisation window reported a reading' });
});

test('returns unknown when utilization values are not objects', () => {
  const result = detectPlan({ utilization: { a: null, b: 42, c: 'str' } });
  assert.deepEqual(result, { kind: 'unknown', why: 'no utilisation window reported a reading' });
});

test('returns metered when one window has a dollar limit', () => {
  const cache = { utilization: { w1: { limit_dollars: 100, used_dollars: 10 } } };
  const result = detectPlan(cache);
  assert.equal(result.kind, 'metered');
  assert.equal(result.why, '1 window(s) report dollar limits, so spend is billed per token');
  assert.deepEqual(result.meteredWindows, ['w1']);
});

test('returns metered when multiple windows have dollar fields', () => {
  const cache = {
    utilization: {
      w1: { limit_dollars: 50 },
      w2: { used_dollars: 5 },
      w3: { remaining_dollars: 45 },
      w4: { limit_dollars: null, used_dollars: null },
    },
  };
  const result = detectPlan(cache);
  assert.equal(result.kind, 'metered');
  assert.equal(result.why, '3 window(s) report dollar limits, so spend is billed per token');
  assert.deepEqual(result.meteredWindows, ['w1', 'w2', 'w3']);
});

test('returns subscription when all windows have null dollar limits', () => {
  const cache = {
    utilization: {
      w1: { limit_dollars: null, used_dollars: null, remaining_dollars: null },
      w2: { limit_dollars: null },
    },
  };
  const result = detectPlan(cache);
  assert.equal(result.kind, 'subscription');
  assert.equal(result.why, 'every window reports null dollar limits, which is what a flat-rate plan looks like \u2014 per-token cost is not a measurement here');
});

test('returns subscription when windows have no dollar fields at all', () => {
  const cache = {
    utilization: {
      w1: { tokens: 1000 },
      w2: { requests: 50 },
    },
  };
  const result = detectPlan(cache);
  assert.equal(result.kind, 'subscription');
  assert.equal(result.why, 'every window reports null dollar limits, which is what a flat-rate plan looks like \u2014 per-token cost is not a measurement here');
});

test('returns metered when only remaining_dollars is a number', () => {
  const cache = { utilization: { w1: { limit_dollars: null, used_dollars: null, remaining_dollars: 0 } } };
  const result = detectPlan(cache);
  assert.equal(result.kind, 'metered');
  assert.equal(result.why, '1 window(s) report dollar limits, so spend is billed per token');
  assert.deepEqual(result.meteredWindows, ['w1']);
});

test('returns subscription when dollar fields are strings not numbers', () => {
  const cache = { utilization: { w1: { limit_dollars: '100', used_dollars: '10' } } };
  const result = detectPlan(cache);
  assert.equal(result.kind, 'subscription');
  assert.equal(result.why, 'every window reports null dollar limits, which is what a flat-rate plan looks like \u2014 per-token cost is not a measurement here');
});
