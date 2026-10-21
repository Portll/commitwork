// monitor/test/unknown-rate.test.mjs — the fleet unknown-rate lens.
//
// The lens's one job is composing three tested primitives (unknownReasonOf, denominator.claim,
// classifyFreshness) at slice scope without inventing arithmetic of its own. What is asserted
// here is therefore the composition: the DETERMINATION_FIELDS trap (a falsy legacy flag is NOT an
// unknown), the freshness gate (a stale slice's cells land in undetermined, never observed), the
// conservation witness, and byte-determinism.
import test from 'node:test';
import assert from 'node:assert/strict';

import { unknownRateFor, fleetUnknownRate } from '../unknown-rate.mjs';

const NOW = Date.parse('2026-08-26T12:00:00.000Z');
const FRESH_SLICE = 'sweep-20260826100000';   // 2h before NOW — fresh
const DEAD_SLICE = 'sweep-20260820100000';    // 6 days before NOW — expired

const rollup = (sliceId, repos) => ({ sliceId, generated: '2026-08-26T11:59:00.000Z', repos });

const MIXED = [
  { repo: 'a', scanners: {
    secrets: { ran: true, total: 2 },                                   // determined
    sastSemgrep: { ran: true, nosrc: true },                            // legacy flag → no-subject
    lintRust: { ran: true, unparseable: true },                         // legacy flag → unparseable
    cspm: { ran: true, unknown: true, unknownReason: 'tool-failed' },   // new-style
  } },
  { repo: 'b', scanners: {
    secrets: { ran: true, total: 0, nosrc: false },                     // the trap: falsy legacy flag is a RESULT
  } },
  { repo: 'c' },                                                        // no scanners at all — zero cells
];

test('mixed-vintage blocks tally by reason, and a falsy legacy flag is never an unknown', () => {
  const a = unknownRateFor('fx', rollup(FRESH_SLICE, MIXED), NOW);
  assert.equal(a.cells, 5);
  assert.equal(a.unknown, 3);
  assert.deepEqual(a.byReason, { 'no-subject': 1, 'tool-failed': 1, unparseable: 1 });
  assert.equal(a.byCategory.secrets.unknown, 0, 'nosrc:false is a producer saying "not this" — counting it would fabricate a grey over a real result');
  assert.equal(a.conservation.ok, true);
});

test('a fresh area lends its cells to observed; the claim carries the full denominator', () => {
  const a = unknownRateFor('fx', rollup(FRESH_SLICE, MIXED), NOW);
  assert.equal(a.freshness.state, 'fresh');
  assert.equal(a.claim.count, 3);
  assert.equal(a.claim.observed, 5);
  assert.equal(a.claim.population, 5);
  assert.equal(a.claim.complete, true);
});

test('a dead slice contributes undetermined, never observed — a rate over a dead sweep is not a rate', () => {
  const a = unknownRateFor('fx', rollup(DEAD_SLICE, MIXED), NOW);
  assert.notEqual(a.freshness.state, 'fresh');
  assert.equal(a.claim.count, 0, 'no unknown-count is asserted from a dead slice');
  assert.equal(a.claim.observed, 0);
  assert.equal(a.claim.undetermined, 5, 'the cells still exist and are declared unanswerable, not dropped');
  assert.equal(a.claim.population, 5);
});

test('the fleet combine keeps per-area denominators honest', () => {
  const fresh = unknownRateFor('a1', rollup(FRESH_SLICE, MIXED), NOW);
  const dead = unknownRateFor('a2', rollup(DEAD_SLICE, MIXED), NOW);
  const { fleet, byReason } = fleetUnknownRate([fresh, dead]);
  assert.equal(fleet.count, 3);
  assert.equal(fleet.observed, 5, 'only the fresh area was determinable');
  assert.equal(fleet.population, 10);
  assert.equal(fleet.undetermined, 5);
  assert.equal(fleet.complete, false, 'half the fleet is a dead slice — the number says so');
  assert.deepEqual(byReason, { 'no-subject': 2, 'tool-failed': 2, unparseable: 2 },
    'reason tallies aggregate from EVERY area, dead ones included — the freshness gate bounds the CLAIM, not the description');
});

test('a slice with no parseable scan stamp is unknown-freshness and treated like a dead one', () => {
  const a = unknownRateFor('fx', rollup('adhoc-x', MIXED), NOW);
  assert.equal(a.freshness.state, 'unknown');
  assert.equal(a.claim.observed, 0);
  assert.equal(a.claim.undetermined, 5);
});

test('byte-determinism: same rollup, same now, identical JSON', () => {
  const one = JSON.stringify(unknownRateFor('fx', rollup(FRESH_SLICE, MIXED), NOW));
  const two = JSON.stringify(unknownRateFor('fx', rollup(FRESH_SLICE, MIXED), NOW));
  assert.equal(one, two);
});

test('worst[] is bounded and the truncation is recorded, never silent', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    repo: `r${String(i).padStart(2, '0')}`,
    scanners: { secrets: { ran: true, noscan: true } },
  }));
  const a = unknownRateFor('fx', rollup(FRESH_SLICE, many), NOW);
  assert.equal(a.worst.length, 50);
  assert.equal(a.worstTruncated, 10);
  assert.equal(a.unknown, 60, 'the COUNT is untouched by the drill-down cap');
});
