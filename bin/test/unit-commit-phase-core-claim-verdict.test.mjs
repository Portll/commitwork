// Classifies staged and dirty paths against claims into own, taken, refuse, unscoped, and unclaimedDirty buckets. (bin/commit-phase-core.mjs claimVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimVerdict } from '../commit-phase-core.mjs';

test('scoped claim with matching root and session goes to own', () => {
  const r = claimVerdict({
    claims: [{ path: '/repo/src/a.js', scoped: true, root: '/repo', session: 's1' }],
    staged: ['src/a.js'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [{ path: "src/a.js", claim: { path: "/repo/src/a.js", scoped: true, root: "/repo", session: "s1" } }], unscoped: [], unclaimedDirty: [] });
});

test('scoped claim with matching root but different session goes to refuse when take is false', () => {
  const r = claimVerdict({
    claims: [{ path: '/repo/src/b.js', scoped: true, root: '/repo', session: 's2' }],
    staged: ['src/b.js'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [{ path: "src/b.js", claim: { path: "/repo/src/b.js", scoped: true, root: "/repo", session: "s2" } }], taken: [], own: [], unscoped: [], unclaimedDirty: [] });
});

test('scoped claim with matching root but different session goes to taken when take is true', () => {
  const r = claimVerdict({
    claims: [{ path: '/repo/src/c.js', scoped: true, root: '/repo', session: 's2' }],
    staged: ['src/c.js'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: true
  });
  assert.deepEqual(r, { refuse: [], taken: [{ path: "src/c.js", claim: { path: "/repo/src/c.js", scoped: true, root: "/repo", session: "s2" } }], own: [], unscoped: [], unclaimedDirty: [] });
});

test('unscoped claim with different session goes to unscoped', () => {
  const r = claimVerdict({
    claims: [{ path: 'src/d.js', scoped: false, session: 's2' }],
    staged: ['src/d.js'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [], unscoped: [{ path: "src/d.js", claim: { path: "src/d.js", scoped: false, session: "s2" } }], unclaimedDirty: [] });
});

test('unscoped claim with same session does not go to unscoped', () => {
  const r = claimVerdict({
    claims: [{ path: 'src/e.js', scoped: false, session: 's1' }],
    staged: ['src/e.js'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [], unscoped: [], unclaimedDirty: [] });
});

test('absolute path claim outside root is ignored', () => {
  const r = claimVerdict({
    claims: [{ path: '/other/f.js', scoped: true, root: '/other', session: 's1' }],
    staged: ['f.js'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [], unscoped: [], unclaimedDirty: [] });
});

test('dirty path not in staged or scoped goes to unclaimedDirty', () => {
  const r = claimVerdict({
    claims: [{ path: '/repo/src/g.js', scoped: true, root: '/repo', session: 's1' }],
    staged: ['src/g.js'],
    dirty: ['src/h.js'],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [{ path: "src/g.js", claim: { path: "/repo/src/g.js", scoped: true, root: "/repo", session: "s1" } }], unscoped: [], unclaimedDirty: ["src/h.js"] });
});

test('claim with non-string path is ignored', () => {
  const r = claimVerdict({
    claims: [{ path: 123, scoped: false, session: 's1' }],
    staged: ['123'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [], unscoped: [], unclaimedDirty: [] });
});

test('claim with empty string path is ignored', () => {
  const r = claimVerdict({
    claims: [{ path: '', scoped: false, session: 's1' }],
    staged: [''],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [], unscoped: [], unclaimedDirty: [] });
});

test('scoped claim with non-matching root is ignored', () => {
  const r = claimVerdict({
    claims: [{ path: 'src/i.js', scoped: true, root: '/other', session: 's1' }],
    staged: ['src/i.js'],
    dirty: [],
    root: '/repo',
    me: 's1',
    take: false
  });
  assert.deepEqual(r, { refuse: [], taken: [], own: [], unscoped: [], unclaimedDirty: [] });
});
