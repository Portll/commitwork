// Replaces repo and home path prefixes with placeholders (bin/lane-fixture.mjs scrubPaths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubPaths } from '../lane-fixture.mjs';

test('replaces repo paths with the repo placeholder', () => {
  const r = scrubPaths('path /a/b end', ['/a/b'], '/home/user');
  assert.equal(r, "path /fixture/repo end");
});

test('replaces home path with the home placeholder', () => {
  const r = scrubPaths('path /home/user end', [], '/home/user');
  assert.equal(r, "path /src/fixture end");
});

test('skips home replacement when home is a single character', () => {
  const r = scrubPaths('path /x end', [], '/x');
  assert.equal(r, "path /src/fixture end");
});

test('skips home replacement when home is empty string', () => {
  const r = scrubPaths('path /home end', [], '');
  assert.equal(r, "path /home end");
});

test('skips home replacement when home is null', () => {
  const r = scrubPaths('path /home end', [], null);
  assert.equal(r, "path /home end");
});

test('replaces home path when home is two characters', () => {
  const r = scrubPaths('path /ab end', [], '/ab');
  assert.equal(r, "path /src/fixture end");
});

test('replaces home path when home is three characters', () => {
  const r = scrubPaths('path /abc end', [], '/abc');
  assert.equal(r, "path /src/fixture end");
});

test('replaces longer repo paths before shorter ones', () => {
  const r = scrubPaths('path /a/b/c end', ['/a/b', '/a/b/c'], '/home/user');
  assert.equal(r, "path /fixture/repo end");
});

test('returns text unchanged when no paths match', () => {
  const r = scrubPaths('no matches here', ['/a/b'], '/home/user');
  assert.equal(r, "no matches here");
});
