// Returns a rule title string from a map and code, or null if invalid (monitor/rule-titles.mjs publishedTitle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedTitle } from '../rule-titles.mjs';

test('returns null when map is null', () => {
  const result = publishedTitle(null, 'E100');
  assert.equal(result, null);
});

test('returns null when map is undefined', () => {
  const result = publishedTitle(undefined, 'E100');
  assert.equal(result, null);
});

test('returns null when code is empty string', () => {
  const result = publishedTitle({ E100: 'Title' }, '');
  assert.equal(result, null);
});

test('returns null when code is null', () => {
  const result = publishedTitle({ E100: 'Title' }, null);
  assert.equal(result, null);
});

test('returns null when code is undefined', () => {
  const result = publishedTitle({ E100: 'Title' }, undefined);
  assert.equal(result, null);
});

test('returns null when code not in map', () => {
  const result = publishedTitle({ E100: 'Title' }, 'E200');
  assert.equal(result, null);
});

test('returns null when map value is not a string', () => {
  const result = publishedTitle({ E100: 123 }, 'E100');
  assert.equal(result, null);
});

test('returns ruleTitleText result when map has string value for code', () => {
  const result = publishedTitle({ E100: 'Valid Title' }, 'E100');
  assert.equal(result, "Valid Title");
});
