// Maps a project name to a known project key or the default (admin/routes/comments.mjs projectOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectOf } from '../routes/comments.mjs';

test('returns the name when it is a known project key', () => {
  assert.equal(projectOf('commitwork'), 'commitwork');
  assert.equal(projectOf('spine'), 'spine');
});

test('returns the default when the name is an unknown string', () => {
  assert.equal(projectOf('unknown'), 'commitwork');
  assert.equal(projectOf('other'), 'commitwork');
});

test('returns the default when the name is an empty string', () => {
  assert.equal(projectOf(''), 'commitwork');
});

test('returns the default when the name is only whitespace', () => {
  assert.equal(projectOf('   '), 'commitwork');
  assert.equal(projectOf('\t\n'), 'commitwork');
});

test('returns the default when the name is null', () => {
  assert.equal(projectOf(null), 'commitwork');
});

test('returns the default when the name is undefined', () => {
  assert.equal(projectOf(undefined), 'commitwork');
});

test('returns the default when the name is a non-string value', () => {
  assert.equal(projectOf(123), 'commitwork');
  assert.equal(projectOf(true), 'commitwork');
  assert.equal(projectOf({}), 'commitwork');
  assert.equal(projectOf([]), 'commitwork');
});

test('trims surrounding whitespace before matching a known project', () => {
  assert.equal(projectOf('  commitwork  '), 'commitwork');
  assert.equal(projectOf('\tspine\n'), 'spine');
});

test('returns the default when the trimmed name is not a known project', () => {
  assert.equal(projectOf('  unknown  '), 'commitwork');
  assert.equal(projectOf('  '), 'commitwork');
});

test('returns the default for a very long unknown name', () => {
  const long = 'x'.repeat(10000);
  assert.equal(projectOf(long), 'commitwork');
});
