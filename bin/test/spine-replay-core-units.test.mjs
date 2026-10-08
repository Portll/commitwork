// bin/test/spine-replay-core-units.test.mjs — case tests for reconstructedPlanName.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructedPlanName } from '../spine-replay-core.mjs';

test('reconstructedPlanName: no timestamps, creation witnessed', () => {
  const ev = { rows: 3, first: null, last: null, sessions: [], kinds: {}, viaRows: 0, trees: {} };
  const name = reconstructedPlanName(ev, { plan: 'p1', createdAtWitnessed: true });
  assert.equal(name, 'p1 [RECONSTRUCTED — original unrecoverable; 3 ledger row(s) no timestamps]');
});

test('reconstructedPlanName: no timestamps, creation not witnessed', () => {
  const ev = { rows: 1, first: null, last: null, sessions: [], kinds: {}, viaRows: 0, trees: {} };
  const name = reconstructedPlanName(ev, { plan: 'p2', createdAtWitnessed: false });
  assert.equal(name, 'p2 [RECONSTRUCTED — original unrecoverable; 1 ledger row(s) no timestamps; creation not witnessed]');
});

test('reconstructedPlanName: same-day span, creation witnessed', () => {
  const ev = { rows: 5, first: '2024-01-15T10:00:00.000Z', last: '2024-01-15T12:30:00.000Z', sessions: [], kinds: {}, viaRows: 0, trees: {} };
  const name = reconstructedPlanName(ev, { plan: 'p3', createdAtWitnessed: true });
  assert.equal(name, 'p3 [RECONSTRUCTED — original unrecoverable; 5 ledger row(s) 2024-01-15]');
});

test('reconstructedPlanName: multi-day span, creation not witnessed', () => {
  const ev = { rows: 2, first: '2024-01-15T10:00:00.000Z', last: '2024-01-20T08:00:00.000Z', sessions: [], kinds: {}, viaRows: 0, trees: {} };
  const name = reconstructedPlanName(ev, { plan: 'p4', createdAtWitnessed: false });
  assert.equal(name, 'p4 [RECONSTRUCTED — original unrecoverable; 2 ledger row(s) 2024-01-15..2024-01-20; creation not witnessed]');
});

test('reconstructedPlanName: zero rows, no timestamps', () => {
  const ev = { rows: 0, first: null, last: null, sessions: [], kinds: {}, viaRows: 0, trees: {} };
  const name = reconstructedPlanName(ev, { plan: 'p5', createdAtWitnessed: true });
  assert.equal(name, 'p5 [RECONSTRUCTED — original unrecoverable; 0 ledger row(s) no timestamps]');
});
