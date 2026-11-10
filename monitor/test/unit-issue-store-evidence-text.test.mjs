// Serializes issue evidence to a trimmed string or empty string (monitor/issue-store.mjs evidenceText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceText } from '../issue-store.mjs';

test('returns empty string for null input', () => {
  assert.equal(evidenceText(null), "");
});

test('returns empty string for undefined input', () => {
  assert.equal(evidenceText(undefined), "");
});

test('returns trimmed string for string input with whitespace', () => {
  assert.equal(evidenceText('  hello  '), "hello");
});

test('returns stringified number for numeric input', () => {
  assert.equal(evidenceText(42), "42");
});

test('returns stringified boolean for boolean input', () => {
  assert.equal(evidenceText(true), "true");
});

test('returns JSON string for non-empty object', () => {
  assert.equal(evidenceText({ a: 1 }), "{\"a\":1}");
});

test('returns empty string for empty object', () => {
  assert.equal(evidenceText({}), "");
});

test('returns empty string for empty array', () => {
  assert.equal(evidenceText([]), "");
});

test('returns JSON string for non-empty array', () => {
  assert.equal(evidenceText([1, 2, 3]), "[1,2,3]");
});

test('returns empty string for object with null value', () => {
  assert.equal(evidenceText({ a: null }), "{\"a\":null}");
});
