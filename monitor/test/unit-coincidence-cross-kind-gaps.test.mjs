// Computes time gaps between events of different kinds (monitor/coincidence.mjs crossKindGaps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossKindGaps } from '../coincidence.mjs';

test('returns an empty map when given no events', () => {
  const r = crossKindGaps([]);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map for a single kind with no cross-kind pairs', () => {
  const r = crossKindGaps([{ kind: 'a', t: 1000 }]);
  assert.deepEqual(r, new Map([]));
});

test('computes gaps from kind a to kind b when a precedes b', () => {
  const r = crossKindGaps([
    { kind: 'a', t: 1000 },
    { kind: 'b', t: 3000 },
  ]);
  assert.deepEqual(r, new Map([["a\u2192b", [{ from: { kind: "a", t: 1000 }, to: { kind: "b", t: 3000 }, gapSec: 2 }]], ["b\u2192a", []]]));
});

test('computes gaps from kind b to kind a when b precedes a', () => {
  const r = crossKindGaps([
    { kind: 'b', t: 1000 },
    { kind: 'a', t: 3000 },
  ]);
  assert.deepEqual(r, new Map([["a\u2192b", []], ["b\u2192a", [{ from: { kind: "b", t: 1000 }, to: { kind: "a", t: 3000 }, gapSec: 2 }]]]));
});

test('handles equal timestamps by including the later event in the gap', () => {
  const r = crossKindGaps([
    { kind: 'a', t: 1000 },
    { kind: 'b', t: 1000 },
  ]);
  assert.deepEqual(r, new Map([["a\u2192b", []], ["b\u2192a", []]]));
});

test('skips events of kind b that occur before events of kind a', () => {
  const r = crossKindGaps([
    { kind: 'b', t: 500 },
    { kind: 'a', t: 1000 },
    { kind: 'b', t: 2000 },
  ]);
  assert.deepEqual(r, new Map([["a\u2192b", [{ from: { kind: "a", t: 1000 }, to: { kind: "b", t: 2000 }, gapSec: 1 }]], ["b\u2192a", [{ from: { kind: "b", t: 500 }, to: { kind: "a", t: 1000 }, gapSec: 0.5 }]]]));
});

test('handles multiple events of each kind with interleaved timestamps', () => {
  const r = crossKindGaps([
    { kind: 'a', t: 1000 },
    { kind: 'b', t: 1500 },
    { kind: 'a', t: 2000 },
    { kind: 'b', t: 2500 },
  ]);
  assert.deepEqual(r, new Map([["a\u2192b", [{ from: { kind: "a", t: 1000 }, to: { kind: "b", t: 1500 }, gapSec: 0.5 }, { from: { kind: "a", t: 2000 }, to: { kind: "b", t: 2500 }, gapSec: 0.5 }]], ["b\u2192a", [{ from: { kind: "b", t: 1500 }, to: { kind: "a", t: 2000 }, gapSec: 0.5 }]]]));
});

test('handles three kinds with all pairwise gaps', () => {
  const r = crossKindGaps([
    { kind: 'a', t: 1000 },
    { kind: 'b', t: 2000 },
    { kind: 'c', t: 3000 },
  ]);
  assert.deepEqual(r, new Map([["a\u2192b", [{ from: { kind: "a", t: 1000 }, to: { kind: "b", t: 2000 }, gapSec: 1 }]], ["a\u2192c", [{ from: { kind: "a", t: 1000 }, to: { kind: "c", t: 3000 }, gapSec: 2 }]], ["b\u2192a", []], ["b\u2192c", [{ from: { kind: "b", t: 2000 }, to: { kind: "c", t: 3000 }, gapSec: 1 }]], ["c\u2192a", []], ["c\u2192b", []]]));
});
