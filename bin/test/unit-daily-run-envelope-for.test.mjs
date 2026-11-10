// Computes the daily envelope summary, coverage, and optional advice from a digest (bin/daily-run.mjs envelopeFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelopeFor } from '../daily-run.mjs';

test('computes summary counts and coverage for a digest with mixed lanes and items', () => {
  const digest = {
    gapDays: 3,
    repos: [
      {
        name: 'repo-a',
        baseline: true,
        items: [
          { id: 'i1', state: 'new' },
          { id: 'i2', state: 'persisting' },
          { id: 'i3', state: 'new' },
        ],
        fixed: ['f1', 'f2'],
        carried: ['c1'],
        omittedIds: ['o1', 'o2', 'o3'],
        lanes: [
          { lane: 'lint', state: 'ran' },
          { lane: 'test', state: 'skipped', note: 'no tests' },
          { lane: 'build', state: 'tool-changed', previousToolVersion: '1.0', toolVersion: '2.0' },
        ],
      },
      {
        name: 'repo-b',
        baseline: false,
        items: [
          { id: 'i4', state: 'persisting' },
        ],
        fixed: [],
        carried: [],
        omittedIds: [],
        lanes: [
          { lane: 'lint', state: 'failed', note: 'crash' },
        ],
      },
    ],
  };
  const result = envelopeFor(digest);
  assert.deepEqual(result, { summary: { new: 2, persisting: 2, fixed: 2, carried: 1, omitted: 3, voidLanes: 2, gapDays: 3, baselineRepos: ["repo-a"] }, coverage: [{ repo: "repo-a", lane: "test", state: "skipped", note: "no tests" }, { repo: "repo-a", lane: "build", state: "tool-changed" }, { repo: "repo-b", lane: "lint", state: "failed", note: "crash" }] });
});

test('returns empty coverage and zero counts for a digest with no repos', () => {
  const digest = { gapDays: 0, repos: [] };
  const result = envelopeFor(digest);
  assert.deepEqual(result, { summary: { new: 0, persisting: 0, fixed: 0, carried: 0, omitted: 0, voidLanes: 0, gapDays: 0, baselineRepos: [] }, coverage: [] });
});

test('omits the advice key when adviceReport returns an empty array', () => {
  const digest = {
    gapDays: 1,
    repos: [
      {
        name: 'r',
        baseline: false,
        items: [],
        fixed: [],
        carried: [],
        omittedIds: [],
        lanes: [{ lane: 'x', state: 'ran' }],
      },
    ],
  };
  const result = envelopeFor(digest);
  assert.deepEqual(result, { summary: { new: 0, persisting: 0, fixed: 0, carried: 0, omitted: 0, voidLanes: 0, gapDays: 1, baselineRepos: [] }, coverage: [] });
});

test('includes coverage entries for non-ran lanes with and without notes', () => {
  const digest = {
    gapDays: 2,
    repos: [
      {
        name: 'repo-c',
        baseline: true,
        items: [{ id: 'a', state: 'new' }],
        fixed: ['f'],
        carried: [],
        omittedIds: [],
        lanes: [
          { lane: 'l1', state: 'skipped' },
          { lane: 'l2', state: 'failed', note: 'boom' },
          { lane: 'l3', state: 'ran' },
        ],
      },
    ],
  };
  const result = envelopeFor(digest);
  assert.deepEqual(result, { summary: { new: 1, persisting: 0, fixed: 1, carried: 0, omitted: 0, voidLanes: 2, gapDays: 2, baselineRepos: ["repo-c"] }, coverage: [{ repo: "repo-c", lane: "l1", state: "skipped" }, { repo: "repo-c", lane: "l2", state: "failed", note: "boom" }] });
});

test('counts voidLanes excluding tool-changed lanes', () => {
  const digest = {
    gapDays: 5,
    repos: [
      {
        name: 'repo-d',
        baseline: false,
        items: [],
        fixed: [],
        carried: [],
        omittedIds: [],
        lanes: [
          { lane: 'a', state: 'skipped', note: 'n1' },
          { lane: 'b', state: 'tool-changed', previousToolVersion: '0.1', toolVersion: '0.2' },
          { lane: 'c', state: 'failed' },
          { lane: 'd', state: 'tool-changed', previousToolVersion: '1.0', toolVersion: '1.1' },
        ],
      },
    ],
  };
  const result = envelopeFor(digest);
  assert.deepEqual(result, { summary: { new: 0, persisting: 0, fixed: 0, carried: 0, omitted: 0, voidLanes: 2, gapDays: 5, baselineRepos: [] }, coverage: [{ repo: "repo-d", lane: "a", state: "skipped", note: "n1" }, { repo: "repo-d", lane: "b", state: "tool-changed" }, { repo: "repo-d", lane: "c", state: "failed" }, { repo: "repo-d", lane: "d", state: "tool-changed" }] });
});

test('sums fixed, carried, and omitted across multiple repos', () => {
  const digest = {
    gapDays: 4,
    repos: [
      {
        name: 'r1',
        baseline: true,
        items: [{ id: 'x', state: 'new' }],
        fixed: ['f1', 'f2', 'f3'],
        carried: ['c1'],
        omittedIds: ['o1'],
        lanes: [{ lane: 'l', state: 'ran' }],
      },
      {
        name: 'r2',
        baseline: true,
        items: [{ id: 'y', state: 'persisting' }],
        fixed: ['f4'],
        carried: ['c2', 'c3'],
        omittedIds: ['o2', 'o3'],
        lanes: [{ lane: 'l', state: 'skipped', note: 'skip' }],
      },
      {
        name: 'r3',
        baseline: false,
        items: [],
        fixed: [],
        carried: [],
        omittedIds: [],
        lanes: [{ lane: 'l', state: 'ran' }],
      },
    ],
  };
  const result = envelopeFor(digest);
  assert.deepEqual(result, { summary: { new: 1, persisting: 1, fixed: 4, carried: 3, omitted: 3, voidLanes: 1, gapDays: 4, baselineRepos: ["r1", "r2"] }, coverage: [{ repo: "r2", lane: "l", state: "skipped", note: "skip" }] });
});
