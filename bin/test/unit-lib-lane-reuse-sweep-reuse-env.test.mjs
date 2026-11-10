// Computes lane reuse environment variables based on mode and cache settings (bin/lib/lane-reuse.mjs sweepReuseEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepReuseEnv } from '../lib/lane-reuse.mjs';

test('returns off when mode is neither verify nor on', () => {
  const r = sweepReuseEnv('off', {}, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "off" });
});

test('returns off when mode is an empty string', () => {
  const r = sweepReuseEnv('', {}, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "off" });
});

test('returns mode and cache when mode is verify with no env cache', () => {
  const r = sweepReuseEnv('verify', {}, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "verify", CW_LANE_CACHE: "/default" });
});

test('returns mode and cache when mode is on with no env cache', () => {
  const r = sweepReuseEnv('on', {}, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "on", CW_LANE_CACHE: "/default" });
});

test('returns mode and env cache when mode is verify with env cache set', () => {
  const r = sweepReuseEnv('verify', { CW_LANE_CACHE: '/custom' }, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "verify", CW_LANE_CACHE: "/custom" });
});

test('returns mode and env cache when mode is on with env cache set', () => {
  const r = sweepReuseEnv('on', { CW_LANE_CACHE: '/custom' }, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "on", CW_LANE_CACHE: "/custom" });
});

test('returns off when mode is verify with empty string env cache', () => {
  const r = sweepReuseEnv('verify', { CW_LANE_CACHE: '' }, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "verify", CW_LANE_CACHE: "/default" });
});

test('returns mode and default cache when mode is on with empty string env cache', () => {
  const r = sweepReuseEnv('on', { CW_LANE_CACHE: '' }, '/default');
  assert.deepEqual(r, { CW_LANE_REUSE: "on", CW_LANE_CACHE: "/default" });
});
