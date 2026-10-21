// Computes a pipe-delimited identity string for a finding (bin/finding-analysis.mjs findingKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingKey } from '../finding-analysis.mjs';

test('returns three pipes when all fields are undefined', () => {
  const f = {};
  assert.equal(findingKey(f), '|||');
});

test('joins repo, file, rule, and package with pipes', () => {
  const f = { repo: 'r1', file: 'f1', rule: 'R1', package: 'p1' };
  assert.equal(findingKey(f), 'r1|f1|R1|p1');
});

test('uses empty string for missing repo', () => {
  const f = { file: 'f1', rule: 'R1', package: 'p1' };
  assert.equal(findingKey(f), '|f1|R1|p1');
});

test('uses empty string for missing file', () => {
  const f = { repo: 'r1', rule: 'R1', package: 'p1' };
  assert.equal(findingKey(f), 'r1||R1|p1');
});

test('falls back to id when rule is missing', () => {
  const f = { repo: 'r1', file: 'f1', id: 'ID1', package: 'p1' };
  assert.equal(findingKey(f), 'r1|f1|ID1|p1');
});

test('prefers rule over id when both are present', () => {
  const f = { repo: 'r1', file: 'f1', rule: 'R1', id: 'ID1', package: 'p1' };
  assert.equal(findingKey(f), 'r1|f1|R1|p1');
});

test('uses empty string when both rule and id are missing', () => {
  const f = { repo: 'r1', file: 'f1', package: 'p1' };
  assert.equal(findingKey(f), 'r1|f1||p1');
});

test('uses empty string for missing package', () => {
  const f = { repo: 'r1', file: 'f1', rule: 'R1' };
  assert.equal(findingKey(f), 'r1|f1|R1|');
});

test('treats empty string values the same as undefined', () => {
  const f = { repo: '', file: '', rule: '', package: '' };
  assert.equal(findingKey(f), '|||');
});

test('handles fields with pipe characters in their values', () => {
  const f = { repo: 'a|b', file: 'c|d', rule: 'e|f', package: 'g|h' };
  assert.equal(findingKey(f), 'a|b|c|d|e|f|g|h');
});
