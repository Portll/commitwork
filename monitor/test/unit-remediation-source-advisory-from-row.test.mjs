// Maps a govulncheck row to a remediation advisory or a drop reason (monitor/remediation-source.mjs advisoryFromRow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoryFromRow } from '../remediation-source.mjs';

const opts = {
  osvFixed: (id, pkg) => `fixed-${id}-${pkg}`,
  slugFor: (repo) => (repo === 'github.com/org/repo' ? 'org/repo' : null),
};

test('drops null rows as malformed', () => {
  const r = advisoryFromRow(null, opts);
  assert.deepEqual(r, { drop: true, reason: "malformed-row" });
});

test('drops non-object rows as malformed', () => {
  const r = advisoryFromRow('string', opts);
  assert.deepEqual(r, { drop: true, reason: "malformed-row" });
});

test('drops rows with missing reachability', () => {
  const r = advisoryFromRow({ id: 'id1', package: 'pkg1', repo: 'github.com/org/repo' }, opts);
  assert.deepEqual(r, { drop: true, reason: "not-reachable:absent" });
});

test('drops rows with non-reachable verdict', () => {
  const r = advisoryFromRow({ id: 'id2', package: 'pkg2', repo: 'github.com/org/repo', reachability: 'unreachable' }, opts);
  assert.deepEqual(r, { drop: true, reason: "not-reachable:unreachable" });
});

test('drops rows with empty reachability string', () => {
  const r = advisoryFromRow({ id: 'id3', package: 'pkg3', repo: 'github.com/org/repo', reachability: '' }, opts);
  assert.deepEqual(r, { drop: true, reason: "not-reachable:absent" });
});

test('drops rows whose repo has no upstream slug', () => {
  const r = advisoryFromRow({ id: 'id4', package: 'pkg4', repo: 'github.com/other/repo', reachability: 'reachable' }, opts);
  assert.deepEqual(r, { drop: true, reason: "no-upstream-slug" });
});

test('builds advisory for reachable row with slug', () => {
  const r = advisoryFromRow({ id: 'id5', package: 'pkg5', repo: 'github.com/org/repo', reachability: 'reachable' }, opts);
  assert.deepEqual(r, { advisory: { id: "id5", package: "pkg5", ecosystem: "Go", currentVersion: "", fixed: "fixed-id5-pkg5", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" } });
});

test('normalizes reachability case and whitespace', () => {
  const r = advisoryFromRow({ id: 'id6', package: 'pkg6', repo: 'github.com/org/repo', reachability: '  Reachable  ' }, opts);
  assert.deepEqual(r, { advisory: { id: "id6", package: "pkg6", ecosystem: "Go", currentVersion: "", fixed: "fixed-id6-pkg6", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" } });
});

test('handles falsy osvFixed result as empty string', () => {
  const falsyOpts = {
    osvFixed: () => '',
    slugFor: (repo) => (repo === 'github.com/org/repo' ? 'org/repo' : null),
  };
  const r = advisoryFromRow({ id: 'id7', package: 'pkg7', repo: 'github.com/org/repo', reachability: 'reachable' }, falsyOpts);
  assert.deepEqual(r, { advisory: { id: "id7", package: "pkg7", ecosystem: "Go", currentVersion: "", fixed: "", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" } });
});

test('handles null osvFixed result as empty string', () => {
  const nullOpts = {
    osvFixed: () => null,
    slugFor: (repo) => (repo === 'github.com/org/repo' ? 'org/repo' : null),
  };
  const r = advisoryFromRow({ id: 'id8', package: 'pkg8', repo: 'github.com/org/repo', reachability: 'reachable' }, nullOpts);
  assert.deepEqual(r, { advisory: { id: "id8", package: "pkg8", ecosystem: "Go", currentVersion: "", fixed: "", reachable: true, bump: null, upstream: { repo: "org/repo", defaultBranch: "" }, repo: "github.com/org/repo" } });
});
