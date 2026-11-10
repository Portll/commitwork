// Adds a query parameter to a purl string (monitor/sbom-provenance.mjs purlWithQualifier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purlWithQualifier } from '../sbom-provenance.mjs';

test('returns empty string when purl is null', () => {
  const r = purlWithQualifier(null, 'key', 'value');
  assert.equal(r, "");
});

test('returns empty string when purl is empty string', () => {
  const r = purlWithQualifier('', 'key', 'value');
  assert.equal(r, "");
});

test('returns purl unchanged when key is empty string', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0', '', 'value');
  assert.equal(r, "pkg:npm/foo@1.0.0");
});

test('returns purl unchanged when key is null', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0', null, 'value');
  assert.equal(r, "pkg:npm/foo@1.0.0");
});

test('adds a new query parameter to a purl without query', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0', 'vcs', 'https://github.com/foo');
  assert.equal(r, "pkg:npm/foo@1.0.0?vcs=https%3A%2F%2Fgithub.com%2Ffoo");
});

test('adds a new query parameter to a purl with existing query', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0?existing=1', 'vcs', 'https://github.com/foo');
  assert.equal(r, "pkg:npm/foo@1.0.0?existing=1&vcs=https%3A%2F%2Fgithub.com%2Ffoo");
});

test('returns purl unchanged when key already exists in query', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0?vcs=https://github.com/foo', 'vcs', 'https://github.com/bar');
  assert.equal(r, "pkg:npm/foo@1.0.0?vcs=https://github.com/foo");
});

test('preserves fragment when adding query parameter', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0#fragment', 'vcs', 'https://github.com/foo');
  assert.equal(r, "pkg:npm/foo@1.0.0?vcs=https%3A%2F%2Fgithub.com%2Ffoo#fragment");
});

test('preserves fragment and existing query when adding parameter', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0?existing=1#fragment', 'vcs', 'https://github.com/foo');
  assert.equal(r, "pkg:npm/foo@1.0.0?existing=1&vcs=https%3A%2F%2Fgithub.com%2Ffoo#fragment");
});

test('sorts query parameters alphabetically', () => {
  const r = purlWithQualifier('pkg:npm/foo@1.0.0?zeta=1&alpha=2', 'mid', '3');
  assert.equal(r, "pkg:npm/foo@1.0.0?alpha=2&mid=3&zeta=1");
});
