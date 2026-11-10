// Summary counts parsed from node:test reporter output (bin/lib/release-candidate-core.mjs testCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testCounts } from '../lib/release-candidate-core.mjs';

const none = { tests: null, pass: null, fail: null, skipped: null, cancelled: null, todo: null };

test('Text with no summary lines gives null for every count', () => {
  assert.deepEqual(testCounts('no summary here'), none);
});

test('An info-prefixed tests line yields its number and leaves the rest null', () => {
  assert.deepEqual(testCounts('\u2139 tests 42'), { ...none, tests: 42 });
});

test('A hash-prefixed pass line yields its multi-digit number', () => {
  assert.deepEqual(testCounts('# pass 123'), { ...none, pass: 123 });
});

test('A full multi-line summary fills every field including a zero count', () => {
  const text = ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']
    .map((k, i) => `\u2139 ${k} ${[10, 8, 2, 1, 0, 3][i]}`)
    .join('\n');
  assert.deepEqual(testCounts(text), { tests: 10, pass: 8, fail: 2, skipped: 1, cancelled: 0, todo: 3 });
});

test('Trailing whitespace and CRLF line endings are accepted after the number', () => {
  assert.deepEqual(testCounts('# fail 3   \r\n# todo 4\r\n'), { ...none, fail: 3, todo: 4 });
});

test('A trailing comma or extra word after the number prevents a match', () => {
  assert.deepEqual(testCounts('\u2139 tests 42,\n# pass 5 total'), none);
});

test('A summary label that does not start its line is ignored but a later line is read', () => {
  assert.deepEqual(testCounts('some text \u2139 tests 7\n# skipped 9'), { ...none, skipped: 9 });
});

test('A missing space after the prefix or an unknown prefix is not matched', () => {
  assert.deepEqual(testCounts('#tests 5\n- pass 6\n\u2139  fail 1'), none);
});

test('The first matching line wins and leading zeros are dropped', () => {
  assert.deepEqual(testCounts('# tests 007\n# tests 2'), { ...none, tests: 7 });
});

test('Non-string inputs are stringified and give null for every count', () => {
  assert.deepEqual(testCounts(null), none);
  assert.deepEqual(testCounts(undefined), none);
  assert.deepEqual(testCounts(12), none);
});
