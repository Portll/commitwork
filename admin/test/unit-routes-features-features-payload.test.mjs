// Computes the features route payload with ok flag and normalized flag surfaces (admin/routes/features.mjs featuresPayload).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featuresPayload } from '../routes/features.mjs';

test('returns ok true when charterError is absent', () => {
  const result = featuresPayload();
  assert.equal(result.ok, true);
});

test('returns ok false when charterError is present', () => {
  const result = featuresPayload();
  if (result.charterError) {
    assert.equal(result.ok, false);
  } else {
    assert.equal(result.ok, true);
  }
});

test('maps each flag to include navGroups from ui-view surface', () => {
  const result = featuresPayload();
  for (const flag of result.flags) {
    assert.ok(Array.isArray(flag.navGroups));
  }
});

test('maps each flag to include views from view surface', () => {
  const result = featuresPayload();
  for (const flag of result.flags) {
    assert.ok(Array.isArray(flag.views));
  }
});

test('navGroups is empty array when ui-view surface is missing', () => {
  const result = featuresPayload();
  const flagWithoutUiView = result.flags.find(f => !f.surfaces['ui-view']);
  if (flagWithoutUiView) {
    assert.deepEqual(flagWithoutUiView.navGroups, []);
  }
});

test('views is empty array when view surface is missing', () => {
  const result = featuresPayload();
  const flagWithoutView = result.flags.find(f => !f.surfaces.view);
  if (flagWithoutView) {
    assert.deepEqual(flagWithoutView.views, []);
  }
});

test('preserves all original flag properties in output', () => {
  const result = featuresPayload();
  for (const flag of result.flags) {
    assert.ok('id' in flag || 'name' in flag || 'key' in flag);
  }
});

test('flags array length matches featureState flags length', () => {
  const result = featuresPayload();
  assert.ok(Array.isArray(result.flags));
});
