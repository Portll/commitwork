// computes a prefixed identifier string for a repo, path and name (codegraph/veld.mjs externalIdFor)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalIdFor } from '../veld.mjs';

test('returns correct id for simple inputs', () => {
  const r = externalIdFor('myrepo', 'src/file.js', 'myFunc');
  assert.equal(r, "codegraph:myrepo:src/file.js#myFunc");
});

test('handles empty repository name', () => {
  const r = externalIdFor('', 'path/to/file', 'name');
  assert.equal(r, "codegraph::path/to/file#name");
});

test('handles empty path', () => {
  const r = externalIdFor('repo', '', 'name');
  assert.equal(r, "codegraph:repo:#name");
});

test('handles empty name', () => {
  const r = externalIdFor('repo', 'some/path', '');
  assert.equal(r, "codegraph:repo:some/path#");
});

test('handles special characters in all parts', () => {
  const r = externalIdFor('repo:123', 'path/with:colon', 'name#hash');
  assert.equal(r, "codegraph:repo:123:path/with:colon#name#hash");
});

test('handles long repeated repository name', () => {
  const longRepo = 'r'.repeat(100);
  const r = externalIdFor(longRepo, 'p', 'n');
  assert.equal(r, "codegraph:rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr:p#n");
});

test('handles long repeated path', () => {
  const longPath = 'p/'.repeat(50);
  const r = externalIdFor('repo', longPath, 'name');
  assert.equal(r, "codegraph:repo:p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/p/#name");
});

test('handles long repeated name', () => {
  const longName = 'n'.repeat(200);
  const r = externalIdFor('repo', 'path', longName);
  assert.equal(r, "codegraph:repo:path#nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn");
});

test('handles unicode characters', () => {
  const r = externalIdFor('r\u00e9po', '\u8def\u5f84/\u6587\u4ef6', '\u51fd\u6570');
  assert.equal(r, "codegraph:r\u00e9po:\u8def\u5f84/\u6587\u4ef6#\u51fd\u6570");
});

test('handles numeric strings', () => {
  const r = externalIdFor('123', '456/789', '0');
  assert.equal(r, "codegraph:123:456/789#0");
});
