// Computes dwell aggregates: mean knowable exposure by severity, open-age percentiles, histogram, and SLA breach count (monitor/dwell.mjs dwellAggregates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dwellAggregates } from '../dwell.mjs';

test('returns empty aggregates for null input', () => {
  const r = dwellAggregates(null);
  assert.deepEqual(r, { meanKnowableBySeverity: {}, p50: null, p90: null, p95: null, openAgeHistogram: { "0-7": 0, "8-30": 0, "31-90": 0, "91-180": 0, "180+": 0 }, slaBreachCount: 0 });
});

test('counts SLA breaches correctly', () => {
  const records = [
    { severity: 'high', dwell: { knowableExposureDays: 10, openAgeDays: 5 }, escalation: { slaBreached: true } },
    { severity: 'low', dwell: { knowableExposureDays: 20, openAgeDays: 15 }, escalation: { slaBreached: false } },
    { severity: 'medium', dwell: { knowableExposureDays: 30, openAgeDays: 45 }, escalation: { slaBreached: true } },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.slaBreachCount, 2);
});

test('computes mean knowable exposure by severity', () => {
  const records = [
    { severity: 'high', dwell: { knowableExposureDays: 10, openAgeDays: 5 } },
    { severity: 'high', dwell: { knowableExposureDays: 20, openAgeDays: 15 } },
    { severity: 'low', dwell: { knowableExposureDays: 30, openAgeDays: 45 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.meanKnowableBySeverity, { high: 15, low: 30 });
});

test('computes p50 percentile of open ages', () => {
  const records = [
    { dwell: { openAgeDays: 10 } },
    { dwell: { openAgeDays: 20 } },
    { dwell: { openAgeDays: 30 } },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.p50, 20);
});

test('computes p90 percentile of open ages', () => {
  const records = [
    { dwell: { openAgeDays: 10 } },
    { dwell: { openAgeDays: 20 } },
    { dwell: { openAgeDays: 30 } },
    { dwell: { openAgeDays: 40 } },
    { dwell: { openAgeDays: 50 } },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.p90, 50);
});

test('computes p95 percentile of open ages', () => {
  const records = [
    { dwell: { openAgeDays: 10 } },
    { dwell: { openAgeDays: 20 } },
    { dwell: { openAgeDays: 30 } },
    { dwell: { openAgeDays: 40 } },
    { dwell: { openAgeDays: 50 } },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.p95, 50);
});

test('buckets open ages into 0-7 range', () => {
  const records = [
    { dwell: { openAgeDays: 3 } },
    { dwell: { openAgeDays: 7 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 2, "8-30": 0, "31-90": 0, "91-180": 0, "180+": 0 });
});

test('buckets open ages into 8-30 range', () => {
  const records = [
    { dwell: { openAgeDays: 8 } },
    { dwell: { openAgeDays: 30 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 2, "31-90": 0, "91-180": 0, "180+": 0 });
});

test('buckets open ages into 31-90 range', () => {
  const records = [
    { dwell: { openAgeDays: 31 } },
    { dwell: { openAgeDays: 90 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 0, "31-90": 2, "91-180": 0, "180+": 0 });
});

test('buckets open ages into 91-180 range', () => {
  const records = [
    { dwell: { openAgeDays: 91 } },
    { dwell: { openAgeDays: 180 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 0, "31-90": 0, "91-180": 2, "180+": 0 });
});

test('buckets open ages into 180+ range', () => {
  const records = [
    { dwell: { openAgeDays: 181 } },
    { dwell: { openAgeDays: 365 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 0, "31-90": 0, "91-180": 0, "180+": 2 });
});

test('handles boundary values at 7 and 8 days', () => {
  const records = [
    { dwell: { openAgeDays: 7 } },
    { dwell: { openAgeDays: 8 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 1, "8-30": 1, "31-90": 0, "91-180": 0, "180+": 0 });
});

test('handles boundary values at 30 and 31 days', () => {
  const records = [
    { dwell: { openAgeDays: 30 } },
    { dwell: { openAgeDays: 31 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 1, "31-90": 1, "91-180": 0, "180+": 0 });
});

test('handles boundary values at 90 and 91 days', () => {
  const records = [
    { dwell: { openAgeDays: 90 } },
    { dwell: { openAgeDays: 91 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 0, "31-90": 1, "91-180": 1, "180+": 0 });
});

test('handles boundary values at 180 and 181 days', () => {
  const records = [
    { dwell: { openAgeDays: 180 } },
    { dwell: { openAgeDays: 181 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 0, "31-90": 0, "91-180": 1, "180+": 1 });
});

test('returns null percentiles when no open ages', () => {
  const records = [
    { severity: 'high', dwell: { knowableExposureDays: 10 } },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.p50, null);
  assert.equal(r.p90, null);
  assert.equal(r.p95, null);
});

test('ignores non-numeric knowableExposureDays', () => {
  const records = [
    { severity: 'high', dwell: { knowableExposureDays: '10', openAgeDays: 5 } },
    { severity: 'low', dwell: { knowableExposureDays: null, openAgeDays: 15 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.meanKnowableBySeverity, {});
});

test('ignores non-numeric openAgeDays', () => {
  const records = [
    { dwell: { openAgeDays: '5' } },
    { dwell: { openAgeDays: null } },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.p50, null);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 0, "8-30": 0, "31-90": 0, "91-180": 0, "180+": 0 });
});

test('handles missing dwell property', () => {
  const records = [
    { severity: 'high' },
    { severity: 'low' },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.meanKnowableBySeverity, {});
  assert.equal(r.p50, null);
  assert.equal(r.slaBreachCount, 0);
});

test('handles missing escalation property', () => {
  const records = [
    { severity: 'high', dwell: { knowableExposureDays: 10, openAgeDays: 5 } },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.slaBreachCount, 0);
});

test('handles missing slaBreached property', () => {
  const records = [
    { severity: 'high', dwell: { knowableExposureDays: 10, openAgeDays: 5 }, escalation: {} },
  ];
  const r = dwellAggregates(records);
  assert.equal(r.slaBreachCount, 0);
});

test('computes aggregates with mixed valid and invalid records', () => {
  const records = [
    { severity: 'high', dwell: { knowableExposureDays: 10, openAgeDays: 5 }, escalation: { slaBreached: true } },
    { severity: 'low', dwell: { knowableExposureDays: '20', openAgeDays: '15' } },
    { severity: 'medium', dwell: { knowableExposureDays: 30, openAgeDays: 45 }, escalation: { slaBreached: false } },
    { severity: 'critical', dwell: { openAgeDays: 100 } },
  ];
  const r = dwellAggregates(records);
  assert.deepEqual(r.meanKnowableBySeverity, { high: 10, medium: 30 });
  assert.equal(r.p50, 45);
  assert.equal(r.slaBreachCount, 1);
  assert.deepEqual(r.openAgeHistogram, { "0-7": 1, "8-30": 0, "31-90": 1, "91-180": 1, "180+": 0 });
});
