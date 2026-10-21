// Converts a raw path to a repo-relative path (bin/reconcile-findings.mjs normaliseFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseFile } from '../reconcile-findings.mjs';

test('returns empty string for null input', () => {
  assert.equal(normaliseFile(null, '/repo'), '');
});

test('returns empty string for empty string input', () => {
  assert.equal(normaliseFile('', '/repo'), '');
});

test('returns empty string for whitespace-only input', () => {
  assert.equal(normaliseFile('   ', '/repo'), '');
});

test('strips leading ./ from relative path', () => {
  assert.equal(normaliseFile('./src/index.js', '/repo'), 'src/index.js');
});

test('strips multiple leading slashes from absolute path without repo marker', () => {
  assert.equal(normaliseFile('///src/index.js', '/repo'), 'src/index.js');
});

test('returns path relative to repoRoot when path starts with repoRoot', () => {
  assert.equal(normaliseFile('/home/user/commitwork/src/index.js', '/home/user/commitwork'), 'src/index.js');
});

test('returns path after last occurrence of repo name in absolute path', () => {
  assert.equal(normaliseFile('/a/commitwork/b/commitwork/src/index.js', '/a/commitwork'), 'b/commitwork/src/index.js');
});

test('returns path after last occurrence of REPO_NAME when repoRoot basename differs', () => {
  assert.equal(normaliseFile('/a/myfork/commitwork/src/index.js', '/a/myfork'), 'commitwork/src/index.js');
});

test('converts backslashes to forward slashes in relative path', () => {
  assert.equal(normaliseFile('src\\index.js', '/repo'), 'src/index.js');
});

test('returns relative path unchanged when no prefix matches', () => {
  assert.equal(normaliseFile('src/index.js', '/repo'), 'src/index.js');
});
