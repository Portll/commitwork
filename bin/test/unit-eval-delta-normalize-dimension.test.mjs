// Coerces a dimension value to a finite number or throws (bin/eval-delta.mjs normalizeDimension).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDimension } from '../eval-delta.mjs';

test('returns a finite number as-is', () => {
  assert.equal(normalizeDimension('d', 42), 42);
});

test('returns a finite number from an object with after', () => {
  assert.equal(normalizeDimension('d', { after: 1.5 }), 1.5);
});

test('returns a finite number from an object with score when after is missing', () => {
  assert.equal(normalizeDimension('d', { score: 3 }), 3);
});

test('prefers after over score when both are present', () => {
  assert.equal(normalizeDimension('d', { after: 1, score: 2 }), 1);
});

test('throws for a string value', () => {
  assert.throws(() => normalizeDimension('d', '5'), /unrecognized shape/);
});

test('throws for a boolean value', () => {
  assert.throws(() => normalizeDimension('d', true), /unrecognized shape/);
});

test('throws for a null value', () => {
  assert.throws(() => normalizeDimension('d', null), /unrecognized shape/);
});

test('throws for an array value', () => {
  assert.throws(() => normalizeDimension('d', [1, 2]), /unrecognized shape/);
});

test('throws for an object with non-finite after and score', () => {
  assert.throws(() => normalizeDimension('d', { after: NaN, score: Infinity }), /unrecognized shape/);
});

test('throws for an empty object', () => {
  assert.throws(() => normalizeDimension('d', {}), /unrecognized shape/);
});
