// pins: repo required to match - an unscoped accept on CVE-2026-54515 meant omitted repos matched 'all'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annMatch } from '../annotate-lib.mjs';

const finding = { id: 'CVE-1', package: 'pkg', repo: 'repo-a' };

test('an annotation scoped to the same repo matches', () => {
  assert.equal(annMatch({ id: 'CVE-1', repo: 'repo-a' }, finding), true);
});

test('an annotation scoped to a DIFFERENT repo does not match', () => {
  assert.equal(annMatch({ id: 'CVE-1', repo: 'repo-b' }, finding), false);
});

test('an annotation with NO repo matches nothing — omission is not fleet reach', () => {
  assert.equal(annMatch({ id: 'CVE-1' }, finding), false);
  assert.equal(annMatch({ id: 'CVE-1', repo: '' }, finding), false);
  assert.equal(annMatch({ id: 'CVE-1', repo: '   ' }, finding), false);
});

test("fleet reach is still available, but only when CLAIMED with scope:'fleet'", () => {
  assert.equal(annMatch({ id: 'CVE-1', scope: 'fleet' }, finding), true);
  assert.equal(annMatch({ id: 'CVE-1', scope: 'fleet' }, { ...finding, repo: 'anything' }), true);
});

test('id and package remain wildcards when omitted — only repo changed', () => {
  assert.equal(annMatch({ repo: 'repo-a' }, finding), true);
  assert.equal(annMatch({ package: 'pkg', repo: 'repo-a' }, finding), true);
  assert.equal(annMatch({ package: 'other', repo: 'repo-a' }, finding), false);
});

// TODO: assert the shipped store holds no unscoped suppressing annotation. Held back because the
// migrated monitor/annotations.json cannot land yet — it carries another session's uncommitted
// work. The matcher change above already neutralises the entry; this would guard against new ones.
