// Finds duplicate PRs and issues matching an advisory's ids or modules (monitor/draft-pr-gates.mjs duplicatesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicatesOf } from '../draft-pr-gates.mjs';

test('returns empty array when no matches exist', () => {
  const adv = { id: 'CVE-1', package: 'pkg-a' };
  const ctx = { prs: [{ title: 'unrelated', body: 'nothing', url: 'p1' }], issues: [{ title: 'other', body: 'none', url: 'i1' }] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, []);
});

test('matches PR by id only without module match', () => {
  const adv = { id: 'CVE-1', package: 'pkg-a' };
  const ctx = { prs: [{ title: 'fix CVE-1', body: '', url: 'p1' }], issues: [] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, [{ kind: "pr", url: "p1" }]);
});

test('matches PR by module only without id match', () => {
  const adv = { id: 'CVE-1', package: 'pkg-a' };
  const ctx = { prs: [{ title: 'update pkg-a', body: '', url: 'p1' }], issues: [] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, [{ kind: "pr", url: "p1" }]);
});

test('matches issue by id only without module or bump word', () => {
  const adv = { id: 'CVE-1', package: 'pkg-a' };
  const ctx = { prs: [], issues: [{ title: 'report CVE-1', body: 'details', url: 'i1' }] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, [{ kind: "issue", url: "i1" }]);
});

test('matches issue by module with bump word in text', () => {
  const adv = { id: 'CVE-1', package: 'pkg-a' };
  const ctx = { prs: [], issues: [{ title: 'bump pkg-a', body: 'security', url: 'i1' }] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, [{ kind: "issue", url: "i1" }]);
});

test('does not match issue with module but no bump word', () => {
  const adv = { id: 'CVE-1', package: 'pkg-a' };
  const ctx = { prs: [], issues: [{ title: 'about pkg-a', body: 'general', url: 'i1' }] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, []);
});

test('deduplicates results by url', () => {
  const adv = { id: 'CVE-1', package: 'pkg-a' };
  const ctx = { prs: [{ title: 'CVE-1 pkg-a', body: '', url: 'p1' }], issues: [{ title: 'CVE-1 pkg-a bump', body: '', url: 'p1' }] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, [{ kind: "issue", url: "p1" }]);
});

test('handles aliases in matching', () => {
  const adv = { id: 'CVE-1', aliases: ['GHSA-1'], package: 'pkg-a' };
  const ctx = { prs: [{ title: 'GHSA-1', body: '', url: 'p1' }], issues: [] };
  const r = duplicatesOf(adv, ctx);
  assert.deepEqual(r, [{ kind: "pr", url: "p1" }]);
});
