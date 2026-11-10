// Git branch name derived from an advisory id (monitor/remediation-pr.mjs branchFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchFor } from '../remediation-pr.mjs';

test('falls back to deps/advisory when the advisory is undefined or null', () => {
  assert.equal(branchFor(undefined), 'deps/advisory');
  assert.equal(branchFor(null), 'deps/advisory');
});

test('falls back to deps/advisory when the advisory has no id', () => {
  assert.equal(branchFor({}), 'deps/advisory');
});

test('falls back to deps/advisory when the id is falsy', () => {
  assert.equal(branchFor({ id: '' }), 'deps/advisory');
  assert.equal(branchFor({ id: 0 }), 'deps/advisory');
  assert.equal(branchFor({ id: false }), 'deps/advisory');
});

test('uses a plain lowercase id unchanged', () => {
  assert.equal(branchFor({ id: 'lodash' }), 'deps/lodash');
});

test('lowercases an id and keeps every digit from two to nine', () => {
  assert.equal(branchFor({ id: 'CVE-2024-3789' }), 'deps/cve-2024-3789');
  assert.equal(branchFor({ id: 'GHSA-2345-6789' }), 'deps/ghsa-2345-6789');
});

test('keeps the digits zero and one', () => {
  assert.equal(branchFor({ id: 'a0-1b' }), 'deps/a0-1b');
});

test('converts a numeric id to its decimal string', () => {
  assert.equal(branchFor({ id: 123456789 }), 'deps/123456789');
});

test('collapses each run of disallowed characters into one dash', () => {
  assert.equal(branchFor({ id: 'GHSA_abcd.efgh' }), 'deps/ghsa-abcd-efgh');
  assert.equal(branchFor({ id: 'a  __  b' }), 'deps/a-b');
});

test('trims dashes from both ends of the id', () => {
  assert.equal(branchFor({ id: '--Foo Bar!!' }), 'deps/foo-bar');
});

test('leaves an empty slug when the id has no allowed characters', () => {
  assert.equal(branchFor({ id: '!!!' }), 'deps/');
});
