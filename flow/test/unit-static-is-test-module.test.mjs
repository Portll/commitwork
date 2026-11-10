// Detects test and fixture module paths (flow/static.mjs isTestModule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestModule } from '../static.mjs';

test('returns true for a path containing a test directory segment', () => {
  const r = isTestModule('src/test/foo.js');
  assert.equal(r, true);
});

test('returns true for a path ending in .test.js', () => {
  const r = isTestModule('src/foo.test.js');
  assert.equal(r, true);
});

test('returns true for a path ending in .test.mjs', () => {
  const r = isTestModule('src/foo.test.mjs');
  assert.equal(r, true);
});

test('returns true for a path ending in .test.cjs', () => {
  const r = isTestModule('src/foo.test.cjs');
  assert.equal(r, true);
});

test('returns true for a path containing a fixtures directory segment', () => {
  const r = isTestModule('src/fixtures/data.json');
  assert.equal(r, true);
});

test('returns false for a path with no test or fixture markers', () => {
  const r = isTestModule('src/lib/util.js');
  assert.equal(r, false);
});

test('returns false for a path with test in a non-segment position', () => {
  const r = isTestModule('src/testing/foo.js');
  assert.equal(r, false);
});

test('returns false for a path with fixtures in a non-segment position', () => {
  const r = isTestModule('src/fixturesx/data.json');
  assert.equal(r, false);
});

test('returns false for a path with test as a prefix but not a segment', () => {
  const r = isTestModule('testfoo.js');
  assert.equal(r, false);
});

test('returns false for a path with a test-like suffix that is not .test.js', () => {
  const r = isTestModule('src/foo.test.ts');
  assert.equal(r, false);
});
