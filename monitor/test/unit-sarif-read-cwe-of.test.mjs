// Canonical, deduped, sorted CWE ids a SARIF rule asserts. (monitor/sarif-read.mjs cweOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cweOf } from '../sarif-read.mjs';

test('returns empty array when rule is null', () => {
  assert.deepEqual(cweOf(null), []);
});

test('returns empty array when rule is a string', () => {
  assert.deepEqual(cweOf('not-an-object'), []);
});

test('returns empty array when rule is a number', () => {
  assert.deepEqual(cweOf(42), []);
});

test('returns empty array when rule is an empty object', () => {
  assert.deepEqual(cweOf({}), []);
});

test('extracts CWE from CodeQL style tags property', () => {
  const rule = { properties: { tags: ['external/cwe/cwe-079'] } };
  assert.deepEqual(cweOf(rule), ["CWE-79"]);
});

test('extracts CWE from semgrep style cwe string property', () => {
  const rule = { properties: { cwe: 'CWE-79: Improper Neutralization' } };
  assert.deepEqual(cweOf(rule), ["CWE-79"]);
});

test('extracts multiple CWEs from array cwe property', () => {
  const rule = { properties: { cwe: ['CWE-119', 'CWE-79'] } };
  assert.deepEqual(cweOf(rule), ["CWE-79", "CWE-119"]);
});

test('sorts CWE ids numerically not lexically', () => {
  const rule = { properties: { cwe: ['CWE-119', 'CWE-79', 'CWE-89'] } };
  assert.deepEqual(cweOf(rule), ["CWE-79", "CWE-89", "CWE-119"]);
});

test('deduplicates identical CWE ids from multiple sources', () => {
  const rule = { properties: { tags: ['external/cwe/cwe-079'], cwe: 'CWE-79' } };
  assert.deepEqual(cweOf(rule), ["CWE-79"]);
});

test('returns empty array when properties has no CWE fields', () => {
  const rule = { properties: { severity: 'error' } };
  assert.deepEqual(cweOf(rule), []);
});
