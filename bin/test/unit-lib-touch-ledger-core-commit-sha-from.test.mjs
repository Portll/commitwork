// Extracts the commit SHA from git commit output (bin/lib/touch-ledger-core.mjs commitShaFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitShaFrom } from '../lib/touch-ledger-core.mjs';

test('returns null when command is null', () => {
  const r = commitShaFrom(null, '[main abc1234] subject');
  assert.equal(r, null);
});

test('returns null when command is empty string', () => {
  const r = commitShaFrom('', '[main abc1234] subject');
  assert.equal(r, null);
});

test('returns null when command does not contain git commit', () => {
  const r = commitShaFrom('git status', '[main abc1234] subject');
  assert.equal(r, null);
});

test('returns null when out is null', () => {
  const r = commitShaFrom('git commit -m msg', null);
  assert.equal(r, null);
});

test('returns null when out is empty string', () => {
  const r = commitShaFrom('git commit -m msg', '');
  assert.equal(r, null);
});

test('returns null when out has no bracket with sha', () => {
  const r = commitShaFrom('git commit -m msg', 'nothing here');
  assert.equal(r, null);
});

test('returns the 7-char sha from git commit output', () => {
  const r = commitShaFrom('git commit -m msg', '[main abc1234] subject');
  assert.equal(r, "abc1234");
});

test('returns the 40-char sha from git commit output', () => {
  const sha = 'a'.repeat(40);
  const r = commitShaFrom('git commit -m msg', `[main ${sha}] subject`);
  assert.equal(r, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test('returns null when sha is only 6 chars', () => {
  const r = commitShaFrom('git commit -m msg', '[main abc123] subject');
  assert.equal(r, null);
});

test('returns null when sha contains uppercase hex', () => {
  const r = commitShaFrom('git commit -m msg', '[main ABC1234] subject');
  assert.equal(r, null);
});
