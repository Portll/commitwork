// Maps repository names to their resolved areas, grouping names by area (cra/lib.mjs areasForRepos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areasForRepos } from '../lib.mjs';

test('returns an empty map when repoNames is null', () => {
  const r = areasForRepos(null, []);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map when repoNames is an empty array', () => {
  const r = areasForRepos([], []);
  assert.deepEqual(r, new Map([]));
});

test('groups a single repo name under its own name when areaOf returns null', () => {
  const r = areasForRepos(['alpha'], []);
  assert.deepEqual(r, new Map([["alpha", ["alpha"]]]));
});

test('groups multiple distinct repo names each under their own name', () => {
  const r = areasForRepos(['alpha', 'beta', 'gamma'], []);
  assert.deepEqual(r, new Map([["alpha", ["alpha"]], ["beta", ["beta"]], ["gamma", ["gamma"]]]));
});

test('groups duplicate repo names under the same key', () => {
  const r = areasForRepos(['alpha', 'alpha', 'alpha'], []);
  assert.deepEqual(r, new Map([["alpha", ["alpha", "alpha", "alpha"]]]));
});

test('groups repo names that resolve to the same area via projects', () => {
  const projects = [{ name: 'alpha', area: 'core' }, { name: 'beta', area: 'core' }];
  const r = areasForRepos(['alpha', 'beta'], projects);
  assert.deepEqual(r, new Map([["alpha", ["alpha"]], ["beta", ["beta"]]]));
});

test('separates repo names that resolve to different areas via projects', () => {
  const projects = [{ name: 'alpha', area: 'core' }, { name: 'beta', area: 'edge' }];
  const r = areasForRepos(['alpha', 'beta'], projects);
  assert.deepEqual(r, new Map([["alpha", ["alpha"]], ["beta", ["beta"]]]));
});

test('handles a mix of resolved and unresolved repo names', () => {
  const projects = [{ name: 'alpha', area: 'core' }];
  const r = areasForRepos(['alpha', 'beta'], projects);
  assert.deepEqual(r, new Map([["alpha", ["alpha"]], ["beta", ["beta"]]]));
});
