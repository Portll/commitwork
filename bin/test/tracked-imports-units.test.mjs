// bin/test/tracked-imports-units.test.mjs — case tests for toPosix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toPosix } from '../lib/tracked-imports.mjs';

test('converts backslashes to forward slashes', () => {
  assert.equal(toPosix('a\\b\\c.mjs'), 'a/b/c.mjs');
});

test('returns unchanged string with no backslashes', () => {
  assert.equal(toPosix('a/b/c.mjs'), 'a/b/c.mjs');
});

test('handles empty string', () => {
  assert.equal(toPosix(''), '');
});

test('converts single backslash', () => {
  assert.equal(toPosix('a\\b'), 'a/b');
});

test('coerces non-string input via String()', () => {
  assert.equal(toPosix(123), '123');
});

test('handles multiple consecutive backslashes', () => {
  assert.equal(toPosix('a\\\\b'), 'a//b');
});
