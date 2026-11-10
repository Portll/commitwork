// Groups identical artifacts across repos and reports those that are byte-identical, zero-finding, and widespread (monitor/artifact-anomaly.mjs findAnomalies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAnomalies } from '../artifact-anomaly.mjs';

test('returns empty array when no samples are provided', () => {
  assert.deepEqual(findAnomalies([]), []);
});

test('returns empty array when sample count is below the minimum repo threshold', () => {
  const samples = [
    { repo: 'a', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f' },
    { repo: 'b', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f' },
    { repo: 'c', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f' },
    { repo: 'd', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f' },
  ];
  assert.deepEqual(findAnomalies(samples), []);
});

test('reports anomaly when sample count meets the minimum repo threshold', () => {
  const samples = Array.from({ length: 5 }, (_, i) => ({
    repo: `repo${i}`, category: 'c', hash: 'h1', bytes: 1024, total: 0, file: `f${i}`
  }));
  assert.deepEqual(findAnomalies(samples), [{ category: "c", hash: "h1", repoCount: 5, bytes: 1024, repos: ["repo0", "repo1", "repo2", "repo3", "repo4"], truncated: 0 }]);
});

test('returns empty array when artifact bytes are below the information floor', () => {
  const samples = Array.from({ length: 5 }, (_, i) => ({
    repo: `repo${i}`, category: 'c', hash: 'h1', bytes: 100, total: 0, file: `f${i}`
  }));
  assert.deepEqual(findAnomalies(samples), []);
});

test('returns empty array when any sample has a non-zero total', () => {
  const samples = [
    { repo: 'a', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f1' },
    { repo: 'b', category: 'c', hash: 'h1', bytes: 1024, total: 1, file: 'f2' },
    { repo: 'c', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f3' },
    { repo: 'd', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f4' },
    { repo: 'e', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f5' },
  ];
  assert.deepEqual(findAnomalies(samples), []);
});

test('returns empty array when a sibling category reports findings on the same file', () => {
  const samples = [
    { repo: 'a', category: 'c1', hash: 'h1', bytes: 1024, total: 0, file: 'shared' },
    { repo: 'a', category: 'c2', hash: 'h2', bytes: 1024, total: 5, file: 'shared' },
    { repo: 'b', category: 'c1', hash: 'h1', bytes: 1024, total: 0, file: 'shared' },
    { repo: 'c', category: 'c1', hash: 'h1', bytes: 1024, total: 0, file: 'shared' },
    { repo: 'd', category: 'c1', hash: 'h1', bytes: 1024, total: 0, file: 'shared' },
    { repo: 'e', category: 'c1', hash: 'h1', bytes: 1024, total: 0, file: 'shared' },
  ];
  assert.deepEqual(findAnomalies(samples), []);
});

test('truncates repo list when count exceeds the cap', () => {
  const samples = Array.from({ length: 7 }, (_, i) => ({
    repo: `repo${i}`, category: 'c', hash: 'h1', bytes: 1024, total: 0, file: `f${i}`
  }));
  assert.deepEqual(findAnomalies(samples, { repoCap: 5 }), [{ category: "c", hash: "h1", repoCount: 7, bytes: 1024, repos: ["repo0", "repo1", "repo2", "repo3", "repo4"], truncated: 2 }]);
});

test('returns empty array when sample has null total', () => {
  const samples = [
    { repo: 'a', category: 'c', hash: 'h1', bytes: 1024, total: null, file: 'f1' },
    { repo: 'b', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f2' },
    { repo: 'c', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f3' },
    { repo: 'd', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f4' },
    { repo: 'e', category: 'c', hash: 'h1', bytes: 1024, total: 0, file: 'f5' },
  ];
  assert.deepEqual(findAnomalies(samples), []);
});
