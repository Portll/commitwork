// Whether a batch's manifest and verdict cover every member and are fully published (monitor/daily.mjs batchIsComplete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchIsComplete } from '../daily.mjs';

test('returns false when manifest is missing', () => {
  const result = batchIsComplete({ manifest: null, verdict: { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } } }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when verdict is missing', () => {
  const result = batchIsComplete({ manifest: { group: 'all', scope: { repos: [{ name: 'a' }] } }, verdict: null }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when manifest.only is truthy', () => {
  const result = batchIsComplete({ manifest: { only: true, group: 'all', scope: { repos: [{ name: 'a' }] } }, verdict: { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } } }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when manifest.group does not match group argument', () => {
  const result = batchIsComplete({ manifest: { group: 'other', scope: { repos: [{ name: 'a' }] } }, verdict: { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } } }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when verdict.rollup is not published', () => {
  const result = batchIsComplete({ manifest: { group: 'all', scope: { repos: [{ name: 'a' }] } }, verdict: { rollup: 'draft', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } } }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when repos.resolved is zero', () => {
  const result = batchIsComplete({ manifest: { group: 'all', scope: { repos: [{ name: 'a' }] } }, verdict: { rollup: 'published', repos: { resolved: 0, scanned: 0, scans: [] } } }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when repos.scanned does not equal repos.resolved', () => {
  const result = batchIsComplete({ manifest: { group: 'all', scope: { repos: [{ name: 'a' }] } }, verdict: { rollup: 'published', repos: { resolved: 2, scanned: 1, scans: [{ ran: true }] } } }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when any scan has ran set to false', () => {
  const result = batchIsComplete({ manifest: { group: 'all', scope: { repos: [{ name: 'a' }] } }, verdict: { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: false }] } } }, ['a'], 'all');
  assert.equal(result, false);
});

test('returns false when a member is not in manifest.scope.repos', () => {
  const result = batchIsComplete({ manifest: { group: 'all', scope: { repos: [{ name: 'a' }] } }, verdict: { rollup: 'published', repos: { resolved: 1, scanned: 1, scans: [{ ran: true }] } } }, ['a', 'b'], 'all');
  assert.equal(result, false);
});

test('returns true when all conditions are met and all members are scoped', () => {
  const result = batchIsComplete({ manifest: { group: 'all', scope: { repos: [{ name: 'a' }, { name: 'b' }] } }, verdict: { rollup: 'published', repos: { resolved: 2, scanned: 2, scans: [{ ran: true }, { ran: true }] } } }, ['a', 'b'], 'all');
  assert.equal(result, true);
});
