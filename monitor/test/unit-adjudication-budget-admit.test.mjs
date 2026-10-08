// Computes how many new items fit in the remaining shared adjudication budget (monitor/adjudication-budget.mjs admit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admit } from '../adjudication-budget.mjs';

test('admits all items when budget is sufficient', () => {
  const result = admit(2, { remainingMinutes: 10, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 2,
    defer: 0,
    why: 'admitted 2 within budget',
  });
});

test('defers items when budget is insufficient', () => {
  const result = admit(3, { remainingMinutes: 10, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 2,
    defer: 1,
    why: 'budget spent: 1 of 3 deferred \u2014 the shared human queue is full (10 min left)',
  });
});

test('admits zero items when budget is zero', () => {
  const result = admit(5, { remainingMinutes: 0, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 0,
    defer: 5,
    why: 'budget spent: 5 of 5 deferred \u2014 the shared human queue is full (0 min left)',
  });
});

test('handles exact budget boundary where all items fit', () => {
  const result = admit(2, { remainingMinutes: 10, minutesPerItem: 5 });
  assert.equal(result.admit, 2);
  assert.equal(result.defer, 0);
  assert.equal(result.why, 'admitted 2 within budget');
});

test('handles boundary just below budget capacity', () => {
  const result = admit(3, { remainingMinutes: 9, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 1,
    defer: 2,
    why: 'budget spent: 2 of 3 deferred \u2014 the shared human queue is full (9 min left)',
  });
});

test('handles boundary just above budget capacity', () => {
  const result = admit(3, { remainingMinutes: 11, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 2,
    defer: 1,
    why: 'budget spent: 1 of 3 deferred \u2014 the shared human queue is full (11 min left)',
  });
});

test('uses default minutesPerItem when not provided', () => {
  const result = admit(3, { remainingMinutes: 12 });
  assert.deepEqual(result, {
    admit: 2,
    defer: 1,
    why: 'budget spent: 1 of 3 deferred \u2014 the shared human queue is full (12 min left)',
  });
});

test('handles zero new items', () => {
  const result = admit(0, { remainingMinutes: 10, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 0,
    defer: 0,
    why: 'admitted 0 within budget',
  });
});

test('handles negative new items by treating as zero', () => {
  const result = admit(-5, { remainingMinutes: 10, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 0,
    defer: 0,
    why: 'admitted 0 within budget',
  });
});

test('handles fractional minutes that floor down', () => {
  const result = admit(3, { remainingMinutes: 9.9, minutesPerItem: 5 });
  assert.deepEqual(result, {
    admit: 1,
    defer: 2,
    why: 'budget spent: 2 of 3 deferred \u2014 the shared human queue is full (9.9 min left)',
  });
});
