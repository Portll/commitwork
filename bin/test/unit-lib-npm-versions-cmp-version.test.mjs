// Compares two version strings or objects by semver precedence (bin/lib/npm-versions.mjs cmpVersion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmpVersion } from '../lib/npm-versions.mjs';

test('returns 1 when the first argument is an unparseable string and the second is valid', () => {
  const r = cmpVersion('not-a-version', '1.0.0');
  assert.equal(r, -1);
});

test('returns -1 when the first argument is valid and the second is an unparseable string', () => {
  const r = cmpVersion('1.0.0', 'not-a-version');
  assert.equal(r, 1);
});

test('returns 0 when both arguments are unparseable strings', () => {
  const r = cmpVersion('foo', 'bar');
  assert.equal(r, 0);
});

test('returns 1 when the first argument is a valid object and the second is an unparseable string', () => {
  const r = cmpVersion({ major: 1, minor: 0, patch: 0, pre: [] }, 'bad');
  assert.equal(r, 1);
});

test('returns -1 when the first argument is an unparseable string and the second is a valid object', () => {
  const r = cmpVersion('bad', { major: 1, minor: 0, patch: 0, pre: [] });
  assert.equal(r, -1);
});

test('returns 0 when both arguments are valid objects with identical fields', () => {
  const r = cmpVersion({ major: 1, minor: 0, patch: 0, pre: [] }, { major: 1, minor: 0, patch: 0, pre: [] });
  assert.equal(r, 0);
});

test('returns a positive value when the first major version is greater than the second', () => {
  const r = cmpVersion('2.0.0', '1.0.0');
  assert.equal(r, 1);
});

test('returns a negative value when the first minor version is less than the second with equal majors', () => {
  const r = cmpVersion('1.0.0', '1.1.0');
  assert.equal(r, -1);
});

test('returns a positive value when the first patch version is greater than the second with equal majors and minors', () => {
  const r = cmpVersion('1.0.1', '1.0.0');
  assert.equal(r, 1);
});

test('returns a negative value when the first has a prerelease tag and the second does not with equal numeric parts', () => {
  const r = cmpVersion('1.0.0-alpha', '1.0.0');
  assert.equal(r, -1);
});
