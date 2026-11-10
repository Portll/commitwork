// Computes the offbox-watch page payload (bin/offbox-watch-check.mjs pagePayload).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagePayload } from '../offbox-watch-check.mjs';

test('computes ref with ledgerTip present', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: 'abc123', ledgerAgeH: 1, witnessAgeH: 2, alarms: ['a', 'b'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "9f22f10ae97605db", state: "ok", ledgerAgeHours: 1, witnessAgeHours: 2, alarms: 2, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip null', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: null, ledgerAgeH: 1, witnessAgeH: 2, alarms: [] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "b40c4d77bd92b455", state: "ok", ledgerAgeHours: 1, witnessAgeHours: 2, alarms: 0, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip undefined', () => {
  const r = pagePayload({ state: 'warn', ledgerAgeH: 0, witnessAgeH: 0, alarms: null }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "717497455c27c382", state: "warn", ledgerAgeHours: 0, witnessAgeHours: 0, alarms: 0, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip empty string', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: '', ledgerAgeH: 5, witnessAgeH: 5, alarms: ['x'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "b40c4d77bd92b455", state: "ok", ledgerAgeHours: 5, witnessAgeHours: 5, alarms: 1, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip zero', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: 0, ledgerAgeH: 3, witnessAgeH: 3, alarms: ['a', 'b', 'c'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "b40c4d77bd92b455", state: "ok", ledgerAgeHours: 3, witnessAgeHours: 3, alarms: 3, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip false', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: false, ledgerAgeH: 2, witnessAgeH: 2, alarms: ['a'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "b40c4d77bd92b455", state: "ok", ledgerAgeHours: 2, witnessAgeHours: 2, alarms: 1, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip NaN', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: NaN, ledgerAgeH: 1, witnessAgeH: 1, alarms: ['a', 'b'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "b40c4d77bd92b455", state: "ok", ledgerAgeHours: 1, witnessAgeHours: 1, alarms: 2, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip object', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: { id: 1 }, ledgerAgeH: 4, witnessAgeH: 4, alarms: ['a', 'b', 'c', 'd'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "6eea85b83a496eab", state: "ok", ledgerAgeHours: 4, witnessAgeHours: 4, alarms: 4, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip array', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: [1, 2], ledgerAgeH: 6, witnessAgeH: 6, alarms: ['a', 'b', 'c', 'd', 'e'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "4f8b69089ce0a7e7", state: "ok", ledgerAgeHours: 6, witnessAgeHours: 6, alarms: 5, at: "2025-01-01T00:00:00.000Z" });
});

test('computes ref with ledgerTip Infinity', () => {
  const r = pagePayload({ state: 'ok', ledgerTip: Infinity, ledgerAgeH: 7, witnessAgeH: 7, alarms: ['a', 'b', 'c', 'd', 'e', 'f'] }, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(r, { event: "offbox-watch", ref: "8cd929c7d8923b27", state: "ok", ledgerAgeHours: 7, witnessAgeHours: 7, alarms: 6, at: "2025-01-01T00:00:00.000Z" });
});
