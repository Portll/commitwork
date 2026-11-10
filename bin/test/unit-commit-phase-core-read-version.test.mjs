// Extracts the version field from a JSON object string (bin/commit-phase-core.mjs readVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVersion } from '../commit-phase-core.mjs';

test('returns absent when input is not a string', () => {
  assert.deepEqual(readVersion(null), { ok: false, why: "is absent" });
});

test('returns not parseable when input is not a JSON object', () => {
  assert.deepEqual(readVersion('42'), { ok: false, why: "is not a parseable JSON object" });
});

test('returns no version field when version key is missing', () => {
  assert.deepEqual(readVersion('{"name":"test"}'), { ok: false, why: "has no \"version\" field" });
});

test('returns duplicate error when version appears twice', () => {
  assert.deepEqual(readVersion('{"version":"1.0.0","version":"2.0.0"}'), { ok: false, why: "carries \"version\" 2 times, and which one a reader takes is not a thing to guess" });
});

test('returns not semver when version is not a string', () => {
  assert.deepEqual(readVersion('{"version":123}'), { ok: false, why: "has version 123, which is not semver" });
});

test('returns not semver when version is invalid semver', () => {
  assert.deepEqual(readVersion('{"version":"1.0"}'), { ok: false, why: "has version \"1.0\", which is not semver" });
});

test('returns ok with version and span for valid semver', () => {
  assert.deepEqual(readVersion('{"version":"1.2.3"}'), { ok: true, version: "1.2.3", span: [11, 18] });
});

test('returns ok with version and span for valid semver with prerelease', () => {
  assert.deepEqual(readVersion('{"version":"1.0.0-alpha.1"}'), { ok: true, version: "1.0.0-alpha.1", span: [11, 26] });
});
