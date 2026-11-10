// determines freshness state of evidence document (lib/offbox-evidence.mjs livenessOf)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { livenessOf } from '../offbox-evidence.mjs';

const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 24 * ONE_HOUR_MS;
const CADENCE_GRACE_RUNS = 2;

test('returns UNDATED when document has no generated timestamp', () => {
  const now = 1_000_000;
  const doc = {};
  assert.deepEqual(livenessOf(doc, { now }), { state: "undated", ageMs: null, cadenceMs: null, why: "the evidence carries no usable `generated` timestamp, so its age cannot be judged \u2014 that is not the same as being fresh" });
});

test('returns DEAD when evidence older than maxAgeMs', () => {
  const now = 2_000_000;
  const doc = {
    generated: new Date(now - (DEFAULT_MAX_AGE_MS + 1)).toISOString(),
    cadenceSeconds: 3600,
  };
  assert.deepEqual(livenessOf(doc, { now }), { state: "dead", ageMs: 86400001, cadenceMs: null, why: "the newest evidence is 24h old (limit 24h) \u2014 no host here can be attested, and the SCHEDULE is the thing to check, not the hosts" });
});

test('returns LIVE when evidence is fresh within cadence and maxAge', () => {
  const now = 3_000_000;
  const doc = {
    generated: new Date(now - 1_000).toISOString(),
    cadenceSeconds: 3600,
  };
  assert.deepEqual(livenessOf(doc, { now }), { state: "live", ageMs: 1000, cadenceMs: 3600000, why: null });
});

test('returns LAGGING when evidence older than allowed missed runs', () => {
  const now = 4_000_000;
  const cadenceSec = 60;
  const ageMs = cadenceSec * 1000 * (CADENCE_GRACE_RUNS + 1) + 20_000;
  const doc = {
    generated: new Date(now - ageMs).toISOString(),
    cadenceSeconds: cadenceSec,
  };
  assert.deepEqual(livenessOf(doc, { now }), { state: "lagging", ageMs: 200000, cadenceMs: 60000, why: "the evidence is 3m old against a declared cadence of 1m \u2014 roughly 3 runs have not landed" });
});

test('returns UNDECLARED when cadence missing', () => {
  const now = 5_000_000;
  const doc = {
    generated: new Date(now - 5_000).toISOString(),
  };
  assert.deepEqual(livenessOf(doc, { now }), { state: "undeclared", ageMs: 5000, cadenceMs: null, why: "the evidence declares no cadence, so \"late\" has no definition here \u2014 recorded rather than assumed" });
});

test('age exactly equals maxAgeMs does not return DEAD', () => {
  const now = 6_000_000;
  const doc = {
    generated: new Date(now - DEFAULT_MAX_AGE_MS).toISOString(),
    cadenceSeconds: 7200,
  };
  assert.deepEqual(livenessOf(doc, { now }), { state: "lagging", ageMs: 86400000, cadenceMs: 7200000, why: "the evidence is 1440m old against a declared cadence of 120m \u2014 roughly 12 runs have not landed" });
});

test('age exactly equals cadenceMs*(CADENCE_GRACE_RUNS+1) does not return LAGGING', () => {
  const now = 7_000_000;
  const cadenceSec = 30;
  const ageMs = cadenceSec * 1000 * (CADENCE_GRACE_RUNS + 1);
  const doc = {
    generated: new Date(now - ageMs).toISOString(),
    cadenceSeconds: cadenceSec,
  };
  assert.deepEqual(livenessOf(doc, { now }), { state: "live", ageMs: 90000, cadenceMs: 30000, why: null });
});
