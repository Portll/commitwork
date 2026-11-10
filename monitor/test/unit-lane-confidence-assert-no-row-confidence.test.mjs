// Detects numeric row-confidence fields in schemas (monitor/lane-confidence.mjs assertNoRowConfidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoRowConfidence } from '../lane-confidence.mjs';

test('returns empty array when rowSchemas is null', () => {
  assert.deepEqual(assertNoRowConfidence(null), []);
});

test('returns empty array when rowSchemas is undefined', () => {
  assert.deepEqual(assertNoRowConfidence(undefined), []);
});

test('returns empty array when rowSchemas is an empty object', () => {
  assert.deepEqual(assertNoRowConfidence({}), []);
});

test('returns empty array when spec has no fields property', () => {
  assert.deepEqual(assertNoRowConfidence({ cat: {} }), []);
});

test('returns empty array when fields is an empty array', () => {
  assert.deepEqual(assertNoRowConfidence({ cat: { fields: [] } }), []);
});

test('returns empty array when field name does not match confidence pattern', () => {
  assert.deepEqual(assertNoRowConfidence({ cat: { fields: [['name', 'num']] } }), []);
});

test('returns empty array when field matches pattern but type is not numeric', () => {
  assert.deepEqual(assertNoRowConfidence({ cat: { fields: [['confidence', 'text']] } }), []);
});

test('returns flagged field when field matches pattern and type is num', () => {
  assert.deepEqual(assertNoRowConfidence({ cat: { fields: [['confidence', 'num']] } }), ["cat.confidence"]);
});

test('returns flagged field when field matches pattern and type is int', () => {
  assert.deepEqual(assertNoRowConfidence({ cat: { fields: [['score', 'int']] } }), ["cat.score"]);
});

test('returns multiple flagged fields across categories', () => {
  assert.deepEqual(assertNoRowConfidence({ a: { fields: [['confidence', 'num']] }, b: { fields: [['weight', 'int']] } }), ["a.confidence", "b.weight"]);
});
