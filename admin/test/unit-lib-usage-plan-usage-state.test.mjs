// Computes the current Claude usage plan, per-window utilization, and freshness (admin/lib/usage-plan.mjs usageState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageState } from '../lib/usage-plan.mjs';

const mk = (cache, now = 1000) => usageState({ now, readFile: () => JSON.stringify({ cachedUsageUtilization: cache }) });

test('returns ok false with absent state when the config file is missing', () => {
  const err = Object.assign(new Error('no file'), { code: 'ENOENT' });
  const out = usageState({ now: 1, readFile: () => { throw err; } });
  assert.deepEqual(out, { ok: false, state: 'absent', why: 'no Claude config on this box', plan: { kind: 'unknown', why: 'no Claude config on this box' }, windows: [] });
});

test('returns ok false with unreadable state when the file is not valid JSON', () => {
  const out = usageState({ now: 1, readFile: () => 'not json' });
  assert.equal(out.ok, false);
  assert.equal(out.state, 'unreadable');
  assert.match(out.why, /config is not JSON/);
  assert.deepEqual(out.windows, []);
});

test('returns ok false with absent state when cachedUsageUtilization is missing', () => {
  const out = usageState({ now: 1, readFile: () => JSON.stringify({}) });
  assert.equal(out.ok, false);
  assert.equal(out.state, 'absent');
  assert.match(out.why, /no cachedUsageUtilization/);
});

test('detects a metered plan and reports dollars as meaningful', () => {
  const cache = { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 0.5, resets_at: 'r', limit_dollars: 10, used_dollars: 5 } } };
  const out = mk(cache, 1000);
  assert.equal(out.ok, true);
  assert.equal(out.state, 'live');
  assert.equal(out.plan.kind, 'metered');
  assert.deepEqual(out.plan.meteredWindows, ['five_hour']);
  assert.equal(out.dollarsAreMeaningful, true);
  assert.equal(out.fetchedAtMs, 1000);
  assert.equal(out.ageMs, 0);
  assert.equal(out.stale, false);
  assert.equal(out.freshWindowMs, 900000);
  assert.equal(out.windows.length, 1);
  assert.equal(out.windows[0].key, 'five_hour');
  assert.equal(out.windows[0].state, 'live');
  assert.equal(out.windows[0].utilization, 0.5);
  assert.equal(out.windows[0].limitDollars, 10);
  assert.equal(out.windows[0].usedDollars, 5);
  assert.deepEqual(out.otherActive, []);
});

test('detects a subscription plan when dollar limits are null', () => {
  const cache = { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 0.2, limit_dollars: null, used_dollars: null } } };
  const out = mk(cache, 1000);
  assert.equal(out.plan.kind, 'subscription');
  assert.equal(out.dollarsAreMeaningful, false);
  assert.equal(out.windows[0].limitDollars, null);
  assert.equal(out.windows[0].usedDollars, null);
});

test('detects an unknown plan when no window reports a reading', () => {
  const cache = { fetchedAtMs: 1000, utilization: { five_hour: null } };
  const out = mk(cache, 1000);
  assert.equal(out.plan.kind, 'unknown');
  assert.match(out.plan.why, /no utilisation window/);
  assert.deepEqual(out.windows, []);
});

test('marks the reading stale when age exceeds the fresh window', () => {
  const cache = { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 0.1 } } };
  const out = mk(cache, 1000 + 900001);
  assert.equal(out.ageMs, 900001);
  assert.equal(out.stale, true);
});

test('marks the reading fresh when age equals the fresh window boundary', () => {
  const cache = { fetchedAtMs: 1000, utilization: { five_hour: { utilization: 0.1 } } };
  const out = mk(cache, 1000 + 900000);
  assert.equal(out.ageMs, 900000);
  assert.equal(out.stale, false);
});

test('sets stale to null when fetchedAtMs is missing', () => {
  const cache = { utilization: { five_hour: { utilization: 0.1 } } };
  const out = mk(cache, 5000);
  assert.equal(out.fetchedAtMs, null);
  assert.equal(out.ageMs, null);
  assert.equal(out.stale, null);
});

test('names a non-primary live window in otherActive and drops absent primary windows', () => {
  const cache = { fetchedAtMs: 1000, utilization: { five_hour: null, seven_day: { utilization: 0.3 }, monthly: { utilization: 0.9 } } };
  const out = mk(cache, 1000);
  assert.equal(out.windows.length, 1);
  assert.equal(out.windows[0].key, 'seven_day');
  assert.equal(out.otherActive.length, 1);
  assert.equal(out.otherActive[0].key, 'monthly');
  assert.equal(out.otherActive[0].utilization, 0.9);
});
