// Pools per-area defect-signature artifacts into a fleet-wide summary (monitor/defect-signature.mjs poolSignatures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolSignatures } from '../defect-signature.mjs';

test('returns an empty fleet summary when perArea is null', () => {
  const r = poolSignatures(null, { rate: 0.5, minRepos: 1 }, { at: 't0' });
  assert.deepEqual(r, { at: "t0", scope: "fleet", note: "A detector positive on this share of the repositories it scanned is a defect signature in the detector, not a fleet in crisis. Severities on its findings are unchanged here; the lane band carries the flag. rate and population are fields to read, never factors to multiply. Pooled over every declared area's artifact; the population floor applies to this pooled population.", thresholds: { rate: 0.5, minRepos: 1 }, areas: { declared: 0, read: 0, absent: 0, failed: 0 }, pooledFrom: [], population: {}, detectors: [], signatures: [], undetermined: [], unkeyed: {} });
});

test('throws when an artifact is not an object', () => {
  assert.throws(() => poolSignatures([{ area: 'a', artifact: null }], { rate: 0.5, minRepos: 1 }), { name: 'Error', message: "defect-signatures for area 'a': not a defect-signature artifact (needs population and detectors)" });
});

test('throws when a detector row lacks a lane string', () => {
  assert.throws(() => poolSignatures([{ area: 'a', artifact: { population: { L: 10 }, detectors: [{ detector: 'd', lane: 1, positives: 1 }] } }], { rate: 0.5, minRepos: 1 }), { name: 'Error', message: "defect-signatures for area 'a': a detector row lacks detector, lane or a positives count" });
});

test('throws when a population value is not a count', () => {
  assert.throws(() => poolSignatures([{ area: 'a', artifact: { population: { L: -1 }, detectors: [] } }], { rate: 0.5, minRepos: 1 }), { name: 'Error', message: "defect-signatures for area 'a': population.L is not a count" });
});

test('throws when an unkeyed value is not a count', () => {
  assert.throws(() => poolSignatures([{ area: 'a', artifact: { population: { L: 10 }, unkeyed: { L: -1 }, detectors: [] } }], { rate: 0.5, minRepos: 1 }), { name: 'Error', message: "defect-signatures for area 'a': unkeyed.L is not a count" });
});

test('marks a detector undetermined when positives exceed the pooled population', () => {
  const r = poolSignatures([{ area: 'a', artifact: { population: { L: 10 }, detectors: [{ detector: 'd', lane: 'L', positives: 11 }] } }], { rate: 0.5, minRepos: 1 });
  assert.deepEqual(r.detectors, [{ detector: "d", lane: "L", id: "", population: 10, positives: 11, rate: null, signature: false, undetermined: "positives exceed the lane population; the per-area artifact predates the row-bearing denominator" }]);
});

test('computes the rate and signature flag for a detector within the population', () => {
  const r = poolSignatures([{ area: 'a', artifact: { population: { L: 100 }, detectors: [{ detector: 'd', lane: 'L', positives: 50 }] } }], { rate: 0.5, minRepos: 1 });
  assert.deepEqual(r.detectors, [{ detector: "d", lane: "L", id: "", population: 100, positives: 50, rate: 0.5, signature: true }]);
});

test('derives the id from the detector name when no id is given', () => {
  const r = poolSignatures([{ area: 'a', artifact: { population: { L: 100 }, detectors: [{ detector: 'L:xyz', lane: 'L', positives: 1 }] } }], { rate: 0.5, minRepos: 1 });
  assert.deepEqual(r.detectors, [{ detector: "L:xyz", lane: "L", id: "xyz", population: 100, positives: 1, rate: 0.01, signature: false }]);
});

test('sorts detectors by name and lists signatures in the same order', () => {
  const r = poolSignatures([{ area: 'a', artifact: { population: { L: 100 }, detectors: [{ detector: 'b', lane: 'L', positives: 50 }, { detector: 'a', lane: 'L', positives: 50 }] } }], { rate: 0.5, minRepos: 1 });
  assert.deepEqual(r.detectors, [{ detector: "a", lane: "L", id: "", population: 100, positives: 50, rate: 0.5, signature: true }, { detector: "b", lane: "L", id: "", population: 100, positives: 50, rate: 0.5, signature: true }]);
  assert.deepEqual(r.signatures, [{ detector: "a", lane: "L", rate: 0.5, population: 100, positives: 50, signature: true }, { detector: "b", lane: "L", rate: 0.5, population: 100, positives: 50, signature: true }]);
});

test('pools population and unkeyed counts across multiple areas', () => {
  const r = poolSignatures([
    { area: 'a', artifact: { population: { L: 10, M: 5 }, unkeyed: { L: 1 }, detectors: [] } },
    { area: 'b', artifact: { population: { L: 20, M: 15 }, unkeyed: { L: 2 }, detectors: [] } },
  ], { rate: 0.5, minRepos: 1 });
  assert.deepEqual(r.population, { L: 30, M: 20 });
  assert.deepEqual(r.unkeyed, { L: 3 });
  assert.deepEqual(r.pooledFrom, ["a", "b"]);
});
