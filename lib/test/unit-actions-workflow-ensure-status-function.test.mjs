// ensures a condition includes a status function, otherwise prefixes with success() (lib/actions-workflow.mjs ensureStatusFunction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureStatusFunction } from '../actions-workflow.mjs';

test('returns the original condition when it already contains a status function', () => {
  const condition = "status('ready')";
  const result = ensureStatusFunction(condition, []);
  assert.equal(result, condition);
});

test('prefixes a condition without a status function with success() && (...)', () => {
  const condition = "true";
  const result = ensureStatusFunction(condition, []);
  assert.equal(result, "success() && (true)");
});

test('returns the original condition when parsing throws an ExpressionError', () => {
  const condition = "invalid syntax >>>";
  const result = ensureStatusFunction(condition, []);
  assert.equal(result, condition);
});

test('rethrows errors that are not ExpressionError', () => {
  assert.throws(() => {
    ensureStatusFunction(undefined, []);
  });
});
