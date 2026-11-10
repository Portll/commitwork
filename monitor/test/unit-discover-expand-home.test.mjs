// Path with a leading tilde replaced by the home directory (monitor/discover.mjs expandHome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandHome } from '../discover.mjs';
import { join } from 'node:path';

const home = '/home/tester';
process.env.HOME = home;
process.env.USERPROFILE = home;

test('returns an empty string unchanged', () => {
  assert.equal(expandHome(''), '');
});

test('returns undefined unchanged instead of reading it as a string', () => {
  assert.equal(expandHome(undefined), undefined);
});

test('returns null unchanged', () => {
  assert.equal(expandHome(null), null);
});

test('returns the home directory when the input is exactly a tilde', () => {
  assert.equal(expandHome('~'), home);
});

test('joins the home directory with the rest of the path after a tilde slash', () => {
  assert.equal(expandHome('~/Documents'), join(home, 'Documents'));
});

test('joins the home directory with a nested path after a tilde slash', () => {
  assert.equal(expandHome('~/a/b/c'), join(home, 'a', 'b', 'c'));
});

test('returns the home directory for a bare tilde slash', () => {
  assert.equal(expandHome('~/'), home);
});

test('returns an absolute path without a tilde unchanged', () => {
  assert.equal(expandHome('/absolute/path'), '/absolute/path');
});

test('returns a tilde followed by a name but no slash unchanged', () => {
  assert.equal(expandHome('~x'), '~x');
});

test('returns a path with a tilde slash that is not at the start unchanged', () => {
  assert.equal(expandHome('a~/b'), 'a~/b');
});
