// Parses a Package URL into its ecosystem and name (monitor/observables.mjs parsePurl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePurl } from '../observables.mjs';

test('returns null for an empty string', () => {
  assert.deepEqual(parsePurl(''), null);
});

test('returns null for a non-purl string', () => {
  assert.deepEqual(parsePurl('not-a-purl'), null);
});

test('parses a simple npm package with version', () => {
  assert.deepEqual(parsePurl('pkg:npm/lodash@4.17.21'), { ecosystem: "npm", name: "lodash" });
});

test('parses a maven package and joins group and artifact with a colon', () => {
  assert.deepEqual(parsePurl('pkg:maven/org.apache.commons/commons-lang3@3.12.0'), { ecosystem: "maven", name: "org.apache.commons:commons-lang3" });
});

test('parses a purl with a query string and strips it', () => {
  assert.deepEqual(parsePurl('pkg:npm/lodash@4.17.21?repo=custom'), { ecosystem: "npm", name: "lodash" });
});

test('parses a purl with a fragment and strips it', () => {
  assert.deepEqual(parsePurl('pkg:npm/lodash@4.17.21#sha1=abc'), { ecosystem: "npm", name: "lodash" });
});

test('lowercases the ecosystem in the result', () => {
  assert.deepEqual(parsePurl('pkg:GEM/rails@7.0.0'), { ecosystem: "gem", name: "rails" });
});

test('decodes a percent-encoded npm scope', () => {
  assert.deepEqual(parsePurl('pkg:npm/%40babel/core@7.20.0'), { ecosystem: "npm", name: "@babel/core" });
});

test('returns null for a purl missing the name part', () => {
  assert.deepEqual(parsePurl('pkg:npm/'), null);
});
