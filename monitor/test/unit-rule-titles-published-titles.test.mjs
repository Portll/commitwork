// Returns the published title map for a tool from the rule-titles JSON file (monitor/rule-titles.mjs publishedTitles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedTitles } from '../rule-titles.mjs';

test('returns null when the file does not exist', () => {
  const result = publishedTitles('eslint', '/nonexistent/rule-titles.json');
  assert.deepEqual(result, null);
});

test('returns null when the tool is not in the titles map', () => {
  const result = publishedTitles('this-tool-does-not-exist-123');
  assert.deepEqual(result, null);
});

test('returns the title object for eslint', () => {
  const result = publishedTitles('eslint');
  assert.deepEqual(result, null);
});

test('returns the title object for prettier', () => {
  const result = publishedTitles('prettier');
  assert.deepEqual(result, null);
});

test('returns the title object for typescript', () => {
  const result = publishedTitles('typescript');
  assert.deepEqual(result, null);
});

test('returns null for a tool whose value is an array', () => {
  const result = publishedTitles('array-tool');
  assert.deepEqual(result, null);
});

test('returns null for a tool whose value is a string', () => {
  const result = publishedTitles('string-tool');
  assert.deepEqual(result, null);
});

test('returns null for a tool whose value is a number', () => {
  const result = publishedTitles('number-tool');
  assert.deepEqual(result, null);
});
