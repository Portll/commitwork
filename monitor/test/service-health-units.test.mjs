// monitor/test/service-health-units.test.mjs — case tests for defaultLabelFor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLabelFor } from '../service-health.mjs';

test('returns the specific label for commitwork-admin', () => {
  const area = { slug: 'commitwork-admin' };
  assert.equal(defaultLabelFor(area), 'com.portll.commitwork-panel');
});

test('returns null for a different slug', () => {
  const area = { slug: 'other-service' };
  assert.equal(defaultLabelFor(area), null);
});

test('returns null when slug is missing', () => {
  const area = { name: 'no-slug' };
  assert.equal(defaultLabelFor(area), null);
});

test('returns null for null input', () => {
  assert.equal(defaultLabelFor(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(defaultLabelFor(undefined), null);
});

test('returns null for an empty object', () => {
  assert.equal(defaultLabelFor({}), null);
});
