// monitor/test/tool-version-units.test.mjs — case tests for versionsForTools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { versionsForTools } from '../tool-version.mjs';

test('returns empty object for empty array', () => {
  const result = versionsForTools([]);
  assert.deepEqual(result, {});
});

test('returns empty object for non-array input', () => {
  const result = versionsForTools('not-an-array');
  assert.deepEqual(result, {});
});

test('returns empty object for null input', () => {
  const result = versionsForTools(null);
  assert.deepEqual(result, {});
});

test('returns empty object for undefined input', () => {
  const result = versionsForTools(undefined);
  assert.deepEqual(result, {});
});
