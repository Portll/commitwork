// Deduplicates cell boundaries by sha256 ref and returns a map of unique boundaries plus compacted repos (bin/lib/isolation.mjs compactBoundaries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactBoundaries } from '../lib/isolation.mjs';

test('returns empty boundaries and repos for non-array input', () => {
  assert.deepEqual(compactBoundaries(null), { boundaries: {}, repos: [] });
});

test('returns empty boundaries and repos for empty array', () => {
  assert.deepEqual(compactBoundaries([]), { boundaries: {}, repos: [] });
});

test('preserves cell as-is when cell is not a record', () => {
  const repos = [{ cells: { a: 'not-a-record' } }];
  assert.deepEqual(compactBoundaries(repos), { boundaries: {}, repos: [{ cells: { a: "not-a-record" } }] });
});

test('preserves cell as-is when boundary is not a record', () => {
  const repos = [{ cells: { a: { boundary: 'not-a-record' } } }];
  assert.deepEqual(compactBoundaries(repos), { boundaries: {}, repos: [{ cells: { a: { boundary: "not-a-record" } } }] });
});

test('compacts cell with valid boundary record', () => {
  const repos = [{ cells: { a: { boundary: { state: 'ok', findingSource: 'scan' } } } }];
  assert.deepEqual(compactBoundaries(repos), { boundaries: { "sha256:9b4992a118c8d1b66cc0042c4f4ef5b9137a0c0020f85ab0defd08a739d1f798": { state: "ok", findingSource: "scan" } }, repos: [{ cells: { a: { boundary: { ref: "sha256:9b4992a118c8d1b66cc0042c4f4ef5b9137a0c0020f85ab0defd08a739d1f798", state: "ok", findingSource: "scan" } } } }] });
});

test('compacts cell with boundary missing findingSource', () => {
  const repos = [{ cells: { a: { boundary: { state: 'ok' } } } }];
  assert.deepEqual(compactBoundaries(repos), { boundaries: { "sha256:d90b46008510d95001237f407c5545003329155a5dab6edaa4336a646797c12e": { state: "ok" } }, repos: [{ cells: { a: { boundary: { ref: "sha256:d90b46008510d95001237f407c5545003329155a5dab6edaa4336a646797c12e", state: "ok", findingSource: null } } } }] });
});

test('deduplicates identical boundaries across cells', () => {
  const b = { state: 'ok', findingSource: 'scan' };
  const repos = [{ cells: { a: { boundary: b }, b: { boundary: { ...b } } } }];
  assert.deepEqual(compactBoundaries(repos), { boundaries: { "sha256:9b4992a118c8d1b66cc0042c4f4ef5b9137a0c0020f85ab0defd08a739d1f798": { state: "ok", findingSource: "scan" } }, repos: [{ cells: { a: { boundary: { ref: "sha256:9b4992a118c8d1b66cc0042c4f4ef5b9137a0c0020f85ab0defd08a739d1f798", state: "ok", findingSource: "scan" } }, b: { boundary: { ref: "sha256:9b4992a118c8d1b66cc0042c4f4ef5b9137a0c0020f85ab0defd08a739d1f798", state: "ok", findingSource: "scan" } } } }] });
});

test('keeps distinct boundaries separate', () => {
  const repos = [{ cells: { a: { boundary: { state: 'ok' } }, b: { boundary: { state: 'fail' } } } }];
  assert.deepEqual(compactBoundaries(repos), { boundaries: { "sha256:895d351397ddcacc77e8f38aa881366d16c3d466a2e1ea899bb3dfd629b21c22": { state: "fail" }, "sha256:d90b46008510d95001237f407c5545003329155a5dab6edaa4336a646797c12e": { state: "ok" } }, repos: [{ cells: { a: { boundary: { ref: "sha256:d90b46008510d95001237f407c5545003329155a5dab6edaa4336a646797c12e", state: "ok", findingSource: null } }, b: { boundary: { ref: "sha256:895d351397ddcacc77e8f38aa881366d16c3d466a2e1ea899bb3dfd629b21c22", state: "fail", findingSource: null } } } }] });
});

test('handles multiple repos with mixed cell types', () => {
  const repos = [
    { cells: { a: { boundary: { state: 'ok' } } } },
    { cells: { b: null, c: { boundary: { state: 'ok' } } } },
  ];
  assert.deepEqual(compactBoundaries(repos), { boundaries: { "sha256:d90b46008510d95001237f407c5545003329155a5dab6edaa4336a646797c12e": { state: "ok" } }, repos: [{ cells: { a: { boundary: { ref: "sha256:d90b46008510d95001237f407c5545003329155a5dab6edaa4336a646797c12e", state: "ok", findingSource: null } } } }, { cells: { b: null, c: { boundary: { ref: "sha256:d90b46008510d95001237f407c5545003329155a5dab6edaa4336a646797c12e", state: "ok", findingSource: null } } } }] });
});
