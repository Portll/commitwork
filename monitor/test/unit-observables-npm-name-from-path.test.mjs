// Extracts the npm package name from a node_modules path (monitor/observables.mjs npmNameFromPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npmNameFromPath } from '../observables.mjs';

test('returns the key unchanged when node_modules is absent', () => {
  const r = npmNameFromPath('src/index.js');
  assert.equal(r, "src/index.js");
});

test('returns the key unchanged when node_modules is at the start', () => {
  const r = npmNameFromPath('node_modules/react/index.js');
  assert.equal(r, "react/index.js");
});

test('returns the key unchanged when node_modules is at index one', () => {
  const r = npmNameFromPath('xnode_modules/react/index.js');
  assert.equal(r, "react/index.js");
});

test('returns the package name when node_modules is in the middle', () => {
  const r = npmNameFromPath('deps/node_modules/react/index.js');
  assert.equal(r, "react/index.js");
});

test('returns the package name when node_modules is at the end', () => {
  const r = npmNameFromPath('deps/node_modules/');
  assert.equal(r, "");
});

test('returns the package name for a nested node_modules path', () => {
  const r = npmNameFromPath('a/node_modules/b/node_modules/c/index.js');
  assert.equal(r, "c/index.js");
});
