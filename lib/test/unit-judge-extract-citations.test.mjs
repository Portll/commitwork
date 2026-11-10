// Extracts checkable file:line and version pin citations from text (lib/judge.mjs extractCitations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations } from '../judge.mjs';

test('returns empty array for empty or null input', () => {
  const input = '';
  const result = extractCitations(input);
  assert.deepEqual(result, []);
});

test('returns empty array for text with no citations', () => {
  const input = 'just some plain text without any references';
  const result = extractCitations(input);
  assert.deepEqual(result, []);
});

test('extracts file path with line number', () => {
  const input = 'see src/utils/helper.js:42 for details';
  const result = extractCitations(input);
  assert.deepEqual(result, ["src/utils/helper.js:42"]);
});

test('extracts file path with line range', () => {
  const input = 'check lib/core/engine.ts:10-20';
  const result = extractCitations(input);
  assert.deepEqual(result, ["lib/core/engine.ts:10-20"]);
});

test('extracts version pin with package name', () => {
  const input = 'requires lodash@4.17.21 in dependencies';
  const result = extractCitations(input);
  assert.deepEqual(result, ["lodash@4.17.21"]);
});

test('extracts scoped package version pin', () => {
  const input = 'uses @babel/core@7.20.0 for transpilation';
  const result = extractCitations(input);
  assert.deepEqual(result, ["babel/core@7.20.0"]);
});

test('extracts both file citation and version pin', () => {
  const input = 'fix in src/app/main.js:15 using react@18.2.0';
  const result = extractCitations(input);
  assert.deepEqual(result, ["src/app/main.js:15", "react@18.2.0"]);
});

test('deduplicates repeated citations', () => {
  const input = 'see a.js:1 and a.js:1 again';
  const result = extractCitations(input);
  assert.deepEqual(result, ["a.js:1"]);
});

test('extracts file with one-character extension', () => {
  const input = 'refer to src/main.c:5';
  const result = extractCitations(input);
  assert.deepEqual(result, ["src/main.c:5"]);
});

test('does not extract file with six-character extension', () => {
  const input = 'refer to src/module.es6mod:10';
  const result = extractCitations(input);
  assert.deepEqual(result, []);
});
