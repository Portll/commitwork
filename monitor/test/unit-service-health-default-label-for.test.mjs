// Maps an area object to its default label or null (monitor/service-health.mjs defaultLabelFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLabelFor } from '../service-health.mjs';

test('returns the admin label when area slug is commitwork-admin', () => {
  const area = { slug: 'commitwork-admin' };
  const r = defaultLabelFor(area);
  assert.equal(r, "com.portll.commitwork-panel");
});

test('returns null when area slug is not commitwork-admin', () => {
  const area = { slug: 'other-area' };
  const r = defaultLabelFor(area);
  assert.equal(r, null);
});

test('returns null when area is null', () => {
  const r = defaultLabelFor(null);
  assert.equal(r, null);
});

test('returns null when area is undefined', () => {
  const r = defaultLabelFor(undefined);
  assert.equal(r, null);
});

test('returns null when area is an empty object', () => {
  const area = {};
  const r = defaultLabelFor(area);
  assert.equal(r, null);
});

test('returns null when area slug is an empty string', () => {
  const area = { slug: '' };
  const r = defaultLabelFor(area);
  assert.equal(r, null);
});

test('returns null when area slug is a number', () => {
  const area = { slug: 123 };
  const r = defaultLabelFor(area);
  assert.equal(r, null);
});

test('returns null when area slug is a boolean', () => {
  const area = { slug: true };
  const r = defaultLabelFor(area);
  assert.equal(r, null);
});
