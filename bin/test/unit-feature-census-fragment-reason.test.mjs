// Maps a feature record to a human-readable reason it is fragmented (bin/feature-census.mjs fragmentReason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fragmentReason } from '../feature-census.mjs';

test('returns the core-sibling message when coverage is measured, tests are empty, and coreSiblingTests is non-empty', () => {
  const f = { coverageMeasured: true, tests: [], coreSibling: 'core', coreSiblingTests: ['t1'] };
  assert.equal(fragmentReason(f), "its logic is tested through core, but nothing tests the entry point itself");
});

test('returns the no-test-names-it message when coverage is measured, tests are empty, and coreSiblingTests is empty', () => {
  const f = { coverageMeasured: true, tests: [], coreSibling: 'core', coreSiblingTests: [] };
  assert.equal(fragmentReason(f), "no test in the tree names it");
});

test('returns null when coverage is measured, tests are empty, and coreSiblingTests is not an array', () => {
  const f = { coverageMeasured: true, tests: [], coreSibling: 'core', coreSiblingTests: 'not-array' };
  assert.equal(fragmentReason(f), "no test in the tree names it");
});

test('returns the no-durable-URL message when surface is ui-view and pathRouted is false', () => {
  const f = { coverageMeasured: false, surface: 'ui-view', pathRouted: false };
  assert.equal(fragmentReason(f), "no durable URL \u2014 the view does not survive a reload");
});

test('returns null when surface is ui-view and pathRouted is true', () => {
  const f = { coverageMeasured: false, surface: 'ui-view', pathRouted: true };
  assert.equal(fragmentReason(f), null);
});

test('returns null when surface is not ui-view and pathRouted is false', () => {
  const f = { coverageMeasured: false, surface: 'api', pathRouted: false };
  assert.equal(fragmentReason(f), null);
});

test('returns null when coverage is not measured and tests are empty', () => {
  const f = { coverageMeasured: false, tests: [], surface: 'api', pathRouted: true };
  assert.equal(fragmentReason(f), null);
});

test('returns null when coverage is measured and tests is not an array', () => {
  const f = { coverageMeasured: true, tests: 'not-array', surface: 'api', pathRouted: true };
  assert.equal(fragmentReason(f), null);
});

test('returns null when coverage is measured and tests is non-empty', () => {
  const f = { coverageMeasured: true, tests: ['t1'], surface: 'api', pathRouted: true };
  assert.equal(fragmentReason(f), null);
});
