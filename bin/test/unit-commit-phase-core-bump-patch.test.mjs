// Bumps the patch segment of a semver string, keeping it if a prerelease tag is present (bin/commit-phase-core.mjs bumpPatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpPatch } from '../commit-phase-core.mjs';

test('returns null for a non-string input', () => {
  const r = bumpPatch(123);
  assert.equal(r, null);
});

test('returns null for a string with a v prefix', () => {
  const r = bumpPatch('v1.2.3');
  assert.equal(r, null);
});

test('returns null for a version with a leading zero in major', () => {
  const r = bumpPatch('01.2.3');
  assert.equal(r, null);
});

test('returns null for a version with a leading zero in minor', () => {
  const r = bumpPatch('1.02.3');
  assert.equal(r, null);
});

test('returns null for a version with a leading zero in patch', () => {
  const r = bumpPatch('1.2.03');
  assert.equal(r, null);
});

test('returns null for a version with a leading zero in prerelease identifier', () => {
  const r = bumpPatch('1.2.3-01');
  assert.equal(r, null);
});

test('returns the version unchanged when a prerelease tag is present', () => {
  const r = bumpPatch('1.2.3-alpha.1');
  assert.equal(r, "1.2.3");
});

test('returns the version unchanged when a prerelease tag with multiple identifiers is present', () => {
  const r = bumpPatch('1.2.3-rc.2.beta');
  assert.equal(r, "1.2.3");
});

test('increments the patch by one when no prerelease tag is present', () => {
  const r = bumpPatch('1.2.3');
  assert.equal(r, "1.2.4");
});

test('increments the patch by one when a build tag is present but no prerelease', () => {
  const r = bumpPatch('1.2.3+build.5');
  assert.equal(r, "1.2.4");
});
