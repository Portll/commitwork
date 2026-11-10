// Computes a dependency graph with paths and unresolved entries (bin/lib/npm-graph.mjs readNpmGraph).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNpmGraph } from '../lib/npm-graph.mjs';

test('returns error when input is not valid JSON', () => {
  const r = readNpmGraph('not json');
  assert.deepEqual(r, { ecosystem: "npm", error: "package-lock.json is not JSON (Unexpected token 'o', \"not json\" is not valid JSON)" });
});

test('returns error when JSON is not an object (array)', () => {
  const r = readNpmGraph('[]');
  assert.deepEqual(r, { ecosystem: "npm", error: "package-lock.json is not a JSON object" });
});

test('returns error when lockfileVersion is missing', () => {
  const lock = JSON.stringify({ packages: {} });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", error: "package-lock.json is lockfileVersion unknown; this reads version 2 or 3 (npm 7 and later)" });
});

test('returns error when lockfileVersion is less than 2', () => {
  const lock = JSON.stringify({ lockfileVersion: 1, packages: {} });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", error: "package-lock.json is lockfileVersion 1; this reads version 2 or 3 (npm 7 and later)" });
});

test('returns error when lockfileVersion is 2 but packages missing', () => {
  const lock = JSON.stringify({ lockfileVersion: 2 });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", error: "package-lock.json is lockfileVersion 2; this reads version 2 or 3 (npm 7 and later)" });
});

test('processes a simple package with prod exposure and registry true', () => {
  const lock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/foo': { version: '1.2.3', dev: false, resolved: 'https://registry.npmjs.org/foo/-/foo-1.2.3.tgz' }
    }
  });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", source: "package-lock.json v2", packages: new Map([["foo@1.2.3", { name: "foo", version: "1.2.3", exposure: "prod", registry: true, paths: [] }]]), unresolved: [] });
});

test('marks package as dev exposure when e.dev is true', () => {
  const lock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/bar': { version: '0.1.0', dev: true, resolved: 'https://registry.npmjs.org/bar/-/bar-0.1.0.tgz' }
    }
  });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", source: "package-lock.json v2", packages: new Map([["bar@0.1.0", { name: "bar", version: "0.1.0", exposure: "dev", registry: true, paths: [] }]]), unresolved: [] });
});

test('marks package registry false when resolved matches non\u2011registry pattern', () => {
  const lock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/baz': { version: '2.0.0', resolved: 'git+https://github.com/user/baz.git' }
    }
  });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", source: "package-lock.json v2", packages: new Map([["baz@2.0.0", { name: "baz", version: "2.0.0", exposure: "prod", registry: false, paths: [] }]]), unresolved: [] });
});

test('adds entry to unresolved when version is missing', () => {
  const lock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/qux': { resolved: 'https://registry.npmjs.org/qux/-/qux-1.0.0.tgz' }
    }
  });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", source: "package-lock.json v2", packages: new Map([]), unresolved: [{ location: "node_modules/qux", reason: "the lockfile states no version" }] });
});

test('handles a non\u2011string version value (e.g., number) as unresolved', () => {
  const lock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/num': { version: 123, resolved: 'https://registry.npmjs.org/num/-/num-123.tgz' }
    }
  });
  const r = readNpmGraph(lock);
  assert.deepEqual(r, { ecosystem: "npm", source: "package-lock.json v2", packages: new Map([]), unresolved: [{ location: "node_modules/num", reason: "the lockfile states no version" }] });
});
