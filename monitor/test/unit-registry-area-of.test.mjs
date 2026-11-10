// Resolves the area slug for a repository name from a registry object (monitor/registry.mjs areaOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaOf } from '../registry.mjs';

test('returns the declared area from a matching project entry', () => {
  const reg = { areas: [{ slug: 'alpha', members: ['other'] }], projects: [{ name: 'repo-a', area: 'declared-area' }] };
  assert.equal(areaOf('repo-a', reg), "declared-area");
});

test('returns the area slug when the repo is listed in members', () => {
  const reg = { areas: [{ slug: 'beta', members: ['repo-b'] }], projects: [] };
  assert.equal(areaOf('repo-b', reg), "beta");
});

test('returns the area slug when the repo name matches a prefix', () => {
  const reg = { areas: [{ slug: 'gamma', prefixes: ['repo-'] }], projects: [] };
  assert.equal(areaOf('repo-c', reg), "gamma");
});

test('falls back to the repo name as its own area when no area matches', () => {
  const reg = { areas: [{ slug: 'delta', members: ['unrelated'] }], projects: [] };
  assert.equal(areaOf('standalone', reg), "standalone");
});

test('returns null when the name is not a valid slug and no area matches', () => {
  const reg = { areas: [{ slug: 'delta', members: ['unrelated'] }], projects: [] };
  assert.equal(areaOf('Bad Name!', reg), null);
});

test('uses legacy behaviour when the registry has no areas array', () => {
  const reg = { projects: [{ name: 'repo-d', area: 'legacy-area' }] };
  assert.equal(areaOf('repo-d', reg), "legacy-area");
});

test('returns null in legacy mode when the name is not a valid slug', () => {
  const reg = { projects: [] };
  assert.equal(areaOf('Bad Name!', reg), null);
});

test('returns null when the registry is undefined and the name is invalid', () => {
  assert.equal(areaOf('Bad Name!'), null);
});

test('returns the project area in legacy mode even when areas is an empty array', () => {
  const reg = { areas: [], projects: [{ name: 'repo-e', area: 'legacy-area' }] };
  assert.equal(areaOf('repo-e', reg), "legacy-area");
});

test('returns null when the registry is null and the name is invalid', () => {
  assert.equal(areaOf('Bad Name!', null), null);
});
