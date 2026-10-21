// Extracts platform CI measurement statements from text (bin/platform-support.mjs statementsIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementsIn } from '../platform-support.mjs';

test('returns empty array for empty string', () => {
  assert.deepEqual(statementsIn(''), []);
});

test('returns empty array for text without matching pattern', () => {
  assert.deepEqual(statementsIn('No CI data here'), []);
});

test('parses a single Windows statement', () => {
  const input = 'Windows CI measured 2024-01-15 at `abc1234`, Node 22: 10 pass / 2 fail / 1 skipped';
  const result = statementsIn(input);
  assert.deepEqual(result, [{
    platform: 'Windows',
    date: '2024-01-15',
    sha: 'abc1234',
    node: '22',
    pass: 10,
    fail: 2,
    skip: 1,
  }]);
});

test('parses a single Linux statement', () => {
  const input = 'Linux CI measured 2024-02-20 at `def5678`, Node 20.1: 5 pass / 0 fail / 3 skipped';
  const result = statementsIn(input);
  assert.deepEqual(result, [{
    platform: 'Linux',
    date: '2024-02-20',
    sha: 'def5678',
    node: '20.1',
    pass: 5,
    fail: 0,
    skip: 3,
  }]);
});

test('parses a single macOS statement', () => {
  const input = 'macOS CI measured 2024-03-10 at `1234567890abcdef1234567890abcdef12345678`, Node 18.17.0: 100 pass / 5 fail / 10 skipped';
  const result = statementsIn(input);
  assert.deepEqual(result, [{
    platform: 'macOS',
    date: '2024-03-10',
    sha: '1234567890abcdef1234567890abcdef12345678',
    node: '18.17.0',
    pass: 100,
    fail: 5,
    skip: 10,
  }]);
});

test('parses multiple statements in one text', () => {
  const input = 'Windows CI measured 2024-01-15 at `abc1234`, Node 22: 10 pass / 2 fail / 1 skipped\nLinux CI measured 2024-02-20 at `def5678`, Node 20: 5 pass / 0 fail / 3 skipped';
  const result = statementsIn(input);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    platform: 'Windows',
    date: '2024-01-15',
    sha: 'abc1234',
    node: '22',
    pass: 10,
    fail: 2,
    skip: 1,
  });
  assert.deepEqual(result[1], {
    platform: 'Linux',
    date: '2024-02-20',
    sha: 'def5678',
    node: '20',
    pass: 5,
    fail: 0,
    skip: 3,
  });
});

test('flattens whitespace before matching', () => {
  const input = 'Windows   CI   measured   2024-01-15   at   `abc1234`,   Node   22:   10   pass   /   2   fail   /   1   skipped';
  const result = statementsIn(input);
  assert.deepEqual(result, [{
    platform: 'Windows',
    date: '2024-01-15',
    sha: 'abc1234',
    node: '22',
    pass: 10,
    fail: 2,
    skip: 1,
  }]);
});

test('requires minimum 7 character sha', () => {
  const input = 'Windows CI measured 2024-01-15 at `abc12`, Node 22: 10 pass / 2 fail / 1 skipped';
  const result = statementsIn(input);
  assert.deepEqual(result, []);
});

test('accepts exactly 7 character sha', () => {
  const input = 'Windows CI measured 2024-01-15 at `abc1234`, Node 22: 10 pass / 2 fail / 1 skipped';
  const result = statementsIn(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].sha, 'abc1234');
});

test('accepts exactly 40 character sha', () => {
  const sha = 'a'.repeat(40);
  const input = `Windows CI measured 2024-01-15 at \`${sha}\`, Node 22: 10 pass / 2 fail / 1 skipped`;
  const result = statementsIn(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].sha, sha);
});
