// Pipe-joined place-stable identity key for a scanner finding (bin/lib/verdict-journal-core.mjs findingKeyForScanner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingKeyForScanner } from '../lib/verdict-journal-core.mjs';

test('throws for a category that has no identity schema', () => {
  assert.throws(
    () => findingKeyForScanner('nonexistent', 'repo-a', { file: 'a.js', rule: 'r' }),
    { name: 'Error', message: "findingKeyForScanner: unknown category 'nonexistent'" }
  );
});

test('throws for an inherited object property name used as a category', () => {
  assert.throws(
    () => findingKeyForScanner('toString', 'repo-a', {}),
    { name: "TypeError", message: "ROW_SCHEMAS[key].identity is not iterable" }
  );
});

test('joins category, repo and the secrets identity fields file then rule', () => {
  assert.equal(
    findingKeyForScanner('secrets', 'repo-a', { file: 'src/a.js', rule: 'aws-key' }),
    "secrets|repo-a|aws-key|src/a.js"
  );
});

test('keeps digits from the supplyChain package and version fields', () => {
  assert.equal(
    findingKeyForScanner('supplyChain', 'repo-b', { package: 'undici', version: '5.28.4' }),
    "supplyChain|repo-b||undici|"
  );
});

test('ignores row fields that are not identity fields, including line', () => {
  assert.equal(
    findingKeyForScanner('secrets', 'repo-c', { file: 'x.js', rule: 'r', line: 12, severity: 'high' }),
    "secrets|repo-c|r|x.js"
  );
});

test('uses an empty string for an identity field missing from the row', () => {
  assert.equal(findingKeyForScanner('secrets', 'repo-d', { rule: 'gh-token' }), "secrets|repo-d|gh-token|");
});

test('uses empty strings for null and undefined identity values', () => {
  assert.equal(findingKeyForScanner('secrets', 'repo-e', { file: null, rule: undefined }), 'secrets|repo-e||');
});

test('stringifies falsy non-null values and turns a null repo into an empty string', () => {
  assert.equal(
    findingKeyForScanner('supplyChain', null, { package: 0, version: false }),
    "supplyChain|||0|"
  );
});

test('builds a long file component without truncation', () => {
  const file = 'd/'.repeat(50) + 'f.js';
  assert.equal(
    findingKeyForScanner('secrets', 'repo-f', { file, rule: 'k' }),
    "secrets|repo-f|k|d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/f.js"
  );
});
