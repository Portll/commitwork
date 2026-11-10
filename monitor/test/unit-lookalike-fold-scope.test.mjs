// Folds a package name into a scope/name pair (monitor/lookalike.mjs foldScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldScope } from '../lookalike.mjs';

test('converts a scoped package name to its scope and name', () => {
  assert.equal(foldScope('@scope/pkg'), "scope/pkg");
});

test('lowercases a scoped package name before folding', () => {
  assert.equal(foldScope('@Scope/Pkg'), "scope/pkg");
});

test('converts a dashed package name to its scope and name', () => {
  assert.equal(foldScope('foo-bar'), "foo/bar");
});

test('converts an underscored package name to its scope and name', () => {
  assert.equal(foldScope('foo_bar'), "foo/bar");
});

test('returns a plain package name unchanged when it has no separator', () => {
  assert.equal(foldScope('plain'), "plain");
});

test('returns a single character package name unchanged', () => {
  assert.equal(foldScope('a'), "a");
});

test('returns a name with a leading separator unchanged', () => {
  assert.equal(foldScope('-x'), "-x");
});

test('returns a name with a trailing separator unchanged', () => {
  assert.equal(foldScope('x-'), "x-");
});

test('returns a name with a double separator unchanged', () => {
  assert.equal(foldScope('x--y'), "x/-y");
});

test('returns a name with a non-alphanumeric prefix unchanged', () => {
  assert.equal(foldScope('.x-y'), ".x-y");
});
