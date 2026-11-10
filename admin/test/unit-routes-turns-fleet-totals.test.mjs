// Aggregates per-session token and outcome totals into fleet-wide stats (admin/routes/turns.mjs fleetTotals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetTotals } from '../routes/turns.mjs';

test('returns zeroed totals and null ratios for an empty row list', () => {
  const out = fleetTotals([]);
  assert.deepEqual(out, {
    sessions: 0,
    sessionsUnreadable: 0,
    turns: 0,
    output: null,
    cacheHitRatio: null,
    outputPerTurn: null,
    blocked: 0,
    undetermined: 0,
  });
});

test('counts unreadable rows as sessionsUnreadable when tokens is missing', () => {
  const rows = [
    { tokens: { output: 10, cacheRead: 5, input: 2, cacheCreation: 1 }, turns: 3, outcome: 'pass' },
    { turns: 1, outcome: 'block' },
    { turns: 2, outcome: 'unknown' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.sessions, 1);
  assert.equal(out.sessionsUnreadable, 2);
  assert.equal(out.turns, 3);
  assert.equal(out.blocked, 1);
  assert.equal(out.undetermined, 1);
});

test('sums token fields across readable rows and skips null fields', () => {
  const rows = [
    { tokens: { output: 100, cacheRead: 40, input: 10, cacheCreation: 5 }, turns: 2, outcome: 'pass' },
    { tokens: { output: 50, cacheRead: null, input: 20, cacheCreation: 15 }, turns: 4, outcome: 'pass' },
    { tokens: { output: null, cacheRead: 30, input: null, cacheCreation: 10 }, turns: 1, outcome: 'block' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.output, 150);
  assert.equal(out.cacheHitRatio, 0.5384615384615384);
  assert.equal(out.outputPerTurn, 150 / 7);
});

test('returns null for a token field when every readable row has it as null', () => {
  const rows = [
    { tokens: { output: null, cacheRead: 10, input: 5, cacheCreation: 2 }, turns: 1, outcome: 'pass' },
    { tokens: { output: null, cacheRead: 20, input: 8, cacheCreation: 4 }, turns: 2, outcome: 'pass' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.output, null);
  assert.equal(out.cacheHitRatio, 0.6122448979591837);
  assert.equal(out.outputPerTurn, null);
});

test('computes charged as the sum of non-null cacheRead, input, and cacheCreation', () => {
  const rows = [
    { tokens: { output: 10, cacheRead: null, input: 7, cacheCreation: 3 }, turns: 1, outcome: 'pass' },
    { tokens: { output: 20, cacheRead: 12, input: null, cacheCreation: 1 }, turns: 2, outcome: 'pass' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.cacheHitRatio, 12 / 23);
});

test('returns null charged and null cacheHitRatio when all three charge fields are null', () => {
  const rows = [
    { tokens: { output: 5, cacheRead: null, input: null, cacheCreation: null }, turns: 1, outcome: 'pass' },
    { tokens: { output: 8, cacheRead: null, input: null, cacheCreation: null }, turns: 2, outcome: 'pass' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.cacheHitRatio, null);
  assert.equal(out.outputPerTurn, 13 / 3);
});

test('returns null outputPerTurn when total turns is zero', () => {
  const rows = [
    { tokens: { output: 42, cacheRead: 1, input: 1, cacheCreation: 1 }, turns: 0, outcome: 'pass' },
    { tokens: { output: 8, cacheRead: 2, input: 3, cacheCreation: 1 }, turns: 0, outcome: 'pass' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.turns, 0);
  assert.equal(out.outputPerTurn, null);
  assert.equal(out.cacheHitRatio, 0.3333333333333333);
});

test('treats a missing turns field as zero in the turn total', () => {
  const rows = [
    { tokens: { output: 10, cacheRead: 1, input: 1, cacheCreation: 1 }, outcome: 'pass' },
    { tokens: { output: 5, cacheRead: 2, input: 2, cacheCreation: 1 }, turns: 4, outcome: 'pass' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.turns, 4);
  assert.equal(out.outputPerTurn, 15 / 4);
});

test('counts only block and unknown outcomes for blocked and undetermined', () => {
  const rows = [
    { tokens: { output: 1, cacheRead: 1, input: 1, cacheCreation: 1 }, turns: 1, outcome: 'block' },
    { tokens: { output: 1, cacheRead: 1, input: 1, cacheCreation: 1 }, turns: 1, outcome: 'unknown' },
    { tokens: { output: 1, cacheRead: 1, input: 1, cacheCreation: 1 }, turns: 1, outcome: 'pass' },
    { tokens: { output: 1, cacheRead: 1, input: 1, cacheCreation: 1 }, turns: 1, outcome: 'block' },
    { tokens: { output: 1, cacheRead: 1, input: 1, cacheCreation: 1 }, turns: 1, outcome: 'unknown' },
    { tokens: { output: 1, cacheRead: 1, input: 1, cacheCreation: 1 }, turns: 1, outcome: 'other' },
  ];
  const out = fleetTotals(rows);
  assert.equal(out.blocked, 2);
  assert.equal(out.undetermined, 2);
});
