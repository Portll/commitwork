// Groups zero-finding artifacts shared byte-identically across repos into anomalies and suppressions (monitor/artifact-anomaly.mjs findAnomaliesDetailed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAnomaliesDetailed } from '../artifact-anomaly.mjs';

const mk = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  repo: `r${i}`, file: `f${i}`, category: 'c', hash: 'h1', bytes: 1024, total: 0, ...extra,
}));
const reposOf = (n) => Array.from({ length: n }, (_, i) => `r${i}`);
const anomaly = (n, extra = {}) => ({
  category: 'c', hash: 'h1', repoCount: n, bytes: 1024, repos: reposOf(n), truncated: 0, ...extra,
});
const empty = { anomalies: [], suppressed: [] };

test('Missing or empty samples yield no anomalies and no suppressions', () => {
  assert.deepEqual(findAnomaliesDetailed(null), empty);
  assert.deepEqual(findAnomaliesDetailed(undefined), empty);
  assert.deepEqual(findAnomaliesDetailed([]), empty);
});

test('An artifact shared by exactly minRepos clean repos is reported with its repos sorted', () => {
  assert.deepEqual(findAnomaliesDetailed(mk(5).reverse()), { anomalies: [anomaly(5)], suppressed: [] });
  assert.deepEqual(findAnomaliesDetailed(mk(4)), empty);
  assert.deepEqual(findAnomaliesDetailed(mk(4), { minRepos: 4 }), { anomalies: [anomaly(4)], suppressed: [] });
  assert.deepEqual(findAnomaliesDetailed(mk(4), { minRepos: 0 }), empty);
});

test('Artifacts one byte below the floor are suppressed while exactly the floor is reported', () => {
  assert.deepEqual(findAnomaliesDetailed(mk(5, { bytes: 511 })), {
    anomalies: [],
    suppressed: [{ category: 'c', hash: 'h1', repoCount: 5, bytes: 511, reason: 'below-information-floor' }],
  });
  assert.deepEqual(findAnomaliesDetailed(mk(5, { bytes: 512 })), {
    anomalies: [anomaly(5, { bytes: 512 })],
    suppressed: [],
  });
  assert.deepEqual(findAnomaliesDetailed(mk(5, { bytes: undefined }), { minBytes: 0 }), {
    anomalies: [anomaly(5, { bytes: 0 })],
    suppressed: [],
  });
});

test('A group whose file carries findings in any category is suppressed rather than reported', () => {
  const expected = {
    anomalies: [],
    suppressed: [{ category: 'c', hash: 'h1', repoCount: 5, bytes: 1024, reason: 'artifact-carries-findings' }],
  };
  const sibling = [...mk(5), { repo: 'r0', file: 'f0', category: 'other', hash: 'hx', bytes: 1024, total: 2 }];
  assert.deepEqual(findAnomaliesDetailed(sibling), expected);
  const viaArtifactTotal = mk(5).map((s, i) => (i === 2 ? { ...s, artifactTotal: 3 } : s));
  assert.deepEqual(findAnomaliesDetailed(viaArtifactTotal), expected);
  assert.deepEqual(findAnomaliesDetailed([...mk(5, { bytes: 10 }), { ...mk(1)[0], category: 'z', total: 1 }]), {
    anomalies: [],
    suppressed: [{ category: 'c', hash: 'h1', repoCount: 5, bytes: 10, reason: 'artifact-carries-findings' }],
  });
});

test('Any non-zero or unconfirmed total in a group prevents it from being reported or suppressed', () => {
  assert.deepEqual(findAnomaliesDetailed(mk(5, { total: null })), empty);
  const oneFinding = mk(5).map((s, i) => (i === 4 ? { ...s, total: 1 } : s));
  assert.deepEqual(findAnomaliesDetailed(oneFinding), empty);
});

test('Invalid samples are skipped, including ones whose category is not a string', () => {
  const samples = [null, ...mk(5, { category: 42 }), ...mk(5, { hash: '' }), ...mk(5)];
  assert.deepEqual(findAnomaliesDetailed(samples), { anomalies: [anomaly(5)], suppressed: [] });
  assert.deepEqual(findAnomaliesDetailed(mk(5, { category: 42 })), empty);
});

test('The repo cap truncates the listed repos and states how many were dropped', () => {
  assert.deepEqual(findAnomaliesDetailed(mk(6), { repoCap: 5 }), {
    anomalies: [anomaly(6, { repos: reposOf(5), truncated: 1 })],
    suppressed: [],
  });
  assert.deepEqual(findAnomaliesDetailed(mk(6), { repoCap: 6 }), { anomalies: [anomaly(6)], suppressed: [] });
  assert.deepEqual(findAnomaliesDetailed(mk(6), { repoCap: 0 }), { anomalies: [anomaly(6)], suppressed: [] });
  assert.deepEqual(findAnomaliesDetailed(mk(6), { repoCap: 1 }), {
    anomalies: [anomaly(6, { repos: ['r0'], truncated: 5 })],
    suppressed: [],
  });
});

test('Anomalies and suppressions are ordered by category and then by hash', () => {
  const samples = [...mk(5), ...mk(5, { hash: 'h2', bytes: 600 }), ...mk(5, { category: 'a', hash: 'h3' })];
  assert.deepEqual(findAnomaliesDetailed(samples), {
    anomalies: [
      anomaly(5, { category: 'a', hash: 'h3' }),
      anomaly(5),
      anomaly(5, { hash: 'h2', bytes: 600 }),
    ],
    suppressed: [],
  });
  const pair = [...mk(5), ...mk(5, { hash: 'h2' })];
  assert.deepEqual(findAnomaliesDetailed(pair), {
    anomalies: [anomaly(5), anomaly(5, { hash: 'h2' })],
    suppressed: [],
  });
  const small = [...mk(5, { bytes: 10 }), ...mk(5, { hash: 'h2', bytes: 10 })];
  assert.deepEqual(findAnomaliesDetailed(small), {
    anomalies: [],
    suppressed: [
      { category: 'c', hash: 'h1', repoCount: 5, bytes: 10, reason: 'below-information-floor' },
      { category: 'c', hash: 'h2', repoCount: 5, bytes: 10, reason: 'below-information-floor' },
    ],
  });
});
