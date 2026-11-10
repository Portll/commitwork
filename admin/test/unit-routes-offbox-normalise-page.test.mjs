// Normalises an offbox page body into a canonical record (admin/routes/offbox.mjs normalisePage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisePage } from '../routes/offbox.mjs';

test('returns unrecognised state when body is null', () => {
  const out = normalisePage(null, 100);
  assert.deepEqual(out, {
    kind: 'offbox-page',
    receivedAt: 100,
    at: null,
    state: 'unrecognised',
    declaredState: null,
    ref: null,
    ledgerAgeHours: null,
    witnessAgeHours: null,
    alarms: 0,
  });
});

test('returns unrecognised state when body is an array', () => {
  const out = normalisePage([1, 2, 3], 200);
  assert.equal(out.state, 'unrecognised');
  assert.equal(out.declaredState, null);
  assert.equal(out.alarms, 0);
});

test('returns unrecognised state when body is a string', () => {
  const out = normalisePage('hello', 300);
  assert.equal(out.state, 'unrecognised');
  assert.equal(out.declaredState, null);
});

test('maps known state ok to ok', () => {
  const out = normalisePage({ state: 'ok', at: '2024-01-01', ref: 'r1', ledgerAgeHours: 1.5, witnessAgeHours: 2, alarms: 3 }, 400);
  assert.equal(out.state, 'ok');
  assert.equal(out.declaredState, 'ok');
  assert.equal(out.at, '2024-01-01');
  assert.equal(out.ref, 'r1');
  assert.equal(out.ledgerAgeHours, 1.5);
  assert.equal(out.witnessAgeHours, 2);
  assert.equal(out.alarms, 3);
});

test('maps unknown state string to unrecognised but preserves declaredState', () => {
  const out = normalisePage({ state: 'weird-state', at: 'x' }, 500);
  assert.equal(out.state, 'unrecognised');
  assert.equal(out.declaredState, 'weird-state');
});

test('truncates state longer than 40 chars to unrecognised', () => {
  const longState = 'a'.repeat(41);
  const out = normalisePage({ state: longState }, 600);
  assert.equal(out.state, 'unrecognised');
  assert.equal(out.declaredState, 'a'.repeat(40));
});

test('truncates at field longer than 40 chars', () => {
  const longAt = 'b'.repeat(41);
  const out = normalisePage({ state: 'ok', at: longAt }, 700);
  assert.equal(out.at, 'b'.repeat(40));
});

test('truncates ref longer than 64 chars', () => {
  const longRef = 'c'.repeat(65);
  const out = normalisePage({ state: 'ok', ref: longRef }, 800);
  assert.equal(out.ref, 'c'.repeat(64));
});

test('returns null for non-finite numeric fields', () => {
  const out = normalisePage({ state: 'ok', ledgerAgeHours: Infinity, witnessAgeHours: NaN, alarms: 'not-a-number' }, 900);
  assert.equal(out.ledgerAgeHours, null);
  assert.equal(out.witnessAgeHours, null);
  assert.equal(out.alarms, 0);
});

test('defaults alarms to 0 when missing', () => {
  const out = normalisePage({ state: 'ok' }, 1000);
  assert.equal(out.alarms, 0);
});
