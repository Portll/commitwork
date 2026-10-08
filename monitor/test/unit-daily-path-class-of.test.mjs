// Classifies a file path as data or code based on prefix matching (monitor/daily.mjs pathClassOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathClassOf } from '../daily.mjs';

test('returns data when path starts with a data path prefix', () => {
  const result = pathClassOf('data/users.csv', ['data/']);
  assert.equal(result, 'data');
});

test('returns code when path does not start with any data path prefix', () => {
  const result = pathClassOf('src/index.js', ['data/']);
  assert.equal(result, 'code');
});

test('returns data when the path matches one of several data path prefixes', () => {
  const result = pathClassOf('data/logs/app.log', ['data/', 'logs/']);
  assert.equal(result, 'data');
});

test('returns code when dataPaths array is empty', () => {
  const result = pathClassOf('data/users.csv', []);
  assert.equal(result, 'code');
});

test('normalizes leading ./ before checking prefix', () => {
  const result = pathClassOf('./data/users.csv', ['data/']);
  assert.equal(result, 'data');
});

test('returns code when path is exactly the prefix without trailing content', () => {
  const result = pathClassOf('data', ['data/']);
  assert.equal(result, 'code');
});

test('returns data when path is longer than prefix and starts with it', () => {
  const result = pathClassOf('data/extra/file.txt', ['data/']);
  assert.equal(result, 'data');
});

test('returns code when path is a substring but not a prefix match', () => {
  const result = pathClassOf('mydata/file.txt', ['data/']);
  assert.equal(result, 'code');
});

test('handles null input by treating it as empty string', () => {
  const result = pathClassOf(null, ['data/']);
  assert.equal(result, 'code');
});

test('handles undefined input by treating it as empty string', () => {
  const result = pathClassOf(undefined, ['data/']);
  assert.equal(result, 'code');
});
