// Computes a grouping key for a feature surface (bin/feature-census.mjs groupKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupKey } from '../feature-census.mjs';

test('returns the name for a cli-command surface', () => {
  const r = groupKey({ surface: 'cli-command', name: 'deploy' });
  assert.equal(r, "deploy");
});

test('returns the first path segment for a cli-script surface', () => {
  const r = groupKey({ surface: 'cli-script', name: 'bin/tool.js' });
  assert.equal(r, "bin");
});

test('returns the route key for an http-route with a path', () => {
  const r = groupKey({ surface: 'http-route', name: 'GET /users' });
  assert.equal(r, "users");
});

test('returns the route key for an http-route without a path', () => {
  const r = groupKey({ surface: 'http-route', name: 'GET' });
  assert.equal(r, "(root)");
});

test('returns the navGroup for a ui-view surface', () => {
  const r = groupKey({ surface: 'ui-view', navGroup: 'settings' });
  assert.equal(r, "settings");
});

test('returns chrome for a ui-view without a navGroup', () => {
  const r = groupKey({ surface: 'ui-view' });
  assert.equal(r, "chrome");
});

test('returns the name for an mcp-tool surface', () => {
  const r = groupKey({ surface: 'mcp-tool', name: 'search' });
  assert.equal(r, "search");
});

test('returns the name for a job surface', () => {
  const r = groupKey({ surface: 'job', name: 'nightly-build' });
  assert.equal(r, "nightly-build");
});

test('returns the name for a package-api surface', () => {
  const r = groupKey({ surface: 'package-api', name: 'core' });
  assert.equal(r, "core");
});

test('returns the name for an unknown surface', () => {
  const r = groupKey({ surface: 'unknown', name: 'misc' });
  assert.equal(r, "misc");
});
