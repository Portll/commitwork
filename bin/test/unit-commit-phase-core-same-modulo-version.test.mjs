// whether two package.json texts are identical apart from their version field (bin/commit-phase-core.mjs sameModuloVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameModuloVersion } from '../commit-phase-core.mjs';

test('returns true when both inputs are the same string', () => {
  const s = '{"version":"1.0.0"}';
  assert.equal(sameModuloVersion(s, s), true);
});

test('returns true when inputs differ only in the version field', () => {
  const a = '{"version":"1.0.0"}';
  const b = '{"version":"2.0.0"}';
  assert.equal(sameModuloVersion(a, b), true);
});

test('returns false when inputs differ in a non-version field', () => {
  const a = '{"version":"1.0.0","name":"x"}';
  const b = '{"version":"1.0.0","name":"y"}';
  assert.equal(sameModuloVersion(a, b), false);
});

test('returns false when the first input is not valid JSON', () => {
  const a = 'not json';
  const b = '{"version":"1.0.0"}';
  assert.equal(sameModuloVersion(a, b), false);
});

test('returns false when the second input is not valid JSON', () => {
  const a = '{"version":"1.0.0"}';
  const b = 'not json';
  assert.equal(sameModuloVersion(a, b), false);
});

test('returns false when the first input has no version field', () => {
  const a = '{"name":"x"}';
  const b = '{"version":"1.0.0"}';
  assert.equal(sameModuloVersion(a, b), false);
});

test('returns false when the second input has no version field', () => {
  const a = '{"version":"1.0.0"}';
  const b = '{"name":"x"}';
  assert.equal(sameModuloVersion(a, b), false);
});

test('returns false when both inputs are not valid JSON', () => {
  assert.equal(sameModuloVersion('bad1', 'bad2'), false);
});
