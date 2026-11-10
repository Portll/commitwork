// Projects a gate record to the served allowlist (bin/lib/verdict-journal-core.mjs redactGateRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactGateRecord } from '../lib/verdict-journal-core.mjs';

test('returns null for null input', () => {
  assert.deepEqual(redactGateRecord(null), null);
});

test('returns null for non-object input', () => {
  assert.deepEqual(redactGateRecord(42), null);
});

test('returns empty object for empty record', () => {
  assert.deepEqual(redactGateRecord({}), {});
});

test('copies served fields and omits undefined ones', () => {
  const r = { v: 1, gate: 'g', verdict: 'pass', exit: 0, at: 't', suppressed: false, silenced: true, fail: 2, pass: 3, floorRaised: false, unknownMetrics: 1, readCount: 5 };
  assert.deepEqual(redactGateRecord(r), { v: 1, gate: "g", verdict: "pass", exit: 0, at: "t", suppressed: false, silenced: true, fail: 2, pass: 3, floorRaised: false, unknownMetrics: 1, readCount: 5 });
});

test('copies numeric sub-objects with defined fields', () => {
  const r = { baseline: { fail: 1, pass: 2, conflicts: 3, unreviewed: 4, drifted: 5, at: 'x' }, metrics: { conflicts: 1, unreviewed: 2, drifted: 3 }, tallies: { green: 1, orange: 2, grey: 3, generated: 4, archived: 5, cycle: 6 } };
  assert.deepEqual(redactGateRecord(r), { baseline: { fail: 1, pass: 2, conflicts: 3, unreviewed: 4, drifted: 5, at: "x" }, metrics: { conflicts: 1, unreviewed: 2, drifted: 3 }, tallies: { green: 1, orange: 2, grey: 3, generated: 4, archived: 5, cycle: 6 } });
});

test('omits numeric sub-objects when not objects', () => {
  const r = { baseline: 'not-an-object', metrics: 123, tallies: null };
  assert.deepEqual(redactGateRecord(r), {});
});

test('converts attribution arrays to lengths and numbers to values', () => {
  const r = { attribution: { mine: ['a', 'b'], theirs: 3, unknown: 'str' } };
  assert.deepEqual(redactGateRecord(r), { attribution: { mine: 2, theirs: 3, unknown: 0 } });
});

test('omits attribution when not an object', () => {
  const r = { attribution: 'not-an-object' };
  assert.deepEqual(redactGateRecord(r), {});
});

test('handles attribution with all numbers', () => {
  const r = { attribution: { mine: 1, theirs: 2, unknown: 3 } };
  assert.deepEqual(redactGateRecord(r), { attribution: { mine: 1, theirs: 2, unknown: 3 } });
});

test('handles attribution with all arrays', () => {
  const r = { attribution: { mine: Array.from({ length: 5 }, (_, i) => i), theirs: Array.from({ length: 3 }, (_, i) => i), unknown: Array.from({ length: 2 }, (_, i) => i) } };
  assert.deepEqual(redactGateRecord(r), { attribution: { mine: 5, theirs: 3, unknown: 2 } });
});
