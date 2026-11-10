// Normalises a usage window entry into a labelled state object (admin/lib/usage-plan.mjs normaliseWindow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseWindow } from '../lib/usage-plan.mjs';

test('returns absent state when v is null', () => {
  const r = normaliseWindow('five_hour', null);
  assert.deepEqual(r, { key: 'five_hour', label: '5-hour window', state: 'absent' });
});

test('returns absent state when v is undefined', () => {
  const r = normaliseWindow('seven_day', undefined);
  assert.deepEqual(r, { key: 'seven_day', label: '7-day window', state: 'absent' });
});

test('returns absent state when v is a string', () => {
  const r = normaliseWindow('five_hour', 'not-an-object');
  assert.deepEqual(r, { key: 'five_hour', label: '5-hour window', state: 'absent' });
});

test('returns absent state when v is a number', () => {
  const r = normaliseWindow('seven_day', 42);
  assert.deepEqual(r, { key: 'seven_day', label: '7-day window', state: 'absent' });
});

test('returns absent state when v is an empty object with no utilization', () => {
  const r = normaliseWindow('five_hour', {});
  assert.deepEqual(r, {
    key: 'five_hour',
    label: '5-hour window',
    state: 'unknown',
    utilization: null,
    resetsAt: null,
    lockedReason: null,
    limitDollars: null,
    usedDollars: null,
  });
});

test('returns live state with utilization when utilization is a number', () => {
  const r = normaliseWindow('seven_day', { utilization: 0.75, resets_at: '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, {
    key: 'seven_day',
    label: '7-day window',
    state: 'live',
    utilization: 0.75,
    resetsAt: '2025-01-01T00:00:00Z',
    lockedReason: null,
    limitDollars: null,
    usedDollars: null,
  });
});

test('returns unknown state when utilization is a string not a number', () => {
  const r = normaliseWindow('five_hour', { utilization: 'high' });
  assert.deepEqual(r, {
    key: 'five_hour',
    label: '5-hour window',
    state: 'unknown',
    utilization: null,
    resetsAt: null,
    lockedReason: null,
    limitDollars: null,
    usedDollars: null,
  });
});

test('returns live state with all fields populated', () => {
  const r = normaliseWindow('five_hour', {
    utilization: 1.0,
    resets_at: '2025-06-15T12:00:00Z',
    locked_reason: 'rate limited',
    limit_dollars: 100,
    used_dollars: 50,
  });
  assert.deepEqual(r, {
    key: 'five_hour',
    label: '5-hour window',
    state: 'live',
    utilization: 1.0,
    resetsAt: '2025-06-15T12:00:00Z',
    lockedReason: 'rate limited',
    limitDollars: 100,
    usedDollars: 50,
  });
});

test('returns unknown state when utilization is zero', () => {
  const r = normaliseWindow('seven_day', { utilization: 0 });
  assert.deepEqual(r, {
    key: 'seven_day',
    label: '7-day window',
    state: 'live',
    utilization: 0,
    resetsAt: null,
    lockedReason: null,
    limitDollars: null,
    usedDollars: null,
  });
});

test('uses windowLabel fallback for unknown key with underscores', () => {
  const r = normaliseWindow('custom_window', { utilization: 0.5 });
  assert.equal(r.label, 'custom window');
  assert.equal(r.state, 'live');
  assert.equal(r.utilization, 0.5);
});
