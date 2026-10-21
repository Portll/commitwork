// Computes adjudication budget spent, remaining, and saturation (monitor/adjudication-budget.mjs budgetState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetState } from '../adjudication-budget.mjs';

test('returns zero spent and full remaining when pending is zero', () => {
  const result = budgetState({ pending: 0 });
  assert.deepEqual(result, {
    spentMinutes: 0,
    remainingMinutes: 600,
    saturated: false,
    capacityMinutes: 600,
    minutesPerItem: 5
  });
});

test('calculates spent minutes as pending times minutesPerItem', () => {
  const result = budgetState({ pending: 10 });
  assert.deepEqual(result, {
    spentMinutes: 50,
    remainingMinutes: 550,
    saturated: false,
    capacityMinutes: 600,
    minutesPerItem: 5
  });
});

test('treats negative pending as zero spent minutes', () => {
  const result = budgetState({ pending: -5 });
  assert.deepEqual(result, {
    spentMinutes: 0,
    remainingMinutes: 600,
    saturated: false,
    capacityMinutes: 600,
    minutesPerItem: 5
  });
});

test('marks saturated when spent minutes equals capacity', () => {
  const result = budgetState({ pending: 120 });
  assert.deepEqual(result, {
    spentMinutes: 600,
    remainingMinutes: 0,
    saturated: true,
    capacityMinutes: 600,
    minutesPerItem: 5
  });
});

test('marks saturated when spent minutes exceeds capacity', () => {
  const result = budgetState({ pending: 121 });
  assert.deepEqual(result, {
    spentMinutes: 605,
    remainingMinutes: 0,
    saturated: true,
    capacityMinutes: 600,
    minutesPerItem: 5
  });
});

test('uses custom capacityMinutes and minutesPerItem when provided', () => {
  const result = budgetState({ pending: 10, capacityMinutes: 100, minutesPerItem: 10 });
  assert.deepEqual(result, {
    spentMinutes: 100,
    remainingMinutes: 0,
    saturated: true,
    capacityMinutes: 100,
    minutesPerItem: 10
  });
});

test('returns zero remaining when capacity is less than spent', () => {
  const result = budgetState({ pending: 20, capacityMinutes: 50, minutesPerItem: 5 });
  assert.deepEqual(result, {
    spentMinutes: 100,
    remainingMinutes: 0,
    saturated: true,
    capacityMinutes: 50,
    minutesPerItem: 5
  });
});

test('handles empty object input with defaults', () => {
  const result = budgetState({});
  assert.deepEqual(result, {
    spentMinutes: 0,
    remainingMinutes: 600,
    saturated: false,
    capacityMinutes: 600,
    minutesPerItem: 5
  });
});
