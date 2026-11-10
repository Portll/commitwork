// Classifies artifact freshness as fresh, stale, expired, unknown, or paused based on scan or rollup age (monitor/freshness.mjs classifyFreshness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness } from '../freshness.mjs';

test('returns fresh when age is within cadence plus grace', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 1000).toISOString();
  const result = classifyFreshness(generatedISO, nowMs, { cadenceMs: 10000, graceMs: 5000 });
  assert.deepEqual(result, {
    state: 'fresh',
    ageMs: 1000,
    ageHours: 0,
    generated: generatedISO,
    lastRolledUp: generatedISO,
    lastRolledUpAgeMs: 1000,
    lastRolledUpAgeHours: 0,
    sliceId: null,
    scanTime: null,
    threshold: { cadenceMs: 10000, graceMs: 5000, expireMs: 25000 }
  });
});

test('returns stale when age exceeds cadence plus grace but is within expire', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 20000).toISOString();
  const result = classifyFreshness(generatedISO, nowMs, { cadenceMs: 10000, graceMs: 5000 });
  assert.deepEqual(result, {
    state: 'stale',
    ageMs: 20000,
    ageHours: 0,
    generated: generatedISO,
    lastRolledUp: generatedISO,
    lastRolledUpAgeMs: 20000,
    lastRolledUpAgeHours: 0,
    sliceId: null,
    scanTime: null,
    threshold: { cadenceMs: 10000, graceMs: 5000, expireMs: 25000 }
  });
});

test('returns expired when age exceeds expire threshold', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 30000).toISOString();
  const result = classifyFreshness(generatedISO, nowMs, { cadenceMs: 10000, graceMs: 5000 });
  assert.deepEqual(result, {
    state: 'expired',
    ageMs: 30000,
    ageHours: 0,
    generated: generatedISO,
    lastRolledUp: generatedISO,
    lastRolledUpAgeMs: 30000,
    lastRolledUpAgeHours: 0,
    sliceId: null,
    scanTime: null,
    threshold: { cadenceMs: 10000, graceMs: 5000, expireMs: 25000 }
  });
});

test('returns unknown when generatedISO is unparseable', () => {
  const nowMs = 1000000;
  const result = classifyFreshness('not-a-date', nowMs);
  assert.deepEqual(result, {
    state: 'unknown',
    ageMs: null,
    ageHours: null,
    generated: 'not-a-date',
    lastRolledUp: 'not-a-date',
    lastRolledUpAgeMs: null,
    lastRolledUpAgeHours: null,
    sliceId: null,
    scanTime: null,
    threshold: { cadenceMs: 86400000, graceMs: 7200000, expireMs: 180000000 }
  });
});

test('returns paused when opts.paused is true and timestamp is valid', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 1000).toISOString();
  const result = classifyFreshness(generatedISO, nowMs, { paused: true });
  assert.deepEqual(result, {
    state: 'paused',
    ageMs: 1000,
    ageHours: 0,
    generated: generatedISO,
    lastRolledUp: generatedISO,
    lastRolledUpAgeMs: 1000,
    lastRolledUpAgeHours: 0,
    sliceId: null,
    scanTime: null,
    threshold: { cadenceMs: 86400000, graceMs: 7200000, expireMs: 180000000 }
  });
});

test('returns paused when opts.paused is true and timestamp is unparseable', () => {
  const nowMs = 1000000;
  const result = classifyFreshness('bad', nowMs, { paused: true });
  assert.deepEqual(result, {
    state: 'paused',
    ageMs: null,
    ageHours: null,
    generated: 'bad',
    lastRolledUp: 'bad',
    lastRolledUpAgeMs: null,
    lastRolledUpAgeHours: null,
    sliceId: null,
    scanTime: null,
    threshold: { cadenceMs: 86400000, graceMs: 7200000, expireMs: 180000000 }
  });
});

test('classifies on sliceId scan time when sliceId is provided', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 1000).toISOString();
  const sliceId = 'sweep-20230101000000';
  const result = classifyFreshness(generatedISO, nowMs, { sliceId });
  assert.equal(result.state, 'fresh');
  assert.equal(result.sliceId, sliceId);
  assert.equal(result.scanTime, '2023-01-01T00:00:00.000Z');
  assert.equal(result.lastRolledUp, generatedISO);
});

test('returns unknown when sliceId is provided but unparseable', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 1000).toISOString();
  const result = classifyFreshness(generatedISO, nowMs, { sliceId: 'invalid-slice' });
  assert.deepEqual(result, {
    state: 'unknown',
    ageMs: null,
    ageHours: null,
    generated: generatedISO,
    lastRolledUp: generatedISO,
    lastRolledUpAgeMs: 1000,
    lastRolledUpAgeHours: 0,
    sliceId: 'invalid-slice',
    scanTime: null,
    threshold: { cadenceMs: 86400000, graceMs: 7200000, expireMs: 180000000 }
  });
});

test('returns fresh when age is exactly at cadence plus grace boundary', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 15000).toISOString();
  const result = classifyFreshness(generatedISO, nowMs, { cadenceMs: 10000, graceMs: 5000 });
  assert.equal(result.state, 'fresh');
  assert.equal(result.ageMs, 15000);
});

test('returns stale when age is exactly at expire boundary', () => {
  const nowMs = 1000000;
  const generatedISO = new Date(nowMs - 25000).toISOString();
  const result = classifyFreshness(generatedISO, nowMs, { cadenceMs: 10000, graceMs: 5000 });
  assert.equal(result.state, 'stale');
  assert.equal(result.ageMs, 25000);
});
