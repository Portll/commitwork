// Records dependency links, duplicates, and supersessions on issues (monitor/issue-store.mjs linkIssues).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkIssues } from '../issue-store.mjs';

const mk = (id, extra = {}) => ({
  id,
  state: 'open',
  claim: null,
  closedAs: null,
  deps: { blockedBy: [], duplicateOf: null, supersededBy: null },
  evidence: [],
  ...extra,
});

const mkDoc = (ids) => {
  const issues = {};
  for (const id of ids) issues[id] = mk(id);
  return { issues, events: [] };
};

test('throws when blocks references an unknown issue', () => {
  const doc = mkDoc(['a', 'b']);
  assert.throws(
    () => linkIssues(doc, 'a', { blocks: 'ghost', at: 't' }),
    { name: 'Error', message: 'unknown issue ghost' }
  );
});

test('throws when duplicateOf references an unknown issue', () => {
  const doc = mkDoc(['a', 'b']);
  assert.throws(
    () => linkIssues(doc, 'a', { duplicateOf: 'ghost', at: 't' }),
    { name: 'Error', message: 'unknown issue ghost' }
  );
});

test('throws when supersedes references an unknown issue', () => {
  const doc = mkDoc(['a', 'b']);
  assert.throws(
    () => linkIssues(doc, 'a', { supersedes: 'ghost', at: 't' }),
    { name: 'Error', message: 'unknown issue ghost' }
  );
});

test('throws when blocks would create a dependency cycle', () => {
  const doc = mkDoc(['a', 'b']);
  doc.issues['b'].deps.blockedBy = ['a'];
  assert.throws(
    () => linkIssues(doc, 'b', { blocks: 'a', at: 't' }),
    { name: 'Error', message: 'link would create a dependency cycle between b and a' }
  );
});

test('adds id to blockedBy of the blocks target', () => {
  const doc = mkDoc(['a', 'b']);
  linkIssues(doc, 'a', { blocks: 'b', at: 't' });
  assert.deepEqual(doc.issues['b'].deps.blockedBy, ['a']);
});

test('does not duplicate an existing blockedBy entry', () => {
  const doc = mkDoc(['a', 'b']);
  doc.issues['b'].deps.blockedBy = ['a'];
  linkIssues(doc, 'a', { blocks: 'b', at: 't' });
  assert.deepEqual(doc.issues['b'].deps.blockedBy, ['a']);
});

test('closes the issue as superseded when duplicateOf is set', () => {
  const doc = mkDoc(['a', 'b']);
  linkIssues(doc, 'a', { duplicateOf: 'b', at: 't' });
  assert.equal(doc.issues['a'].state, 'closed');
  assert.equal(doc.issues['a'].closedAs, 'superseded');
  assert.equal(doc.issues['a'].deps.duplicateOf, 'b');
  assert.equal(doc.issues['a'].claim, null);
  assert.equal(doc.issues['a'].evidence.length, 1);
  assert.equal(doc.issues['a'].evidence[0].detail, 'duplicate of b');
});

test('closes the superseded issue and records supersededBy', () => {
  const doc = mkDoc(['a', 'b']);
  linkIssues(doc, 'a', { supersedes: 'b', at: 't' });
  assert.equal(doc.issues['b'].state, 'closed');
  assert.equal(doc.issues['b'].closedAs, 'superseded');
  assert.equal(doc.issues['b'].deps.supersededBy, 'a');
  assert.equal(doc.issues['b'].claim, null);
  assert.equal(doc.issues['b'].evidence.length, 1);
  assert.equal(doc.issues['b'].evidence[0].detail, 'superseded by a');
});

test('allows a link when no cycle exists through a chain', () => {
  const doc = mkDoc(['a', 'b', 'c']);
  doc.issues['b'].deps.blockedBy = ['c'];
  linkIssues(doc, 'a', { blocks: 'b', at: 't' });
  assert.deepEqual(doc.issues['b'].deps.blockedBy, ['c', 'a']);
});

test('does not throw when blocks is null and no other links are given', () => {
  const doc = mkDoc(['a']);
  linkIssues(doc, 'a', { blocks: null, duplicateOf: null, supersedes: null, at: 't' });
  assert.equal(doc.issues['a'].state, 'open');
  assert.equal(doc.events.length, 0);
});
