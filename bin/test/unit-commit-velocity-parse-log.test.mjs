// Parses git log text into commit objects with paths (bin/commit-velocity.mjs parseLog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from '../commit-velocity.mjs';

const FIELD = '\x1f';
const RECORD = '\x1e';

test('returns empty array for empty string', () => {
  assert.deepEqual(parseLog(''), []);
});

test('returns empty array for whitespace only', () => {
  assert.deepEqual(parseLog('   \n  '), []);
});

test('parses single record with no paths', () => {
  const text = 'abc123' + FIELD + 'Alice' + FIELD + 'alice@example.com' + FIELD + '1700000000';
  const result = parseLog(text);
  assert.equal(result.length, 1);
  assert.equal(result[0].sha, 'abc123');
  assert.equal(result[0].authorName, 'Alice');
  assert.equal(result[0].authorEmail, 'alice@example.com');
  assert.equal(result[0].at, 1700000000);
  assert.deepEqual(result[0].paths, []);
});

test('parses record with multiple paths', () => {
  const text = 'def456' + FIELD + 'Bob' + FIELD + 'bob@example.com' + FIELD + '1700000001' + '\n' +
    'src/index.js\n' +
    'src/utils.js\n' +
    'README.md';
  const result = parseLog(text);
  assert.equal(result.length, 1);
  assert.equal(result[0].sha, 'def456');
  assert.equal(result[0].authorName, 'Bob');
  assert.equal(result[0].authorEmail, 'bob@example.com');
  assert.equal(result[0].at, 1700000001);
  assert.deepEqual(result[0].paths, ['src/index.js', 'src/utils.js', 'README.md']);
});

test('skips record with fewer than 4 fields', () => {
  const text = 'abc123' + FIELD + 'Alice' + FIELD + 'alice@example.com';
  const result = parseLog(text);
  assert.deepEqual(result, []);
});

test('skips record with non-numeric timestamp', () => {
  const text = 'abc123' + FIELD + 'Alice' + FIELD + 'alice@example.com' + FIELD + 'notanumber';
  const result = parseLog(text);
  assert.deepEqual(result, []);
});

test('parses multiple records separated by record separator', () => {
  const rec1 = 'aaa111' + FIELD + 'Alice' + FIELD + 'alice@example.com' + FIELD + '1700000000' + '\n' + 'file1.js';
  const rec2 = 'bbb222' + FIELD + 'Bob' + FIELD + 'bob@example.com' + FIELD + '1700000001' + '\n' + 'file2.js';
  const text = rec1 + RECORD + rec2;
  const result = parseLog(text);
  assert.equal(result.length, 2);
  assert.equal(result[0].sha, 'aaa111');
  assert.equal(result[0].authorName, 'Alice');
  assert.equal(result[0].authorEmail, 'alice@example.com');
  assert.equal(result[0].at, 1700000000);
  assert.deepEqual(result[0].paths, ['file1.js']);
  assert.equal(result[1].sha, 'bbb222');
  assert.equal(result[1].authorName, 'Bob');
  assert.equal(result[1].authorEmail, 'bob@example.com');
  assert.equal(result[1].at, 1700000001);
  assert.deepEqual(result[1].paths, ['file2.js']);
});

test('skips empty records between valid records', () => {
  const rec1 = 'aaa111' + FIELD + 'Alice' + FIELD + 'alice@example.com' + FIELD + '1700000000';
  const rec2 = 'bbb222' + FIELD + 'Bob' + FIELD + 'bob@example.com' + FIELD + '1700000001';
  const text = rec1 + RECORD + '   ' + RECORD + rec2;
  const result = parseLog(text);
  assert.equal(result.length, 2);
  assert.equal(result[0].sha, 'aaa111');
  assert.equal(result[1].sha, 'bbb222');
});

test('trims whitespace from path lines and filters empty lines', () => {
  const text = 'ccc333' + FIELD + 'Carol' + FIELD + 'carol@example.com' + FIELD + '1700000002' + '\n' +
    '  src/a.js  \n' +
    '\n' +
    '   \n' +
    '  src/b.js';
  const result = parseLog(text);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].paths, ['src/a.js', 'src/b.js']);
});

test('accepts a negative timestamp', () => {
  const text = 'ddd444' + FIELD + 'Dave' + FIELD + 'dave@example.com' + FIELD + '-100';
  const result = parseLog(text);
  assert.equal(result.length, 1);
  assert.equal(result[0].at, -100);
});
