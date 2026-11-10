// Merges fresh advisory entries into existing state, preserving per-entry fields (bin/advisory-index.mjs merge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge } from '../advisory-index.mjs';

test('returns empty structure with zero count when both inputs are empty', () => {
  const result = merge({}, {});
  assert.equal(result.source, 'github-advisory-database');
  assert.equal(result.count, 0);
  assert.deepEqual(result.advisories, {});
  assert.deepEqual(result.cweNames, {});
  assert.equal(typeof result.generated, 'string');
});

test('merges fresh entries into existing advisories', () => {
  const existing = { advisories: { 'GHSA-1': { label: 'old' } } };
  const fresh = { 'GHSA-1': { vector: 'CVSS:3.1/AV:N' } };
  const result = merge(existing, fresh);
  assert.equal(result.count, 1);
  assert.deepEqual(result.advisories['GHSA-1'], { label: 'old', vector: 'CVSS:3.1/AV:N' });
});

test('fresh keys override existing keys for the same advisory id', () => {
  const existing = { advisories: { 'GHSA-1': { label: 'old', vector: 'v1' } } };
  const fresh = { 'GHSA-1': { label: 'new' } };
  const result = merge(existing, fresh);
  assert.deepEqual(result.advisories['GHSA-1'], { label: 'new', vector: 'v1' });
});

test('preserves v2 fields from existing when fresh has no v2', () => {
  const existing = { advisories: { 'GHSA-1': { v2: 'nvd-data', label: 'x' } } };
  const fresh = { 'GHSA-1': { label: 'y' } };
  const result = merge(existing, fresh);
  assert.deepEqual(result.advisories['GHSA-1'], { v2: 'nvd-data', label: 'y' });
});

test('adds new advisory ids from fresh that are not in existing', () => {
  const existing = { advisories: { 'GHSA-1': { label: 'a' } } };
  const fresh = { 'GHSA-2': { label: 'b' } };
  const result = merge(existing, fresh);
  assert.equal(result.count, 2);
  assert.deepEqual(result.advisories['GHSA-1'], { label: 'a' });
  assert.deepEqual(result.advisories['GHSA-2'], { label: 'b' });
});

test('merges cweNames from existing and names parameter', () => {
  const existing = { cweNames: { 'CWE-79': 'XSS' } };
  const names = { 'CWE-89': 'SQLi' };
  const result = merge(existing, {}, names);
  assert.deepEqual(result.cweNames, { 'CWE-79': 'XSS', 'CWE-89': 'SQLi' });
});

test('names parameter overrides existing cweNames for same key', () => {
  const existing = { cweNames: { 'CWE-79': 'XSS' } };
  const names = { 'CWE-79': 'Cross-Site Scripting' };
  const result = merge(existing, {}, names);
  assert.deepEqual(result.cweNames, { 'CWE-79': 'Cross-Site Scripting' });
});

test('handles missing advisories and cweNames in existing gracefully', () => {
  const result = merge({}, { 'GHSA-1': { label: 'test' } }, { 'CWE-1': 'None' });
  assert.equal(result.count, 1);
  assert.deepEqual(result.advisories['GHSA-1'], { label: 'test' });
  assert.deepEqual(result.cweNames, { 'CWE-1': 'None' });
});

test('count reflects total number of unique advisory ids after merge', () => {
  const existing = { advisories: { 'GHSA-1': {}, 'GHSA-2': {} } };
  const fresh = { 'GHSA-1': { label: 'a' }, 'GHSA-3': { label: 'b' } };
  const result = merge(existing, fresh);
  assert.equal(result.count, 3);
});

test('generated is set to a non-null value after merge', () => {
  const result = merge({}, {});
  assert.notEqual(result.generated, null);
  assert.equal(typeof result.generated, 'string');
});
