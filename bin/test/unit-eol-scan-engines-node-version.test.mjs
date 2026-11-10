// Extracts the major version number from a node engines spec (bin/eol-scan.mjs enginesNodeVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enginesNodeVersion } from '../eol-scan.mjs';

test('returns the major version for a caret spec', () => {
  const r = enginesNodeVersion('^18.0.0');
  assert.equal(r, "18");
});

test('returns the major version for a tilde spec', () => {
  const r = enginesNodeVersion('~20.1.2');
  assert.equal(r, "20");
});

test('returns the major version for a plain version with v prefix', () => {
  const r = enginesNodeVersion('v16');
  assert.equal(r, "16");
});

test('returns the major version for a spec with x wildcards', () => {
  const r = enginesNodeVersion('18.x.*');
  assert.equal(r, "18");
});

test('returns the major version for a spec with star wildcards', () => {
  const r = enginesNodeVersion('20.*.*');
  assert.equal(r, "20");
});

test('returns null for an empty string', () => {
  const r = enginesNodeVersion('');
  assert.equal(r, null);
});

test('returns null for undefined input', () => {
  const r = enginesNodeVersion(undefined);
  assert.equal(r, null);
});

test('returns null for a non-numeric spec', () => {
  const r = enginesNodeVersion('abc');
  assert.equal(r, null);
});

test('returns the major version for a spec with trailing spaces', () => {
  const r = enginesNodeVersion('  18.0.0  ');
  assert.equal(r, "18");
});

test('returns the major version for a two-part version', () => {
  const r = enginesNodeVersion('18.0');
  assert.equal(r, "18");
});
