// Extracts and sorts open band refutations from a document (monitor/refutation.mjs bandRefutations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandRefutations } from '../refutation.mjs';

test('returns empty array when refutations is missing', () => {
  const doc = {};
  const result = bandRefutations(doc);
  assert.deepEqual(result, []);
});

test('returns empty array when refutations is null', () => {
  const doc = { refutations: null };
  const result = bandRefutations(doc);
  assert.deepEqual(result, []);
});

test('filters out non-band targets', () => {
  const doc = {
    refutations: {
      r1: { target: 'file:src/index.js', by: 'alice', ground: 'bad', filedAt: '2024-01-01', independence: 'solo', state: 'open', resolution: null, id: 'id1' },
    },
  };
  const result = bandRefutations(doc);
  assert.deepEqual(result, []);
});

test('includes open band refutations by default', () => {
  const doc = {
    refutations: {
      r1: { target: 'band:lint', by: 'alice', ground: 'style', filedAt: '2024-01-01', independence: 'solo', state: 'open', resolution: null, id: 'id1' },
    },
  };
  const result = bandRefutations(doc);
  assert.deepEqual(result, [{ detector: "lint", by: "alice", reason: "style", at: "2024-01-01", independence: "solo", state: "open", resolution: null, id: "id1" }]);
});

test('excludes resolved band refutations by default', () => {
  const doc = {
    refutations: {
      r1: { target: 'band:lint', by: 'alice', ground: 'style', filedAt: '2024-01-01', independence: 'solo', state: 'resolved', resolution: 'fixed', id: 'id1' },
    },
  };
  const result = bandRefutations(doc);
  assert.deepEqual(result, []);
});

test('includes resolved band refutations when includeResolved is true', () => {
  const doc = {
    refutations: {
      r1: { target: 'band:lint', by: 'alice', ground: 'style', filedAt: '2024-01-01', independence: 'solo', state: 'resolved', resolution: 'fixed', id: 'id1' },
    },
  };
  const result = bandRefutations(doc, { includeResolved: true });
  assert.deepEqual(result, [{ detector: "lint", by: "alice", reason: "style", at: "2024-01-01", independence: "solo", state: "resolved", resolution: "fixed", id: "id1" }]);
});

test('sorts by detector name ascending', () => {
  const doc = {
    refutations: {
      r1: { target: 'band:zeta', by: 'alice', ground: 'g1', filedAt: '2024-01-01', independence: 'solo', state: 'open', resolution: null, id: 'id1' },
      r2: { target: 'band:alpha', by: 'bob', ground: 'g2', filedAt: '2024-01-02', independence: 'solo', state: 'open', resolution: null, id: 'id2' },
    },
  };
  const result = bandRefutations(doc);
  assert.deepEqual(result, [{ detector: "alpha", by: "bob", reason: "g2", at: "2024-01-02", independence: "solo", state: "open", resolution: null, id: "id2" }, { detector: "zeta", by: "alice", reason: "g1", at: "2024-01-01", independence: "solo", state: "open", resolution: null, id: "id1" }]);
});

test('sorts by filedAt when detectors are equal', () => {
  const doc = {
    refutations: {
      r1: { target: 'band:lint', by: 'alice', ground: 'g1', filedAt: '2024-01-02', independence: 'solo', state: 'open', resolution: null, id: 'id1' },
      r2: { target: 'band:lint', by: 'bob', ground: 'g2', filedAt: '2024-01-01', independence: 'solo', state: 'open', resolution: null, id: 'id2' },
    },
  };
  const result = bandRefutations(doc);
  assert.deepEqual(result, [{ detector: "lint", by: "bob", reason: "g2", at: "2024-01-01", independence: "solo", state: "open", resolution: null, id: "id2" }, { detector: "lint", by: "alice", reason: "g1", at: "2024-01-02", independence: "solo", state: "open", resolution: null, id: "id1" }]);
});

test('handles mixed states with includeResolved false', () => {
  const doc = {
    refutations: {
      r1: { target: 'band:beta', by: 'alice', ground: 'g1', filedAt: '2024-01-01', independence: 'solo', state: 'open', resolution: null, id: 'id1' },
      r2: { target: 'band:alpha', by: 'bob', ground: 'g2', filedAt: '2024-01-02', independence: 'solo', state: 'resolved', resolution: 'wontfix', id: 'id2' },
      r3: { target: 'file:main.js', by: 'carol', ground: 'g3', filedAt: '2024-01-03', independence: 'solo', state: 'open', resolution: null, id: 'id3' },
    },
  };
  const result = bandRefutations(doc);
  assert.deepEqual(result, [{ detector: "beta", by: "alice", reason: "g1", at: "2024-01-01", independence: "solo", state: "open", resolution: null, id: "id1" }]);
});
