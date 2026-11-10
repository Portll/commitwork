// Whether a feature has measured coverage and non-empty docs (bin/feature-census.mjs documented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documented } from '../feature-census.mjs';

test('returns null when coverageMeasured is false', () => {
  const r = documented({ coverageMeasured: false, docs: ['a'] });
  assert.equal(r, null);
});

test('returns null when coverageMeasured is 0', () => {
  const r = documented({ coverageMeasured: 0, docs: ['a'] });
  assert.equal(r, null);
});

test('returns true when coverageMeasured is true and docs is non-empty array', () => {
  const r = documented({ coverageMeasured: true, docs: ['a'] });
  assert.equal(r, true);
});

test('returns false when coverageMeasured is true and docs is empty array', () => {
  const r = documented({ coverageMeasured: true, docs: [] });
  assert.equal(r, false);
});

test('returns false when coverageMeasured is true and docs is not an array', () => {
  const r = documented({ coverageMeasured: true, docs: 'a' });
  assert.equal(r, false);
});

test('returns false when coverageMeasured is true and docs is undefined', () => {
  const r = documented({ coverageMeasured: true });
  assert.equal(r, false);
});

test('returns false when coverageMeasured is 1 and docs is empty array', () => {
  const r = documented({ coverageMeasured: 1, docs: [] });
  assert.equal(r, false);
});

test('returns true when coverageMeasured is 1 and docs has one element', () => {
  const r = documented({ coverageMeasured: 1, docs: ['x'] });
  assert.equal(r, true);
});
