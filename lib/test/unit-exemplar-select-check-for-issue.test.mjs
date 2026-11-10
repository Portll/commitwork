// Maps an issue source key to its exemplar category or null (lib/exemplar-select.mjs checkForIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForIssue } from '../exemplar-select.mjs';

test('returns null when issue is null', () => {
  assert.equal(checkForIssue(null), null);
});

test('returns null when issue has no source', () => {
  assert.equal(checkForIssue({}), null);
});

test('returns null when source key is empty string', () => {
  assert.equal(checkForIssue({ source: { key: '' } }), null);
});

test('returns null when source key has no colon', () => {
  assert.equal(checkForIssue({ source: { key: 'abc' } }), null);
});

test('returns second pipe-delimited part for sc prefix', () => {
  assert.equal(checkForIssue({ source: { key: 'sc:foo|bar' } }), "bar");
});

test('returns second pipe-delimited part for gs prefix', () => {
  assert.equal(checkForIssue({ source: { key: 'gs:foo|bar' } }), "bar");
});

test('returns dependency-cve for f prefix', () => {
  assert.equal(checkForIssue({ source: { key: 'f:foo' } }), "dependency-cve");
});

test('returns dependency-cve for g prefix', () => {
  assert.equal(checkForIssue({ source: { key: 'g:foo' } }), "dependency-cve");
});

test('returns null for unknown prefix', () => {
  assert.equal(checkForIssue({ source: { key: 'x:foo' } }), null);
});

test('returns null when sc key has no second pipe part', () => {
  assert.equal(checkForIssue({ source: { key: 'sc:foo' } }), null);
});
