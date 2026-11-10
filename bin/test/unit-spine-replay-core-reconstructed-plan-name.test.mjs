// Human-readable label for a reconstructed plan (bin/spine-replay-core.mjs reconstructedPlanName).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructedPlanName } from '../spine-replay-core.mjs';

test('returns a label with no timestamps when first is null', () => {
  const ev = { first: null, last: '2024-01-01T00:00:00Z', rows: 3 };
  const r = reconstructedPlanName(ev, { plan: 'P', createdAtWitnessed: true });
  assert.equal(r, "P [RECONSTRUCTED \u2014 original unrecoverable; 3 ledger row(s) no timestamps]");
});

test('returns a label with a single day span when first and last share a day', () => {
  const ev = { first: '2024-01-01T00:00:00Z', last: '2024-01-01T23:59:59Z', rows: 1 };
  const r = reconstructedPlanName(ev, { plan: 'P', createdAtWitnessed: true });
  assert.equal(r, "P [RECONSTRUCTED \u2014 original unrecoverable; 1 ledger row(s) 2024-01-01]");
});

test('returns a label with a range span when first and last differ by day', () => {
  const ev = { first: '2024-01-01T00:00:00Z', last: '2024-01-02T00:00:00Z', rows: 2 };
  const r = reconstructedPlanName(ev, { plan: 'P', createdAtWitnessed: true });
  assert.equal(r, "P [RECONSTRUCTED \u2014 original unrecoverable; 2 ledger row(s) 2024-01-01..2024-01-02]");
});

test('appends a creation-not-witnessed note when createdAtWitnessed is false', () => {
  const ev = { first: null, last: '2024-01-01T00:00:00Z', rows: 5 };
  const r = reconstructedPlanName(ev, { plan: 'Q', createdAtWitnessed: false });
  assert.equal(r, "Q [RECONSTRUCTED \u2014 original unrecoverable; 5 ledger row(s) no timestamps; creation not witnessed]");
});

test('omits the witness note when createdAtWitnessed is true and days differ', () => {
  const ev = { first: '2024-03-10T12:00:00Z', last: '2024-03-11T12:00:00Z', rows: 7 };
  const r = reconstructedPlanName(ev, { plan: 'R', createdAtWitnessed: true });
  assert.equal(r, "R [RECONSTRUCTED \u2014 original unrecoverable; 7 ledger row(s) 2024-03-10..2024-03-11]");
});

test('uses a range span when first and last are one day apart', () => {
  const ev = { first: '2024-06-01T00:00:00Z', last: '2024-06-02T00:00:00Z', rows: 10 };
  const r = reconstructedPlanName(ev, { plan: 'S', createdAtWitnessed: false });
  assert.equal(r, "S [RECONSTRUCTED \u2014 original unrecoverable; 10 ledger row(s) 2024-06-01..2024-06-02; creation not witnessed]");
});

test('uses a single day span when first and last are on the same day', () => {
  const ev = { first: '2024-06-01T00:00:00Z', last: '2024-06-01T00:00:01Z', rows: 10 };
  const r = reconstructedPlanName(ev, { plan: 'S', createdAtWitnessed: false });
  assert.equal(r, "S [RECONSTRUCTED \u2014 original unrecoverable; 10 ledger row(s) 2024-06-01; creation not witnessed]");
});
