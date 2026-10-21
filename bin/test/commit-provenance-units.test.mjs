// bin/test/commit-provenance-units.test.mjs — case tests for parseSignatures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSignatures } from '../commit-provenance.mjs';

const FIELD = '\x1f';

test('parses a single signed commit line', () => {
  const text = `abc123${FIELD}G`;
  const map = parseSignatures(text);
  assert.equal(map.size, 1);
  assert.equal(map.get('abc123'), 'G');
});

test('parses multiple lines with different statuses', () => {
  const text = `aaa${FIELD}G\nbbb${FIELD}N\nccc${FIELD}U`;
  const map = parseSignatures(text);
  assert.equal(map.size, 3);
  assert.equal(map.get('aaa'), 'G');
  assert.equal(map.get('bbb'), 'N');
  assert.equal(map.get('ccc'), 'U');
});

test('trims whitespace around sha and status', () => {
  const text = `  abc  ${FIELD}  G  `;
  const map = parseSignatures(text);
  assert.equal(map.size, 1);
  assert.equal(map.get('abc'), 'G');
});

test('returns empty map for empty string', () => {
  const map = parseSignatures('');
  assert.equal(map.size, 0);
});

test('skips lines with empty sha', () => {
  const text = `${FIELD}G\nabc${FIELD}N`;
  const map = parseSignatures(text);
  assert.equal(map.size, 1);
  assert.equal(map.get('abc'), 'N');
});

test('handles line with no field separator', () => {
  const text = `abc123`;
  const map = parseSignatures(text);
  assert.equal(map.size, 1);
  assert.equal(map.get('abc123'), '');
});

test('overwrites duplicate sha with last occurrence', () => {
  const text = `abc${FIELD}G\nabc${FIELD}N`;
  const map = parseSignatures(text);
  assert.equal(map.size, 1);
  assert.equal(map.get('abc'), 'N');
});
