// Parses a CSS color string into an [r, g, b, a] array (lib/md-view.mjs parseColor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor } from '../md-view.mjs';

test('expands 3-digit hex to 6-digit and returns the channel values', () => {
  assert.deepEqual(parseColor('#abc'), [170, 187, 204, 1]);
});

test('expands 4-digit hex to 8-digit and returns the alpha channel', () => {
  assert.deepEqual(parseColor('#abcd'), [170, 187, 204, 0.8666666666666667]);
});

test('returns null for a 5-digit hex string', () => {
  assert.equal(parseColor('#abcde'), null);
});

test('returns null for a 7-digit hex string', () => {
  assert.equal(parseColor('#abcdefg'), null);
});

test('parses a 6-digit hex string with full opacity', () => {
  assert.deepEqual(parseColor('#123456'), [18, 52, 86, 1]);
});

test('parses an 8-digit hex string with partial opacity', () => {
  assert.deepEqual(parseColor('#12345678'), [18, 52, 86, 0.47058823529411764]);
});

test('parses an rgb function with percentage values', () => {
  assert.deepEqual(parseColor('rgb(100%, 50%, 0%)'), [255, 127.5, 0, 1]);
});

test('parses an rgba function with an alpha value', () => {
  assert.deepEqual(parseColor('rgba(255, 0, 0, 0.5)'), [255, 0, 0, 0.5]);
});

test('parses an hsl function with hue, saturation, and lightness', () => {
  assert.deepEqual(parseColor('hsl(120, 100%, 50%)'), [0, 255, 0, 1]);
});

test('returns null for an invalid color string', () => {
  assert.equal(parseColor('not-a-color'), null);
});
