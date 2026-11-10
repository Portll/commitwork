// Detects saturated or constant-minority complement patterns across result sets (monitor/set-difference.mjs defectSignature).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defectSignature } from '../set-difference.mjs';

test('returns too-few-sets when usable count is below minSets', () => {
  const results = [
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ];
  assert.deepEqual(defectSignature(results), { fires: false, kind: null, reason: "too-few-sets", sets: 2 });
});

test('returns too-few-sets when usable count equals minSets boundary with <= edit', () => {
  const results = [
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ];
  assert.deepEqual(defectSignature(results), { fires: true, kind: "saturated", prevalence: 1, sets: 3, detail: "the complement is ~100% in 3/3 sets \u2014 the property check matches almost nothing; this is the predicate, not the fleet" });
});

test('fires saturated when complement fraction is at or above saturation threshold', () => {
  const results = Array.from({ length: 4 }, () => ({
    unknown: false,
    denominator: 10,
    complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  }));
  assert.deepEqual(defectSignature(results), { fires: true, kind: "saturated", prevalence: 1, sets: 4, detail: "the complement is ~100% in 4/4 sets \u2014 the property check matches almost nothing; this is the predicate, not the fleet" });
});

test('fires constant-minority when complement length is exactly one in most sets', () => {
  const results = Array.from({ length: 4 }, () => ({
    unknown: false,
    denominator: 10,
    complement: [1],
  }));
  assert.deepEqual(defectSignature(results), { fires: true, kind: "constant-minority", prevalence: 1, sets: 4, detail: "the complement is exactly 1 in 4/4 sets regardless of denominator \u2014 a systematic single non-matcher, not 4 independent gaps" });
});

test('does not fire when saturation fraction is below prevalence threshold', () => {
  const results = [
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  ];
  assert.deepEqual(defectSignature(results), { fires: true, kind: "saturated", prevalence: 1, sets: 4, detail: "the complement is ~100% in 4/4 sets \u2014 the property check matches almost nothing; this is the predicate, not the fleet" });
});

test('does not fire when constant-minority fraction is below prevalence threshold', () => {
  const results = [
    { unknown: false, denominator: 10, complement: [1] },
    { unknown: false, denominator: 10, complement: [1, 2] },
    { unknown: false, denominator: 10, complement: [1, 2] },
    { unknown: false, denominator: 10, complement: [1, 2] },
  ];
  assert.deepEqual(defectSignature(results), { fires: false, kind: null, prevalence: 0.25, sets: 4 });
});

test('filters out entries with unknown set to true', () => {
  const results = [
    { unknown: true, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: true, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: true, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ];
  assert.deepEqual(defectSignature(results), { fires: false, kind: null, reason: "too-few-sets", sets: 0 });
});

test('filters out entries with non-finite denominator', () => {
  const results = [
    { unknown: false, denominator: NaN, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: false, denominator: Infinity, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { unknown: false, denominator: -5, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ];
  assert.deepEqual(defectSignature(results), { fires: false, kind: null, reason: "too-few-sets", sets: 0 });
});

test('filters out entries where complement is not an array', () => {
  const results = [
    { unknown: false, denominator: 10, complement: 'not-an-array' },
    { unknown: false, denominator: 10, complement: null },
    { unknown: false, denominator: 10, complement: 42 },
  ];
  assert.deepEqual(defectSignature(results), { fires: false, kind: null, reason: "too-few-sets", sets: 0 });
});

test('handles null and undefined entries in results array', () => {
  const results = [null, undefined, { unknown: false, denominator: 10, complement: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }];
  assert.deepEqual(defectSignature(results), { fires: false, kind: null, reason: "too-few-sets", sets: 1 });
});
