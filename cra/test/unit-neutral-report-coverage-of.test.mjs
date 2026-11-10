// Computes per-lane coverage status from a scanner rollup (cra/neutral-report.mjs coverageOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageOf } from '../neutral-report.mjs';

test('returns empty array when rollup is null', () => {
  assert.deepEqual(coverageOf(null), []);
});

test('returns empty array when rollup has no scanners property', () => {
  assert.deepEqual(coverageOf({}), []);
});

test('returns empty array when scanners is empty object', () => {
  assert.deepEqual(coverageOf({ scanners: {} }), []);
});

test('skips lanes whose value is not an object', () => {
  assert.deepEqual(coverageOf({ scanners: { a: 42, b: null, c: 'str' } }), []);
});

test('skips lanes with no coverage key', () => {
  assert.deepEqual(coverageOf({ scanners: { a: { coverageBasis: 'x' } } }), []);
});

test('reports full coverage with basis and reason', () => {
  assert.deepEqual(
    coverageOf({ scanners: { a: { coverage: 'full', coverageBasis: 'b1', coverageReason: 'r1' } } }),
    [{ lane: "a", coverage: "full", basis: "b1", reason: "r1" }]
  );
});

test('reports reduced coverage with reducedReason', () => {
  assert.deepEqual(
    coverageOf({ scanners: { a: { coverage: 'reduced', reducedReason: 'rr' } } }),
    [{ lane: "a", coverage: "reduced", reason: "rr" }]
  );
});

test('reports unknown coverage with unknownReason', () => {
  assert.deepEqual(
    coverageOf({ scanners: { a: { coverage: 'unknown', unknownReason: 'ur' } } }),
    [{ lane: "a", coverage: "unknown", reason: "ur" }]
  );
});

test('coerces invalid coverage value to unknown', () => {
  assert.deepEqual(
    coverageOf({ scanners: { a: { coverage: 'partial', coverageReason: 'cr' } } }),
    [{ lane: "a", coverage: "unknown", reason: "cr" }]
  );
});

test('prefers coverageReason over reducedReason and unknownReason', () => {
  assert.deepEqual(
    coverageOf({
      scanners: {
        a: { coverage: 'reduced', coverageReason: 'cr', reducedReason: 'rr', unknownReason: 'ur' },
      },
    }),
    [{ lane: "a", coverage: "reduced", reason: "cr" }]
  );
});

test('falls back to reducedReason when coverageReason is absent', () => {
  assert.deepEqual(
    coverageOf({
      scanners: {
        a: { coverage: 'reduced', reducedReason: 'rr', unknownReason: 'ur' },
      },
    }),
    [{ lane: "a", coverage: "reduced", reason: "rr" }]
  );
});

test('falls back to unknownReason when coverageReason and reducedReason are absent', () => {
  assert.deepEqual(
    coverageOf({
      scanners: {
        a: { coverage: 'unknown', unknownReason: 'ur' },
      },
    }),
    [{ lane: "a", coverage: "unknown", reason: "ur" }]
  );
});

test('sets reason to null when no reason fields are present', () => {
  assert.deepEqual(
    coverageOf({ scanners: { a: { coverage: 'full' } } }),
    [{ lane: "a", coverage: "full", reason: null }]
  );
});

test('omits basis property when coverageBasis is absent', () => {
  assert.deepEqual(
    coverageOf({ scanners: { a: { coverage: 'full', coverageReason: 'r' } } }),
    [{ lane: "a", coverage: "full", reason: "r" }]
  );
});

test('sorts lanes alphabetically', () => {
  assert.deepEqual(
    coverageOf({
      scanners: {
        z: { coverage: 'full' },
        a: { coverage: 'reduced' },
        m: { coverage: 'unknown' },
      },
    }),
    [{ lane: "a", coverage: "reduced", reason: null }, { lane: "m", coverage: "unknown", reason: null }, { lane: "z", coverage: "full", reason: null }]
  );
});
