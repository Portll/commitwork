// Replaces the version field in a JSON document with a new semver string (bin/commit-phase-core.mjs setVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setVersion } from '../commit-phase-core.mjs';

test('returns the readVersion failure object when the input is not a string', () => {
  const r = setVersion(42, '1.0.0');
  assert.deepEqual(r, { ok: false, why: "is absent" });
});

test('returns a failure object when the new version is not valid semver', () => {
  const r = setVersion('{"version":"1.0.0"}', 'not-semver');
  assert.deepEqual(r, { ok: false, why: "\"not-semver\" is not semver" });
});

test('returns a failure object when the new version is a number', () => {
  const r = setVersion('{"version":"1.0.0"}', 1);
  assert.deepEqual(r, { ok: false, why: "1 is not semver" });
});

test('returns a failure object when the new version has a v prefix', () => {
  const r = setVersion('{"version":"1.0.0"}', 'v1.0.0');
  assert.deepEqual(r, { ok: false, why: "\"v1.0.0\" is not semver" });
});

test('returns a failure object when the new version has leading zeros', () => {
  const r = setVersion('{"version":"1.0.0"}', '1.02.0');
  assert.deepEqual(r, { ok: false, why: "\"1.02.0\" is not semver" });
});

test('returns the updated text when the version is replaced', () => {
  const r = setVersion('{"version":"1.0.0"}', '2.0.0');
  assert.deepEqual(r, { ok: true, text: "{\"version\":\"2.0.0\"}" });
});

test('returns the updated text when the version is at the start of the object', () => {
  const r = setVersion('{"version":"1.0.0","name":"x"}', '0.1.0');
  assert.deepEqual(r, { ok: true, text: "{\"version\":\"0.1.0\",\"name\":\"x\"}" });
});

test('returns the updated text when the version is at the end of the object', () => {
  const r = setVersion('{"name":"x","version":"1.0.0"}', '3.2.1');
  assert.deepEqual(r, { ok: true, text: "{\"name\":\"x\",\"version\":\"3.2.1\"}" });
});

test('returns a failure object when the JSON has no version field', () => {
  const r = setVersion('{"name":"x"}', '1.0.0');
  assert.deepEqual(r, { ok: false, why: "has no \"version\" field" });
});

test('returns a failure object when the JSON is not an object', () => {
  const r = setVersion('[1,2,3]', '1.0.0');
  assert.deepEqual(r, { ok: false, why: "is not a parseable JSON object" });
});
