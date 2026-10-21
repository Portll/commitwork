// Maps a file path to a triage context label (monitor/extractors/secrets.mjs classifyContext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyContext } from '../extractors/secrets.mjs';

test('returns test for a file in a test directory', () => {
  assert.equal(classifyContext('src/test/foo.js'), 'test');
});

test('returns test for a file named foo_test.go', () => {
  assert.equal(classifyContext('src/foo_test.go'), 'test');
});

test('returns test for a file named foo.test.js', () => {
  assert.equal(classifyContext('src/foo.test.js'), 'test');
});

test('returns locale for a file in a locales directory', () => {
  assert.equal(classifyContext('src/locales/en.json'), 'locale');
});

test('returns minified for a file named bundle.min.js', () => {
  assert.equal(classifyContext('dist/bundle.min.js'), 'minified');
});

test('returns vendored for a file in a node_modules directory', () => {
  assert.equal(classifyContext('node_modules/lib/index.js'), 'vendored');
});

test('returns empty string for a regular source file', () => {
  assert.equal(classifyContext('src/main.js'), '');
});

test('returns test for a file in a test directory even if it looks like minified', () => {
  assert.equal(classifyContext('test/bundle.min.js'), 'test');
});

test('returns locale for a file in a locale directory even if it looks like vendored', () => {
  assert.equal(classifyContext('locale/vendor/lib.js'), 'locale');
});

test('returns minified for a file in a vendor directory with a minified name', () => {
  assert.equal(classifyContext('vendor/bundle.min.js'), 'minified');
});
