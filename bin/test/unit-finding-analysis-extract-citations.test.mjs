// Extracts file:line and version pin citations from text (bin/finding-analysis.mjs extractCitations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations } from '../finding-analysis.mjs';

test('returns empty array for null input', () => {
  assert.deepEqual(extractCitations(null), []);
});

test('returns empty array for undefined input', () => {
  assert.deepEqual(extractCitations(undefined), []);
});

test('returns empty array for empty string', () => {
  assert.deepEqual(extractCitations(''), []);
});

test('extracts single file line citation', () => {
  assert.deepEqual(extractCitations('see src/index.js:42'), ['src/index.js:42']);
});

test('extracts file line citation with range using hyphen', () => {
  assert.deepEqual(extractCitations('see src/index.js:42-50'), ['src/index.js:42-50']);
});

test('extracts file line citation with range using en dash', () => {
  assert.deepEqual(extractCitations('see src/index.js:42\u201350'), ['src/index.js:42\u201350']);
});

test('extracts version pin citation', () => {
  assert.deepEqual(extractCitations('uses lodash@4.17.21'), ['lodash@4.17.21']);
});

test('extracts version pin with trailing characters', () => {
  assert.deepEqual(extractCitations('uses lodash@4.17.21-beta.1'), ['lodash@4.17.21-beta.1']);
});

test('deduplicates identical citations', () => {
  assert.deepEqual(extractCitations('src/index.js:42 and src/index.js:42'), ['src/index.js:42']);
});

test('extracts multiple distinct citations preserving order', () => {
  assert.deepEqual(extractCitations('src/a.js:1 and lib/b.mjs:2 and pkg@1.2.3'), ['src/a.js:1', 'lib/b.mjs:2', 'pkg@1.2.3']);
});

test('extracts file line citation with one character extension', () => {
  assert.deepEqual(extractCitations('see src/a.c:10'), ['src/a.c:10']);
});

test('extracts file line citation with five character extension', () => {
  assert.deepEqual(extractCitations('see src/a.json5:10'), ['src/a.json5:10']);
});

test('extracts file line citation with six character extension', () => {
  assert.deepEqual(extractCitations('see src/a.json6:10'), ['src/a.json6:10']);
});

test('extracts file line citation with seven character extension', () => {
  assert.deepEqual(extractCitations('see src/a.json7:10'), ['src/a.json7:10']);
});
