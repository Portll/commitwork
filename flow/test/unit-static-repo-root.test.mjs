// The repository root, the directory one level above flow/ (flow/static.mjs repoRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoRoot } from '../static.mjs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testFile = fileURLToPath(import.meta.url);
const testDir = dirname(testFile);
const staticFile = fileURLToPath(new URL('../static.mjs', import.meta.url));
const flowDir = dirname(staticFile);

test('it returns the directory two levels above this test directory', () => {
  assert.equal(repoRoot(), resolve(testDir, '..', '..'));
});

test('it returns the parent of the directory that holds static.mjs', () => {
  assert.equal(repoRoot(), dirname(flowDir));
});

test('joining flow and static.mjs onto it gives the module file path', () => {
  assert.equal(join(repoRoot(), 'flow', 'static.mjs'), staticFile);
});

test('the flow directory is exactly one segment named flow below it', () => {
  assert.equal(relative(repoRoot(), flowDir), 'flow');
});

test('this test file sits at flow/test/unit-static-repo-root.test.mjs below it', () => {
  assert.equal(
    relative(repoRoot(), testFile),
    join('flow', 'test', 'unit-static-repo-root.test.mjs'),
  );
});

test('its file URL with a trailing slash matches the URL two levels above this test', () => {
  assert.equal(pathToFileURL(repoRoot() + sep).href, new URL('../../', import.meta.url).href);
});

test('it carries no trailing separator, so adding one gives the URL-derived directory path', () => {
  assert.equal(repoRoot() + sep, fileURLToPath(new URL('../../', import.meta.url)));
});

test('its parent is three levels above this test directory', () => {
  assert.equal(dirname(repoRoot()), resolve(testDir, '..', '..', '..'));
});

test('it returns the same root path on every call', () => {
  const expected = resolve(testDir, '..', '..');
  assert.deepEqual(
    Array.from({ length: 3 }, () => repoRoot()),
    Array.from({ length: 3 }, () => expected),
  );
});
