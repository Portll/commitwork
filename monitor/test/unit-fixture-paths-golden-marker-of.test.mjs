// Detects a golden-master dot-segment in a file name (monitor/fixture-paths.mjs goldenMarkerOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goldenMarkerOf } from '../fixture-paths.mjs';

test('returns null when the input is empty', () => {
  assert.equal(goldenMarkerOf(''), null);
});

test('returns null when the input is a single segment with no dot', () => {
  assert.equal(goldenMarkerOf('golden'), null);
});

test('returns the marker when the base name is golden and the extension is golden', () => {
  assert.equal(goldenMarkerOf('golden.golden'), "golden");
});

test('returns the marker when the base name is output and the extension is golden', () => {
  assert.equal(goldenMarkerOf('output.golden'), "golden");
});

test('returns the marker when the base name is render and the extension is golden.json', () => {
  assert.equal(goldenMarkerOf('render.golden.json'), "golden");
});

test('returns null when the base name is golden and the extension is js', () => {
  assert.equal(goldenMarkerOf('golden.js'), null);
});

test('returns null when the base name is golden and the extension is json', () => {
  assert.equal(goldenMarkerOf('golden.json'), null);
});

test('returns the marker when the base name is file and the extension is goldens', () => {
  assert.equal(goldenMarkerOf('file.goldens'), "goldens");
});

test('returns the marker when the base name is file and the extension is goldenmaster', () => {
  assert.equal(goldenMarkerOf('file.goldenmaster'), "goldenmaster");
});

test('returns the marker when the base name is file and the extension is goldenmasters', () => {
  assert.equal(goldenMarkerOf('file.goldenmasters'), "goldenmasters");
});
