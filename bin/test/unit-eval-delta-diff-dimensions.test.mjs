// Computes per-dimension deltas and aggregate totals between two evaluation documents (bin/eval-delta.mjs diffDimensions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffDimensions } from '../eval-delta.mjs';

test('returns empty rows and zero totals when both documents have no dimensions', () => {
  const result = diffDimensions({ dimensions: {} }, { dimensions: {} });
  assert.deepEqual(result, {
    rows: [],
    totals: { before: 0, after: 0, regressed: 0, vanished: 0, improved: 0 },
  });
});

test('marks a dimension as improved when current value exceeds base value', () => {
  const result = diffDimensions(
    { dimensions: { score: 10 } },
    { dimensions: { score: 15 } }
  );
  assert.deepEqual(result, {
    rows: [{ name: 'score', before: 10, after: 15, delta: 5, state: 'improved' }],
    totals: { before: 10, after: 15, regressed: 0, vanished: 0, improved: 1 },
  });
});

test('marks a dimension as REGRESSED when current value is below base value', () => {
  const result = diffDimensions(
    { dimensions: { score: 10 } },
    { dimensions: { score: 5 } }
  );
  assert.deepEqual(result, {
    rows: [{ name: 'score', before: 10, after: 5, delta: -5, state: 'REGRESSED' }],
    totals: { before: 10, after: 5, regressed: 1, vanished: 0, improved: 0 },
  });
});

test('marks a dimension as unchanged when current value equals base value', () => {
  const result = diffDimensions(
    { dimensions: { score: 10 } },
    { dimensions: { score: 10 } }
  );
  assert.deepEqual(result, {
    rows: [{ name: 'score', before: 10, after: 10, delta: 0, state: 'unchanged' }],
    totals: { before: 10, after: 10, regressed: 0, vanished: 0, improved: 0 },
  });
});

test('marks a dimension as vanished when present in base but missing in current', () => {
  const result = diffDimensions(
    { dimensions: { score: 10 } },
    { dimensions: {} }
  );
  assert.deepEqual(result, {
    rows: [{ name: 'score', before: 10, after: null, delta: null, state: 'vanished' }],
    totals: { before: 0, after: 0, regressed: 0, vanished: 1, improved: 0 },
  });
});

test('marks a dimension as new-dimension when missing in base but present in current', () => {
  const result = diffDimensions(
    { dimensions: {} },
    { dimensions: { score: 10 } }
  );
  assert.deepEqual(result, {
    rows: [{ name: 'score', before: null, after: 10, delta: null, state: 'new-dimension' }],
    totals: { before: 0, after: 0, regressed: 0, vanished: 0, improved: 0 },
  });
});

test('extracts numeric value from object with after property', () => {
  const result = diffDimensions(
    { dimensions: { score: { after: 10 } } },
    { dimensions: { score: { after: 12 } } }
  );
  assert.deepEqual(result, {
    rows: [{ name: 'score', before: 10, after: 12, delta: 2, state: 'improved' }],
    totals: { before: 10, after: 12, regressed: 0, vanished: 0, improved: 1 },
  });
});

test('extracts numeric value from object with score property when after is missing', () => {
  const result = diffDimensions(
    { dimensions: { score: { score: 10 } } },
    { dimensions: { score: { score: 8 } } }
  );
  assert.deepEqual(result, {
    rows: [{ name: 'score', before: 10, after: 8, delta: -2, state: 'REGRESSED' }],
    totals: { before: 10, after: 8, regressed: 1, vanished: 0, improved: 0 },
  });
});

test('throws an error when dimension value has unrecognized shape', () => {
  assert.throws(
    () => diffDimensions(
      { dimensions: { score: 'bad' } },
      { dimensions: { score: 10 } }
    ),
    /dimension "score" has unrecognized shape \(string\)/
  );
});

test('computes totals only from comparable dimensions, excluding vanished and new-dimension', () => {
  const result = diffDimensions(
    { dimensions: { a: 10, b: 20 } },
    { dimensions: { a: 15, c: 5 } }
  );
  assert.deepEqual(result, {
    rows: [
      { name: 'a', before: 10, after: 15, delta: 5, state: 'improved' },
      { name: 'b', before: 20, after: null, delta: null, state: 'vanished' },
      { name: 'c', before: null, after: 5, delta: null, state: 'new-dimension' },
    ],
    totals: { before: 10, after: 15, regressed: 0, vanished: 1, improved: 1 },
  });
});
