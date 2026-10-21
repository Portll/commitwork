// Splits a text block into exit-code entries with meanings (bin/exit-codes.mjs splitEntries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitEntries } from '../exit-codes.mjs';

test('returns empty array when input does not start with a code', () => {
  assert.deepEqual(splitEntries('hello world'), []);
});

test('returns empty array when input is empty', () => {
  assert.deepEqual(splitEntries(''), []);
});

test('parses a single entry with colon separator', () => {
  assert.deepEqual(splitEntries('0: success'), [{ code: 0, meaning: 'success' }]);
});

test('parses a single entry with equals separator', () => {
  assert.deepEqual(splitEntries('1= failure'), [{ code: 1, meaning: 'failure' }]);
});

test('parses a single entry with space separator', () => {
  assert.deepEqual(splitEntries('2 failure'), [{ code: 2, meaning: 'failure' }]);
});

test('strips leading exit codes prefix', () => {
  assert.deepEqual(splitEntries('exit codes: 0: ok'), [{ code: 0, meaning: 'ok' }]);
});

test('splits multiple entries separated by semicolons', () => {
  assert.deepEqual(splitEntries('0: ok; 1: fail'), [
    { code: 0, meaning: 'ok' },
    { code: 1, meaning: 'fail' }
  ]);
});

test('splits multiple entries separated by newlines', () => {
  assert.deepEqual(splitEntries('0: ok\n1: fail'), [
    { code: 0, meaning: 'ok' },
    { code: 1, meaning: 'fail' }
  ]);
});

test('filters out codes greater than 255', () => {
  assert.deepEqual(splitEntries('255: max; 256: over'), [{ code: 255, meaning: 'max' }]);
});

test('handles exit keyword before code in split', () => {
  assert.deepEqual(splitEntries('0: ok; exit 1: fail'), [
    { code: 0, meaning: 'ok' },
    { code: 1, meaning: 'fail' }
  ]);
});
