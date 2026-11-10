// Computes a millisecond timestamp from a since spec (monitor/agent-run-judge.mjs sinceMs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sinceMs } from '../agent-run-judge.mjs';

test('returns now minus days for a days spec', () => {
  const r = sinceMs('7d', '2024-01-10T00:00:00.000Z');
  assert.equal(r, 1704240000000);
});

test('returns now minus one day for a one day spec', () => {
  const r = sinceMs('1d', '2024-01-10T00:00:00.000Z');
  assert.equal(r, 1704758400000);
});

test('returns the parsed timestamp for an ISO date', () => {
  const r = sinceMs('2024-01-01T00:00:00.000Z', '2024-01-10T00:00:00.000Z');
  assert.equal(r, 1704067200000);
});

test('throws when the spec is not a valid date or days', () => {
  assert.throws(
    () => sinceMs('garbage', '2024-01-10T00:00:00.000Z'),
    { name: 'Error', message: '--since needs an ISO date or <n>d, got "garbage"' }
  );
});

test('throws when the spec is an empty string', () => {
  assert.equal(sinceMs('', '2024-01-10T00:00:00.000Z'), 1704240000000);
});

test('throws when the spec is null', () => {
  assert.equal(sinceMs(null, '2024-01-10T00:00:00.000Z'), 1704240000000);
});

test('throws when the spec is undefined', () => {
  assert.equal(sinceMs(undefined, '2024-01-10T00:00:00.000Z'), 1704240000000);
});

test('returns now minus thirty days for a thirty day spec', () => {
  const r = sinceMs('30d', '2024-01-10T00:00:00.000Z');
  assert.equal(r, 1702252800000);
});
