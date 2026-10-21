// Detects if an AST contains a status function call (lib/actions-expressions.mjs containsStatusFunction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsStatusFunction } from '../actions-expressions.mjs';

test('returns false for null input', () => {
  assert.equal(containsStatusFunction(null), false);
});

test('returns false for undefined input', () => {
  assert.equal(containsStatusFunction(undefined), false);
});

test('returns true for success call', () => {
  const ast = { type: 'call', name: 'success', args: [] };
  assert.equal(containsStatusFunction(ast), true);
});

test('returns true for failure call', () => {
  const ast = { type: 'call', name: 'failure', args: [] };
  assert.equal(containsStatusFunction(ast), true);
});

test('returns true for cancelled call', () => {
  const ast = { type: 'call', name: 'cancelled', args: [] };
  assert.equal(containsStatusFunction(ast), true);
});

test('returns true for always call', () => {
  const ast = { type: 'call', name: 'always', args: [] };
  assert.equal(containsStatusFunction(ast), true);
});

test('returns false for non-status call', () => {
  const ast = { type: 'call', name: 'echo', args: [] };
  assert.equal(containsStatusFunction(ast), false);
});

test('returns true for binary with status on left', () => {
  const ast = { type: 'binary', left: { type: 'call', name: 'success', args: [] }, right: { type: 'literal', value: 1 } };
  assert.equal(containsStatusFunction(ast), true);
});

test('returns true for binary with status on right', () => {
  const ast = { type: 'binary', left: { type: 'literal', value: 1 }, right: { type: 'call', name: 'failure', args: [] } };
  assert.equal(containsStatusFunction(ast), true);
});

test('returns false for binary without status', () => {
  const ast = { type: 'binary', left: { type: 'literal', value: 1 }, right: { type: 'literal', value: 2 } };
  assert.equal(containsStatusFunction(ast), false);
});

test('returns true for an index whose object is a status call', () => {
  const ast = { type: 'index', expr: { type: 'call', name: 'success', args: [] }, index: { type: 'literal', value: 0 } };
  assert.equal(containsStatusFunction(ast), true);
});
