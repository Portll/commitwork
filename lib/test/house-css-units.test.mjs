// lib/test/house-css-units.test.mjs — case tests for selectFaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFaces, HOUSE_FACES } from '../house-css.mjs';

test('returns all faces when weights is undefined', () => {
  const result = selectFaces(undefined);
  assert.equal(result, HOUSE_FACES);
});

test('returns empty array when weights is empty object', () => {
  const result = selectFaces({});
  assert.deepEqual(result, []);
});

test('selects specific sans weights', () => {
  const result = selectFaces({ sans: [400, 600] });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(f => f.weight), [400, 600]);
  assert.ok(result.every(f => f.key === 'sans'));
});

test('selects italic face by style string', () => {
  const result = selectFaces({ sans: ['italic'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].style, 'italic');
  assert.equal(result[0].weight, 400);
});

test('throws TypeError for non-object weights', () => {
  assert.throws(() => selectFaces(null), TypeError);
  assert.throws(() => selectFaces('sans'), TypeError);
  assert.throws(() => selectFaces([400]), TypeError);
});

test('throws RangeError for unknown family key', () => {
  assert.throws(() => selectFaces({ serif: [400] }), RangeError);
});

test('throws TypeError when family value is not array', () => {
  assert.throws(() => selectFaces({ sans: 400 }), TypeError);
});

test('throws RangeError for non-existent weight', () => {
  assert.throws(() => selectFaces({ sans: [800] }), RangeError);
  assert.throws(() => selectFaces({ mono: [500] }), RangeError);
});
