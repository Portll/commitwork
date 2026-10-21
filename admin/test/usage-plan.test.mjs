import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readUsage, detectPlan, normaliseWindow, usageState, resetsIn, windowLabel, configPath, freshWindowMs,
} from '../lib/usage-plan.mjs';

const withEnv = (k, v, fn) => {
  const prev = process.env[k];
  try { if (v === undefined) delete process.env[k]; else process.env[k] = v; return fn(); }
  finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; }
};

const subscriptionCache = (over = {}) => ({
  fetchedAtMs: 1_000_000,
  utilization: {
    five_hour: { utilization: 32, resets_at: '2026-09-24T16:29:59Z', limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
    seven_day: { utilization: 9, resets_at: '2026-09-29T19:59:59Z', limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
    seven_day_opus: null,
    nimbus_quill: { utilization: 0, resets_at: null, limit_dollars: null, used_dollars: null, remaining_dollars: null },
    ...over,
  },
});
const asFile = (doc) => () => JSON.stringify(doc);

// ── plan detection ──────────────────────────────────────────────────────────────────────────────
// This is the whole point of the module: the operator is not asked which plan they are on, because
// an operator who can answer can also answer wrongly, and the panel would believe them.

test('null dollar fields across every window mean SUBSCRIPTION — the Max x20 case', () => {
  const p = detectPlan(subscriptionCache());
  assert.equal(p.kind, 'subscription');
  assert.match(p.why, /flat-rate/);
});

test('a populated dollar field anywhere means METERED, and names which window said so', () => {
  const p = detectPlan(subscriptionCache({
    five_hour: { utilization: 12, limit_dollars: 50, used_dollars: 6, remaining_dollars: 44 },
  }));
  assert.equal(p.kind, 'metered');
  assert.deepEqual(p.meteredWindows, ['five_hour']);
});

test('no window at all is UNKNOWN, not subscription — absence of metering is not evidence of a plan', () => {
  assert.equal(detectPlan({ utilization: {} }).kind, 'unknown');
  assert.equal(detectPlan({ utilization: { a: null, b: null } }).kind, 'unknown');
  assert.equal(detectPlan(null).kind, 'unknown');
});

test('dollarsAreMeaningful is the one question the panel asks, and it is false on a subscription', () => {
  const sub = usageState({ readFile: asFile({ cachedUsageUtilization: subscriptionCache() }) });
  assert.equal(sub.dollarsAreMeaningful, false,
    'rendering $0.0000 on a flat-rate plan is the defect this module exists to stop');
  const metered = usageState({
    readFile: asFile({ cachedUsageUtilization: subscriptionCache({ five_hour: { utilization: 1, limit_dollars: 20, used_dollars: 1, remaining_dollars: 19 } }) }),
  });
  assert.equal(metered.dollarsAreMeaningful, true);
});

// ── fail closed ─────────────────────────────────────────────────────────────────────────────────

test('ENOENT is ABSENT; an unparseable or unreadable config is UNREADABLE, never absent', () => {
  const enoent = readUsage({ readFile: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } });
  assert.equal(enoent.state, 'absent');

  const eacces = readUsage({ readFile: () => { const e = new Error('x'); e.code = 'EACCES'; throw e; } });
  assert.equal(eacces.state, 'unreadable', 'a permission error is not a legitimately missing file');
  assert.match(eacces.why, /EACCES/);

  const garbage = readUsage({ readFile: () => 'not json at all' });
  assert.equal(garbage.state, 'unreadable');
});

test('an unreadable config yields plan UNKNOWN and no windows — never a confident zero', () => {
  const s = usageState({ readFile: () => 'nope' });
  assert.equal(s.ok, false);
  assert.equal(s.plan.kind, 'unknown');
  assert.deepEqual(s.windows, []);
  assert.equal(s.dollarsAreMeaningful, undefined, 'an unread config answers no question about billing');
});

test('a config with no cachedUsageUtilization is absent, not an empty reading', () => {
  const r = readUsage({ readFile: asFile({ someOtherKey: 1 }) });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'absent');
});

