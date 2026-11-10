// Resolves the profile list for a project from config (lib/launchlist.mjs projectProfiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectProfiles } from '../launchlist.mjs';

test('returns the project profiles when the project has a non-empty profiles array', () => {
  const config = { projects: { alpha: { profiles: ['a', 'b'] } } };
  assert.deepEqual(projectProfiles('alpha', config), ["a", "b"]);
});

test('falls back to defaults profiles when the project has an empty profiles array', () => {
  const config = { projects: { alpha: { profiles: [] } }, defaults: { profiles: ['d1', 'd2'] } };
  assert.deepEqual(projectProfiles('alpha', config), ["d1", "d2"]);
});

test('falls back to defaults profiles when the project entry has no profiles property', () => {
  const config = { projects: { alpha: {} }, defaults: { profiles: ['d1'] } };
  assert.deepEqual(projectProfiles('alpha', config), ["d1"]);
});

test('falls back to the publication default when the project is missing and defaults is absent', () => {
  const config = { projects: {} };
  assert.deepEqual(projectProfiles('missing', config), ["publication"]);
});

test('falls back to the publication default when config has no projects key', () => {
  const config = {};
  assert.deepEqual(projectProfiles('alpha', config), ["publication"]);
});

test('falls back to defaults profiles when the project entry is null', () => {
  const config = { projects: { alpha: null }, defaults: { profiles: ['x'] } };
  assert.deepEqual(projectProfiles('alpha', config), ["x"]);
});

test('falls back to the publication default when defaults exists but has no profiles', () => {
  const config = { projects: {}, defaults: {} };
  assert.deepEqual(projectProfiles('alpha', config), ["publication"]);
});

test('falls back to the publication default when defaults is null', () => {
  const config = { projects: {}, defaults: null };
  assert.deepEqual(projectProfiles('alpha', config), ["publication"]);
});
