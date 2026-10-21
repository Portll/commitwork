// Computes the pin state (CURRENT, STALE, UNPINNED, UNVERIFIABLE) and suggested replacement for a dependency entry (bin/pin-actions.mjs planLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLine } from '../pin-actions.mjs';

test('returns UNVERIFIABLE when tags is null', () => {
  const entry = { name: 'dep', ref: 'abc123', comment: 'v1' };
  const result = planLine(entry, null);
  assert.deepEqual(result, {
    name: 'dep',
    ref: 'abc123',
    comment: 'v1',
    state: 'UNVERIFIABLE',
    why: 'tag listing failed \u2014 cannot judge this pin'
  });
});

test('returns UNPINNED with best tag when ref is not a SHA and a matching major tag exists', () => {
  const entry = { name: 'dep', ref: 'v1.2.3', comment: null };
  const tags = [
    ['v1.2.3', 'a'.repeat(40)],
    ['v1.2.4', 'b'.repeat(40)]
  ];
  const result = planLine(entry, tags);
  assert.equal(result.state, 'UNPINNED');
  assert.equal(result.to.tag, 'v1.2.4');
  assert.equal(result.to.sha, 'b'.repeat(40));
  assert.equal(result.why, `mutable ref 'v1.2.3' \u2014 pin to ${'b'.repeat(7)} (v1.2.4)`);
});

test('returns UNVERIFIABLE when ref is not a SHA and no matching major tag exists', () => {
  const entry = { name: 'dep', ref: 'v2.0.0', comment: null };
  const tags = [
    ['v1.0.0', 'a'.repeat(40)]
  ];
  const result = planLine(entry, tags);
  assert.equal(result.state, 'UNVERIFIABLE');
  assert.equal(result.why, 'no release tag found for major 2');
});

test('returns CURRENT when ref is a SHA matching the newest tag for the declared major', () => {
  const sha = 'c'.repeat(40);
  const entry = { name: 'dep', ref: sha, comment: 'v1' };
  const tags = [
    ['v1.0.0', 'a'.repeat(40)],
    ['v1.1.0', sha]
  ];
  const result = planLine(entry, tags);
  assert.equal(result.state, 'CURRENT');
  assert.equal(result.why, 'v1.1.0');
});

test('returns STALE when ref is a SHA but an older tag exists for the declared major', () => {
  const oldSha = 'd'.repeat(40);
  const newSha = 'e'.repeat(40);
  const entry = { name: 'dep', ref: oldSha, comment: 'v1' };
  const tags = [
    ['v1.0.0', oldSha],
    ['v1.1.0', newSha]
  ];
  const result = planLine(entry, tags);
  assert.equal(result.state, 'STALE');
  assert.equal(result.to.tag, 'v1.1.0');
  assert.equal(result.to.sha, newSha);
  assert.equal(result.why, `pinned at v1, newest in major is v1.1.0 (${newSha.slice(0, 7)})`);
});

test('returns UNVERIFIABLE when ref is a SHA but no tag matches the declared major', () => {
  const entry = { name: 'dep', ref: 'f'.repeat(40), comment: 'v3' };
  const tags = [
    ['v1.0.0', 'a'.repeat(40)]
  ];
  const result = planLine(entry, tags);
  assert.equal(result.state, 'UNVERIFIABLE');
  assert.equal(result.why, 'pinned, but no release tag matches the declared major to compare against');
});

test('returns UNPINNED when a 40-character non-hex ref has no comment and no declared major', () => {
  const sha = 'g'.repeat(40);
  const entry = { name: 'dep', ref: sha, comment: null };
  const tags = [
    ['v1.0.0', 'a'.repeat(40)],
    ['v1.1.0', 'b'.repeat(40)]
  ];
  const result = planLine(entry, tags);
  assert.equal(result.state, 'UNPINNED');
  assert.equal(result.to.tag, 'v1.1.0');
  assert.equal(result.to.sha, 'b'.repeat(40));
  assert.equal(result.why, `mutable ref '${sha}' \u2014 pin to ${'b'.repeat(7)} (v1.1.0)`);
});

test('falls back to ref major for non-SHA ref when comment is null', () => {
  const entry = { name: 'dep', ref: 'v3.0.0', comment: null };
  const tags = [
    ['v3.0.0', 'a'.repeat(40)],
    ['v3.0.1', 'b'.repeat(40)]
  ];
  const result = planLine(entry, tags);
  assert.equal(result.state, 'UNPINNED');
  assert.equal(result.to.tag, 'v3.0.1');
});
