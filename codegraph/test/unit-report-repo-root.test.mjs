// Absolute path of the parent of the codegraph directory (codegraph/report.mjs repoRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoRoot } from '../report.mjs';
import { resolve, dirname, join, relative, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const codegraphDir = resolve(testDir, '..');
const expectedRoot = resolve(testDir, '..', '..');

test('returns the directory two levels above this test file', () => {
  assert.equal(repoRoot(), expectedRoot);
});

test('returns the parent of the directory that holds report.mjs', () => {
  const reportFile = fileURLToPath(new URL('../report.mjs', import.meta.url));
  assert.equal(repoRoot(), resolve(dirname(reportFile), '..'));
});

test('returns the same path as the directory URL two levels up from this test', () => {
  const fromUrl = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  assert.equal(repoRoot(), fromUrl);
});

test('joining codegraph and report.mjs onto the result gives the report module path', () => {
  const reportFile = fileURLToPath(new URL('../report.mjs', import.meta.url));
  assert.equal(join(repoRoot(), 'codegraph', 'report.mjs'), reportFile);
});

test('the codegraph test directory sits at codegraph/test relative to the result', () => {
  assert.equal(relative(repoRoot(), testDir), join('codegraph', 'test'));
});

test('the codegraph directory is a direct child of the result', () => {
  assert.equal(dirname(codegraphDir), repoRoot());
  assert.equal(basename(codegraphDir), 'codegraph');
});

test('returns an absolute normalized path without a trailing separator', () => {
  const r = repoRoot();
  assert.equal(isAbsolute(r), true);
  assert.equal(r, resolve(r));
  assert.equal(r.endsWith(sep), false);
});

test('returns the same string on repeated calls', () => {
  const first = repoRoot();
  const second = repoRoot();
  assert.equal(first, expectedRoot);
  assert.equal(second, expectedRoot);
});

test('ignores any arguments passed to it', () => {
  assert.equal(repoRoot('elsewhere', 3), expectedRoot);
});
