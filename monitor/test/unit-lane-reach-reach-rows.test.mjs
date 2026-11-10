// Computes per-marker lane reach rows with gate and consumed status (monitor/lane-reach.mjs reachRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachRows } from '../lane-reach.mjs';

test('returns empty array for empty markers', () => {
  const r = reachRows([], [], null);
  assert.deepEqual(r, []);
});

test('marks gateFired true when path is in gate and consumed is null', () => {
  const r = reachRows(['package.json'], ['package.json'], null);
  assert.deepEqual(r, [{ manifestPath: "package.json", lane: "deps-osv", present: true, gateFired: true, laneRan: false, consumed: null, unknown: true, unknownReason: "absent", unknownDetail: "no osv.log recorded for this repo \u2014 the lane has not run here, which is not the same as declining this file" }]);
});

test('marks gateFired false when path is not in gate and consumed is null', () => {
  const r = reachRows(['package.json'], ['other.json'], null);
  assert.deepEqual(r, [{ manifestPath: "package.json", lane: "deps-osv", present: true, gateFired: false, laneRan: false, consumed: null, unknown: true, unknownReason: "absent", unknownDetail: "no osv.log recorded for this repo \u2014 the lane has not run here, which is not the same as declining this file" }]);
});

test('marks laneRan true and consumed true when path is in consumed set', () => {
  const r = reachRows(['package.json'], ['package.json'], new Set(['package.json']));
  assert.deepEqual(r, [{ manifestPath: "package.json", lane: "deps-osv", present: true, gateFired: true, laneRan: true, consumed: true }]);
});

test('marks laneRan true and consumed false when path is not in consumed set', () => {
  const r = reachRows(['package.json'], ['package.json'], new Set(['other.json']));
  assert.deepEqual(r, [{ manifestPath: "package.json", lane: "deps-osv", present: true, gateFired: true, laneRan: true, consumed: false }]);
});

test('uses full path as base when path contains slash and is in gate', () => {
  const r = reachRows(['deps/package.json'], ['deps/package.json'], null);
  assert.deepEqual(r, [{ manifestPath: "deps/package.json", lane: "deps-osv", present: true, gateFired: true, laneRan: false, consumed: null, unknown: true, unknownReason: "absent", unknownDetail: "no osv.log recorded for this repo \u2014 the lane has not run here, which is not the same as declining this file" }]);
});

test('uses basename as base when path contains slash but is not in gate', () => {
  const r = reachRows(['deps/package.json'], ['package.json'], null);
  assert.deepEqual(r, [{ manifestPath: "deps/package.json", lane: "deps-osv", present: true, gateFired: true, laneRan: false, consumed: null, unknown: true, unknownReason: "absent", unknownDetail: "no osv.log recorded for this repo \u2014 the lane has not run here, which is not the same as declining this file" }]);
});

test('marks gateFired true when basename is in gate but full path is not', () => {
  const r = reachRows(['deps/package.json'], ['package.json'], new Set());
  assert.deepEqual(r, [{ manifestPath: "deps/package.json", lane: "deps-osv", present: true, gateFired: true, laneRan: true, consumed: false }]);
});

test('marks gateFired false when neither full path nor basename is in gate', () => {
  const r = reachRows(['deps/package.json'], ['other.json'], new Set());
  assert.deepEqual(r, [{ manifestPath: "deps/package.json", lane: "deps-osv", present: true, gateFired: false, laneRan: true, consumed: false }]);
});

test('handles multiple markers with mixed gate and consumed states', () => {
  const r = reachRows(['a.json', 'b.json'], ['a.json'], new Set(['a.json']));
  assert.deepEqual(r, [{ manifestPath: "a.json", lane: "deps-osv", present: true, gateFired: true, laneRan: true, consumed: true }, { manifestPath: "b.json", lane: "deps-osv", present: true, gateFired: false, laneRan: true, consumed: false }]);
});