// ── windows ─────────────────────────────────────────────────────────────────────────────────────

test('a non-numeric utilisation is UNKNOWN, not 0 — zero would read as an idle fleet', () => {
  const w = normaliseWindow('five_hour', { utilization: null, resets_at: null });
  assert.equal(w.state, 'unknown');
  assert.equal(w.utilization, undefined === w.utilization ? w.utilization : null);
  assert.equal(w.utilization, null);
});

test('null codename windows are dropped, but anything LIVE outside the primary pair is named', () => {
  const s = usageState({ readFile: asFile({ cachedUsageUtilization: subscriptionCache({ cedar_ember: { utilization: 44, resets_at: null } }) }) });
  assert.deepEqual(s.windows.map((w) => w.key), ['five_hour', 'seven_day']);
  assert.deepEqual(s.otherActive.map((w) => w.key), ['cedar_ember'],
    'a limit the fleet is actually hitting must not be invisible for being off a hardcoded list');
});

test('a zero-utilisation codename window is not promoted into otherActive', () => {
  const s = usageState({ readFile: asFile({ cachedUsageUtilization: subscriptionCache() }) });
  assert.equal(s.otherActive.find((w) => w.key === 'nimbus_quill'), undefined);
});

test('the real 2026-09-24 reading renders as utilisation, not dollars', () => {
  const s = usageState({ readFile: asFile({ cachedUsageUtilization: subscriptionCache() }), now: 1_000_000 });
  assert.equal(s.plan.kind, 'subscription');
  assert.deepEqual(s.windows.map((w) => [w.key, w.utilization]), [['five_hour', 32], ['seven_day', 9]]);
});

// ── freshness ───────────────────────────────────────────────────────────────────────────────────

test('a stale cache says so — a stale reading reads exactly like a live one otherwise', () => {
  const doc = { cachedUsageUtilization: subscriptionCache() };
  const fresh = usageState({ readFile: asFile(doc), now: 1_000_000 + 60_000 });
  assert.equal(fresh.stale, false);
  const old = usageState({ readFile: asFile(doc), now: 1_000_000 + 60 * 60_000 });
  assert.equal(old.stale, true);
  assert.ok(old.ageMs > old.freshWindowMs);
});

test('an absent fetchedAtMs is UNKNOWN freshness, which is not fresh', () => {
  const s = usageState({ readFile: asFile({ cachedUsageUtilization: { utilization: subscriptionCache().utilization } }) });
  assert.equal(s.ageMs, null);
  assert.equal(s.stale, null, 'null is a third state; false would claim it was checked and fine');
});

test('paths and the freshness window are read at CALL time', () => {
  withEnv('CW_CLAUDE_CONFIG', '/tmp/somewhere.json', () => assert.equal(configPath(), '/tmp/somewhere.json'));
  withEnv('CW_USAGE_FRESH_MS', '1000', () => assert.equal(freshWindowMs(), 1000));
  withEnv('CW_USAGE_FRESH_MS', 'nonsense', () => assert.equal(freshWindowMs(), 15 * 60 * 1000, 'an unparseable override falls back'));
});

// ── captions ────────────────────────────────────────────────────────────────────────────────────

test('resetsIn reads minutes, hours and days, and says "due now" rather than a negative', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  assert.equal(resetsIn('2026-09-24T12:30:00Z', now).text, 'resets in 30 min');
  assert.equal(resetsIn('2026-09-24T15:30:00Z', now).text, 'resets in 3h 30m');
  assert.equal(resetsIn('2026-09-29T12:00:00Z', now).text, 'resets in 5d');
  assert.equal(resetsIn('2026-09-24T11:00:00Z', now).text, 'due now');
  assert.equal(resetsIn('not a date', now), null);
  assert.equal(resetsIn(null, now), null);
});

test('window labels are human, and an unmapped key degrades to its own name', () => {
  assert.equal(windowLabel('five_hour'), '5-hour window');
  assert.equal(windowLabel('seven_day'), '7-day window');
  assert.equal(windowLabel('cedar_ember'), 'cedar ember');
});
