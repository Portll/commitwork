// Formats a human-readable preflight verdict string for a repo (monitor/preflight-join.mjs preflightClause).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightClause } from '../preflight-join.mjs';

test('returns unknown when preflight is falsy', () => {
  assert.equal(preflightClause(null, 'repo-a'), " \u2014 preflight: unknown (no preflight.json for this area)");
});

test('returns unknown when preflight is unreadable', () => {
  assert.equal(preflightClause({ unreadable: 'permission denied' }, 'repo-a'), " \u2014 preflight: unknown (permission denied)");
});

test('returns unknown when repo has no verdict', () => {
  const pf = { repos: [{ name: 'other', state: 'blind' }] };
  assert.equal(preflightClause(pf, 'repo-a'), " \u2014 preflight: unknown (this repo carries no preflight verdict)");
});

test('returns blind detail with ecosystems and stale marker', () => {
  const pf = {
    generated: '2024-01-01T00:00:00.000Z',
    repos: [{ name: 'repo-a', state: 'blind', ecosystems: [{ eco: 'npm', why: 'no lockfile' }] }]
  };
  assert.equal(preflightClause(pf, 'repo-a', '2024-01-02T00:00:00.000Z'), " \u2014 preflight (from an earlier run, 2024-01-01T00:00:00.000Z): blind \u2014 preflight found a resolved dependency set here, so an empty scan is NOT explained by the tree's shape and is worth investigating");
});

test('returns blind detail without stale marker when generated after batch', () => {
  const pf = {
    generated: '2024-01-02T00:00:00.000Z',
    repos: [{ name: 'repo-a', state: 'blind', ecosystems: [{ eco: 'npm', why: 'no lockfile' }] }]
  };
  assert.equal(preflightClause(pf, 'repo-a', '2024-01-01T00:00:00.000Z'), " \u2014 preflight: blind \u2014 preflight found a resolved dependency set here, so an empty scan is NOT explained by the tree's shape and is worth investigating");
});

test('returns blind detail without stale marker when generated equals batch', () => {
  const pf = {
    generated: '2024-01-01T00:00:00.000Z',
    repos: [{ name: 'repo-a', state: 'blind', ecosystems: [{ eco: 'npm', why: 'no lockfile' }] }]
  };
  assert.equal(preflightClause(pf, 'repo-a', '2024-01-01T00:00:00.000Z'), " \u2014 preflight: blind \u2014 preflight found a resolved dependency set here, so an empty scan is NOT explained by the tree's shape and is worth investigating");
});

test('returns subtree-only detail with note', () => {
  const pf = {
    generated: '2024-01-01T00:00:00.000Z',
    repos: [{ name: 'repo-a', state: 'subtree-only', note: 'manifests in subdirs' }]
  };
  assert.equal(preflightClause(pf, 'repo-a', '2024-01-02T00:00:00.000Z'), " \u2014 preflight (from an earlier run, 2024-01-01T00:00:00.000Z): subtree-only \u2014 manifests in subdirs");
});

test('returns no-surface detail with note', () => {
  const pf = {
    generated: '2024-01-01T00:00:00.000Z',
    repos: [{ name: 'repo-a', state: 'no-surface', note: 'no manifests found' }]
  };
  assert.equal(preflightClause(pf, 'repo-a', '2024-01-02T00:00:00.000Z'), " \u2014 preflight (from an earlier run, 2024-01-01T00:00:00.000Z): no-surface \u2014 no manifests found");
});

test('returns missing detail', () => {
  const pf = {
    generated: '2024-01-01T00:00:00.000Z',
    repos: [{ name: 'repo-a', state: 'missing' }]
  };
  assert.equal(preflightClause(pf, 'repo-a', '2024-01-02T00:00:00.000Z'), " \u2014 preflight (from an earlier run, 2024-01-01T00:00:00.000Z): missing \u2014 the repo is not on disk");
});

test('returns resolved detail for unknown state', () => {
  const pf = {
    generated: '2024-01-01T00:00:00.000Z',
    repos: [{ name: 'repo-a', state: 'resolved' }]
  };
  assert.equal(preflightClause(pf, 'repo-a', '2024-01-02T00:00:00.000Z'), " \u2014 preflight (from an earlier run, 2024-01-01T00:00:00.000Z): resolved \u2014 preflight found a resolved dependency set here, so an empty scan is NOT explained by the tree's shape and is worth investigating");
});
