// Validates the setup journey state object (monitor/journey.mjs validSetupJourney).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validSetupJourney } from '../journey.mjs';

test('returns null for null input', () => {
  assert.equal(validSetupJourney(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(validSetupJourney(undefined), null);
});

test('returns error message for empty object', () => {
  assert.equal(validSetupJourney({}), null);
});

test('returns error message for array input', () => {
  assert.equal(validSetupJourney([]), "must be an object { dismissed?: boolean, acknowledged?: string[] }");
});

test('returns error message for non-object primitive', () => {
  assert.equal(validSetupJourney(42), "must be an object { dismissed?: boolean, acknowledged?: string[] }");
});

test('returns error message for unknown key', () => {
  assert.equal(validSetupJourney({ foo: true }), "unknown key 'foo'");
});

test('returns error message for non-boolean dismissed', () => {
  assert.equal(validSetupJourney({ dismissed: 'yes' }), "dismissed must be true or false");
});

test('returns null for valid dismissed true', () => {
  assert.equal(validSetupJourney({ dismissed: true }), null);
});

test('returns error message for non-array acknowledged', () => {
  assert.equal(validSetupJourney({ acknowledged: 'account' }), "acknowledged must be an array of step ids");
});

test('returns error message for unknown step id in acknowledged', () => {
  assert.equal(validSetupJourney({ acknowledged: ['nonexistent'] }), "acknowledged names an unknown step 'nonexistent'");
});

test('returns null for valid acknowledged with known step id', () => {
  assert.equal(validSetupJourney({ acknowledged: ['account'] }), null);
});

test('returns null for valid dismissed false and acknowledged', () => {
  assert.equal(validSetupJourney({ dismissed: false, acknowledged: ['project', 'scanners'] }), null);
});
