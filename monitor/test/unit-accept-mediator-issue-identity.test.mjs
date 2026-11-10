// Computes the advisory identity (repo, advisory, pkg) from an issue source key (monitor/accept-mediator.mjs issueIdentity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueIdentity } from '../accept-mediator.mjs';

test('returns null when issue is null', () => {
  assert.equal(issueIdentity(null), null);
});

test('returns null when issue has no source', () => {
  assert.equal(issueIdentity({}), null);
});

test('returns null when source key is empty string', () => {
  assert.equal(issueIdentity({ source: { key: '' } }), null);
});

test('returns null when source key is a number', () => {
  assert.equal(issueIdentity({ source: { key: 123 } }), null);
});

test('returns null when key has fewer than three pipe segments after head', () => {
  assert.equal(issueIdentity({ source: { key: 'g:repo|pkg' } }), null);
});

test('returns null when advisory does not match the expected prefix pattern', () => {
  assert.equal(issueIdentity({ source: { key: 'g:repo|tool|BAD-123|pkg' } }), null);
});

test('returns the identity object for a valid key with a colon in head', () => {
  assert.deepEqual(issueIdentity({ source: { key: 'g:myrepo|tool|CVE-2024-1234|pkg' } }), { repo: "myrepo", advisory: "CVE-2024-1234", pkg: "pkg" });
});

test('returns the identity object for a valid key without a colon in head', () => {
  assert.deepEqual(issueIdentity({ source: { key: 'myrepo|tool|GHSA-abc|pkg' } }), { repo: "myrepo", advisory: "GHSA-abc", pkg: "pkg" });
});

test('returns null when key has exactly three segments after head', () => {
  assert.deepStrictEqual(issueIdentity({ source: { key: 'g:repo|tool|CVE-1|pkg' } }), { repo: "repo", advisory: "CVE-1", pkg: "pkg" });
});

test('returns the identity object when key has four segments after head', () => {
  assert.deepEqual(issueIdentity({ source: { key: 'g:repo|tool|CVE-1|pkg|extra' } }), { repo: "repo", advisory: "CVE-1", pkg: "pkg" });
});
