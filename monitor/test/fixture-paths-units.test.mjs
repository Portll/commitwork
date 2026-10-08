// monitor/test/fixture-paths-units.test.mjs — case tests for goldenMarkerOf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goldenMarkerOf } from '../fixture-paths.mjs';

test('returns null for a file with no dot', () => {
  assert.equal(goldenMarkerOf('golden'), null);
});

test('returns null when the only dot-segment is the basename', () => {
  assert.equal(goldenMarkerOf('golden.js'), null);
  assert.equal(goldenMarkerOf('golden.json'), null);
});

test('returns the marker when a dot-segment after the basename is golden', () => {
  assert.equal(goldenMarkerOf('output.golden'), 'golden');
  assert.equal(goldenMarkerOf('render.golden.json'), 'golden');
});

test('matches other golden markers case-insensitively', () => {
  assert.equal(goldenMarkerOf('x.Golden'), 'golden');
  assert.equal(goldenMarkerOf('x.goldens'), 'goldens');
  assert.equal(goldenMarkerOf('x.GOLDENMASTER'), 'goldenmaster');
  assert.equal(goldenMarkerOf('x.GoldenMasters'), 'goldenmasters');
});

test('returns null when no dot-segment matches a marker', () => {
  assert.equal(goldenMarkerOf('data.json'), null);
  assert.equal(goldenMarkerOf('a.b.c'), null);
});

test('returns null for empty or nullish input', () => {
  assert.equal(goldenMarkerOf(''), null);
  assert.equal(goldenMarkerOf(null), null);
  assert.equal(goldenMarkerOf(undefined), null);
});
