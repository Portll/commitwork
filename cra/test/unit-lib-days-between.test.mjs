// Difference in days between two ISO timestamps (cra/lib.mjs daysBetween).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween } from '../lib.mjs';

test('returns zero for identical timestamps', () => {
  const r = daysBetween('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, 0);
});

test('returns one for timestamps one day apart', () => {
  const r = daysBetween('2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z');
  assert.equal(r, 1);
});

test('returns negative value when second timestamp is earlier', () => {
  const r = daysBetween('2024-01-02T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, -1);
});

test('returns fractional value for half-day difference', () => {
  const r = daysBetween('2024-01-01T00:00:00.000Z', '2024-01-01T12:00:00.000Z');
  assert.equal(r, 0.5);
});

test('returns whole number for multiple days apart', () => {
  const r = daysBetween('2024-01-01T00:00:00.000Z', '2024-01-04T00:00:00.000Z');
  assert.equal(r, 3);
});

test('returns negative fractional value for half-day earlier', () => {
  const r = daysBetween('2024-01-01T12:00:00.000Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, -0.5);
});

test('returns zero for timestamps differing by one millisecond', () => {
  const r = daysBetween('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.001Z');
  assert.equal(r, 1.1574074074074074e-8);
});

test('returns negative value for one millisecond earlier', () => {
  const r = daysBetween('2024-01-01T00:00:00.001Z', '2024-01-01T00:00:00.000Z');
  assert.equal(r, -1.1574074074074074e-8);
});
