// Shortens a lane tab label to its trailing parenthetical qualifier (monitor/lane-tabs.mjs laneTabLabel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneTabLabel } from '../lane-tabs.mjs';

test('returns empty string for empty input', () => {
  assert.equal(laneTabLabel(''), "");
});

test('returns empty string for null input', () => {
  assert.equal(laneTabLabel(null), "");
});

test('returns trimmed input when no separator is present', () => {
  assert.equal(laneTabLabel('  SAST  '), "SAST");
});

test('returns tail when name is empty in parenthetical', () => {
  assert.equal(laneTabLabel('SAST \u00b7 ()'), "SAST \u00b7 ()");
});

test('returns tail when qualifier is empty in parenthetical', () => {
  assert.equal(laneTabLabel('SAST \u00b7 ( )'), "SAST \u00b7 ( )");
});

test('returns name and qualifier joined when both are present', () => {
  assert.equal(laneTabLabel('SAST \u00b7 (critical, high)'), "(critical, high)");
});

test('returns full label when tail has no letters or digits', () => {
  assert.equal(laneTabLabel('SAST \u00b7 ()'), "SAST \u00b7 ()");
});

test('returns tail when qualifier is empty but name is present', () => {
  assert.equal(laneTabLabel('SAST \u00b7 (critical, )'), "(critical, )");
});

test('returns tail when name is empty but qualifier is present', () => {
  assert.equal(laneTabLabel('SAST \u00b7 (, high)'), "(, high)");
});

test('returns tail when no parenthetical match is found', () => {
  assert.equal(laneTabLabel('SAST \u00b7 critical'), "critical");
});
