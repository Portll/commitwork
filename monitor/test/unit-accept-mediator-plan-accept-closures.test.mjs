// Maps accept annotations to open issues, separating exact matches from cross-repo findings (monitor/accept-mediator.mjs planAcceptClosures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAcceptClosures } from '../accept-mediator.mjs';

test('filters annotations to only those with action accept', () => {
  const annotations = [
    { action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1' },
    { action: 'reject', repo: 'r1', id: 'CVE-1', package: 'p1' },
    { action: 'accept', repo: 'r1', id: 'CVE-2', package: 'p2' }
  ];
  const issues = {
    i1: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } },
    i2: { state: 'open', source: { key: 'g:r1|tool|CVE-2|p2|path' } }
  };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1" }, issueId: "i1", identity: { repo: "r1", advisory: "CVE-1", pkg: "p1" }, evidence: "accepted per monitor/annotations.json (unknown, undated): " }, { annotation: { action: "accept", repo: "r1", id: "CVE-2", package: "p2" }, issueId: "i2", identity: { repo: "r1", advisory: "CVE-2", pkg: "p2" }, evidence: "accepted per monitor/annotations.json (unknown, undated): " }], crossRepo: [], report: { at: "t", accepts: 2, openIssues: 2, unreadableKey: 0, exact: 2, crossRepo: 0, note: "2 open issue(s) carry a human accept that the issue ledger did not know about" } });
});

test('treats null annotations as empty and reports zero accepts', () => {
  const issues = { i1: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(null, issues, { now: 't' });
  assert.deepEqual(r, { exact: [], crossRepo: [], report: { at: "t", accepts: 0, openIssues: 1, unreadableKey: 0, exact: 0, crossRepo: 0, note: "no open issue shares (repo, advisory, package) with any accept annotation \u2014 the two stores currently describe different repositories, 0 issue keys were not advisory-shaped" } });
});

test('skips closed issues and counts unreadable keys', () => {
  const annotations = [{ action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1' }];
  const issues = {
    i1: { state: 'closed', source: { key: 'g:r1|tool|CVE-1|p1|path' } },
    i2: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } },
    i3: { state: 'open', source: { key: 'bad-key' } }
  };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1" }, issueId: "i2", identity: { repo: "r1", advisory: "CVE-1", pkg: "p1" }, evidence: "accepted per monitor/annotations.json (unknown, undated): " }], crossRepo: [], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 1, exact: 1, crossRepo: 0, note: "1 open issue(s) carry a human accept that the issue ledger did not know about" } });
});

test('matches exact repo advisory package and builds evidence string', () => {
  const annotations = [{ action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1', who: 'alice', at: '2024-01-01', reason: 'safe' }];
  const issues = { i1: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1", who: "alice", at: "2024-01-01", reason: "safe" }, issueId: "i1", identity: { repo: "r1", advisory: "CVE-1", pkg: "p1" }, evidence: "accepted per monitor/annotations.json (alice, 2024-01-01): safe" }], crossRepo: [], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 0, exact: 1, crossRepo: 0, note: "1 open issue(s) carry a human accept that the issue ledger did not know about" } });
});

test('flags cross-repo findings when advisory and package match but repo differs', () => {
  const annotations = [{ action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1' }];
  const issues = { i1: { state: 'open', source: { key: 'g:r2|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [], crossRepo: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1" }, issueId: "i1", identity: { repo: "r2", advisory: "CVE-1", pkg: "p1" }, why: "same advisory and package, DIFFERENT repo (accepted in r1, open in r2) \u2014 the acceptance reasoning is repo-scoped and may not transfer" }], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 0, exact: 0, crossRepo: 1, note: "no open issue shares (repo, advisory, package) with any accept annotation \u2014 the two stores currently describe different repositories, 0 issue keys were not advisory-shaped" } });
});

test('refuses wildcard annotations with no repo as cross-repo entries', () => {
  const annotations = [{ action: 'accept', repo: '', id: 'CVE-1', package: 'p1' }];
  const issues = { i1: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [], crossRepo: [{ annotation: { action: "accept", repo: "", id: "CVE-1", package: "p1" }, issueId: null, identity: { repo: "", advisory: "CVE-1", pkg: "p1" }, why: "annotation names no repo \u2014 wildcard, refused" }], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 0, exact: 0, crossRepo: 1, note: "no open issue shares (repo, advisory, package) with any accept annotation \u2014 the two stores currently describe different repositories, 0 issue keys were not advisory-shaped" } });
});

test('uses unknown and undated defaults when who and at are missing', () => {
  const annotations = [{ action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1', reason: 'ok' }];
  const issues = { i1: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1", reason: "ok" }, issueId: "i1", identity: { repo: "r1", advisory: "CVE-1", pkg: "p1" }, evidence: "accepted per monitor/annotations.json (unknown, undated): ok" }], crossRepo: [], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 0, exact: 1, crossRepo: 0, note: "1 open issue(s) carry a human accept that the issue ledger did not know about" } });
});

test('reports note when no exact matches exist between stores', () => {
  const annotations = [{ action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1' }];
  const issues = { i1: { state: 'open', source: { key: 'g:r2|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [], crossRepo: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1" }, issueId: "i1", identity: { repo: "r2", advisory: "CVE-1", pkg: "p1" }, why: "same advisory and package, DIFFERENT repo (accepted in r1, open in r2) \u2014 the acceptance reasoning is repo-scoped and may not transfer" }], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 0, exact: 0, crossRepo: 1, note: "no open issue shares (repo, advisory, package) with any accept annotation \u2014 the two stores currently describe different repositories, 0 issue keys were not advisory-shaped" } });
});

test('reports note when exact matches exist between stores', () => {
  const annotations = [{ action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1' }];
  const issues = { i1: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1" }, issueId: "i1", identity: { repo: "r1", advisory: "CVE-1", pkg: "p1" }, evidence: "accepted per monitor/annotations.json (unknown, undated): " }], crossRepo: [], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 0, exact: 1, crossRepo: 0, note: "1 open issue(s) carry a human accept that the issue ledger did not know about" } });
});

test('truncates reason to 400 characters in evidence', () => {
  const reason = 'x'.repeat(500);
  const annotations = [{ action: 'accept', repo: 'r1', id: 'CVE-1', package: 'p1', who: 'w', at: 'a', reason }];
  const issues = { i1: { state: 'open', source: { key: 'g:r1|tool|CVE-1|p1|path' } } };
  const r = planAcceptClosures(annotations, issues, { now: 't' });
  assert.deepEqual(r, { exact: [{ annotation: { action: "accept", repo: "r1", id: "CVE-1", package: "p1", who: "w", at: "a", reason: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }, issueId: "i1", identity: { repo: "r1", advisory: "CVE-1", pkg: "p1" }, evidence: "accepted per monitor/annotations.json (w, a): xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }], crossRepo: [], report: { at: "t", accepts: 1, openIssues: 1, unreadableKey: 0, exact: 1, crossRepo: 0, note: "1 open issue(s) carry a human accept that the issue ledger did not know about" } });
});
