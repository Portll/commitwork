// Evaluates whether a value is considered true (lib/actions-expressions.mjs truthy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truthy } from '../actions-expressions.mjs';

test('returns false for null', () => {
  assert.equal(truthy(null), false);
});

test('returns false for undefined', () => {
  assert.equal(truthy(undefined), false);
});

test('returns true for boolean true', () => {
  assert.equal(truthy(true), true);
});

test('returns false for boolean false', () => {
  assert.equal(truthy(false), false);
});

test('returns false for number zero', () => {
  assert.equal(truthy(0), false);
});

test('returns false for number NaN', () => {
  assert.equal(truthy(NaN), false);
});

test('returns true for non-zero number', () => {
  assert.equal(truthy(1), true);
});

test('returns false for empty string', () => {
  assert.equal(truthy(''), false);
});

test('returns true for non-empty string', () => {
  assert.equal(truthy('a'), true);
});

test('returns true for array', () => {
  assert.equal(truthy([]), true);
});
