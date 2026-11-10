// Finds the nearest node_modules path a package name resolves to from a package location (bin/lib/npm-graph.mjs resolveFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrom } from '../lib/npm-graph.mjs';

test('an empty from path resolves to the root node_modules entry', () => {
  const packages = { 'node_modules/left-pad': { name: 'left-pad' } };
  assert.equal(resolveFrom(packages, '', 'left-pad'), 'node_modules/left-pad');
});

test('an empty from path returns null when the root entry is missing', () => {
  const packages = { 'node_modules/other': { name: 'other' } };
  assert.equal(resolveFrom(packages, '', 'left-pad'), null);
});

test('a package found under the from path own node_modules is returned first', () => {
  const packages = {
    'node_modules/a/node_modules/x': { name: 'x' },
    'node_modules/x': { name: 'x' },
  };
  assert.equal(resolveFrom(packages, 'node_modules/a', 'x'), 'node_modules/a/node_modules/x');
});

test('a top level from path without a leading slash walks up to the root entry', () => {
  const packages = { 'node_modules/x': { name: 'x' } };
  assert.equal(resolveFrom(packages, 'node_modules/a', 'x'), 'node_modules/x');
});

test('a nested from path strips its last node_modules segment and keeps the full parent prefix', () => {
  const packages = { 'pkg/node_modules/x': { name: 'x' } };
  assert.equal(resolveFrom(packages, 'pkg/node_modules/dep', 'x'), 'pkg/node_modules/x');
});

test('a doubly nested from path resolves to the intermediate node_modules entry', () => {
  const packages = {
    'node_modules/a/node_modules/x': { name: 'x' },
    'node_modules/x': { name: 'x' },
  };
  assert.equal(resolveFrom(packages, 'node_modules/a/node_modules/b', 'x'), 'node_modules/a/node_modules/x');
});

test('a from path with no node_modules segment returns null when nothing matches', () => {
  const packages = { 'node_modules/other': { name: 'other' } };
  assert.equal(resolveFrom(packages, 'packages/app', 'left-pad'), null);
});

test('a from path starting with a slash node_modules segment falls back to the root entry', () => {
  const packages = { 'node_modules/x': { name: 'x' } };
  assert.equal(resolveFrom(packages, '/node_modules/a', 'x'), 'node_modules/x');
});

test('falsy package entries are skipped while walking up', () => {
  const packages = {
    'node_modules/a/node_modules/x': null,
    'node_modules/x': { name: 'x' },
  };
  assert.equal(resolveFrom(packages, 'node_modules/a', 'x'), 'node_modules/x');
});

test('an array from whose match sits at index zero is sliced to an empty but truthy prefix', () => {
  const packages = {
    '/node_modules/x': { name: 'x' },
    'node_modules/x': { name: 'x' },
  };
  assert.equal(resolveFrom(packages, ['/node_modules/'], 'x'), '/node_modules/x');
});
