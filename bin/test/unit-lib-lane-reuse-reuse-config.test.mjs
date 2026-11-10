// Resolves lane reuse mode and cache settings from environment variables (bin/lib/lane-reuse.mjs reuseConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reuseConfig } from '../lib/lane-reuse.mjs';

test('returns null when CW_LANE_REUSE is off', () => {
  const r = reuseConfig({ CW_LANE_REUSE: 'off', CW_LANE_CACHE: '/tmp/cache' });
  assert.deepEqual(r, null);
});

test('returns null when CW_LANE_CACHE is missing', () => {
  const r = reuseConfig({ CW_LANE_REUSE: 'on' });
  assert.deepEqual(r, null);
});

test('returns null when CW_LANE_REUSE is verify and CW_LANE_CACHE is missing', () => {
  const r = reuseConfig({ CW_LANE_REUSE: 'verify' });
  assert.deepEqual(r, null);
});

test('returns config object when CW_LANE_REUSE is on and CW_LANE_CACHE is set', () => {
  const r = reuseConfig({ CW_LANE_REUSE: 'on', CW_LANE_CACHE: '/tmp/cache' });
  assert.deepEqual(r, { mode: "on", cache: "/tmp/cache", maxFiles: 200000 });
});

test('returns config object when CW_LANE_REUSE is verify and CW_LANE_CACHE is set', () => {
  const r = reuseConfig({ CW_LANE_REUSE: 'verify', CW_LANE_CACHE: '/tmp/cache' });
  assert.deepEqual(r, { mode: "verify", cache: "/tmp/cache", maxFiles: 200000 });
});

test('returns null when CW_LANE_REUSE is invalid and CW_LANE_CACHE is set', () => {
  const r = reuseConfig({ CW_LANE_REUSE: 'invalid', CW_LANE_CACHE: '/tmp/cache' });
  assert.deepEqual(r, null);
});

test('returns null when CW_LANE_REUSE is unset and CW_LANE_CACHE is set', () => {
  const r = reuseConfig({ CW_LANE_CACHE: '/tmp/cache' });
  assert.deepEqual(r, null);
});

test('returns config object when CW_LANE_REUSE is on and CW_LANE_CACHE is empty string', () => {
  const r = reuseConfig({ CW_LANE_REUSE: 'on', CW_LANE_CACHE: '' });
  assert.deepEqual(r, null);
});
