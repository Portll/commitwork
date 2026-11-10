// Records a normalised offbox page entry and appends it to the page store (admin/routes/offbox.mjs recordPage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPage } from '../routes/offbox.mjs';

test('normalises a valid ok state with all fields present', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const body = {
    state: 'ok',
    at: '2024-01-01T00:00:00.000Z',
    ref: 'abc123',
    ledgerAgeHours: 1.5,
    witnessAgeHours: 2.5,
    alarms: 3,
  };
  const result = recordPage(body, { at });
  assert.equal(result.record.kind, 'offbox-page');
  assert.equal(result.record.receivedAt, at);
  assert.equal(result.record.at, '2024-01-01T00:00:00.000Z');
  assert.equal(result.record.state, 'ok');
  assert.equal(result.record.declaredState, 'ok');
  assert.equal(result.record.ref, 'abc123');
  assert.equal(result.record.ledgerAgeHours, 1.5);
  assert.equal(result.record.witnessAgeHours, 2.5);
  assert.equal(result.record.alarms, 3);
});

test('maps unrecognised state to unrecognised but preserves declaredState', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const body = { state: 'weird-state', at: '2024-01-01T00:00:00.000Z' };
  const result = recordPage(body, { at });
  assert.equal(result.record.state, 'unrecognised');
  assert.equal(result.record.declaredState, 'weird-state');
});

test('truncates state longer than 40 chars to unrecognised', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const longState = 'x'.repeat(41);
  const body = { state: longState };
  const result = recordPage(body, { at });
  assert.equal(result.record.state, 'unrecognised');
  assert.equal(result.record.declaredState, 'x'.repeat(40));
});

test('keeps state exactly 40 chars if it is a known state', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const state = 'ok' + 'x'.repeat(38);
  const body = { state };
  const result = recordPage(body, { at });
  assert.equal(result.record.state, 'unrecognised');
  assert.equal(result.record.declaredState, state);
});

test('handles null body by producing empty normalised record', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const result = recordPage(null, { at });
  assert.equal(result.record.kind, 'offbox-page');
  assert.equal(result.record.receivedAt, at);
  assert.equal(result.record.at, null);
  assert.equal(result.record.state, 'unrecognised');
  assert.equal(result.record.declaredState, null);
  assert.equal(result.record.ref, null);
  assert.equal(result.record.ledgerAgeHours, null);
  assert.equal(result.record.witnessAgeHours, null);
  assert.equal(result.record.alarms, 0);
});

test('handles array body by treating it as empty object', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const result = recordPage([1, 2, 3], { at });
  assert.equal(result.record.state, 'unrecognised');
  assert.equal(result.record.alarms, 0);
});

test('truncates ref longer than 64 chars', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const longRef = 'r'.repeat(65);
  const body = { state: 'ok', ref: longRef };
  const result = recordPage(body, { at });
  assert.equal(result.record.ref, 'r'.repeat(64));
});

test('keeps ref exactly 64 chars', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const ref = 'r'.repeat(64);
  const body = { state: 'ok', ref };
  const result = recordPage(body, { at });
  assert.equal(result.record.ref, ref);
});

test('converts non-finite numbers to null for age fields', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const body = { state: 'ok', ledgerAgeHours: Infinity, witnessAgeHours: NaN };
  const result = recordPage(body, { at });
  assert.equal(result.record.ledgerAgeHours, null);
  assert.equal(result.record.witnessAgeHours, null);
});

test('defaults alarms to 0 when missing or non-numeric', () => {
  const at = '2024-01-01T00:00:00.000Z';
  const result1 = recordPage({ state: 'ok' }, { at });
  assert.equal(result1.record.alarms, 0);
  const result2 = recordPage({ state: 'ok', alarms: 'five' }, { at });
  assert.equal(result2.record.alarms, 0);
  const result3 = recordPage({ state: 'ok', alarms: 7 }, { at });
  assert.equal(result3.record.alarms, 7);
});
