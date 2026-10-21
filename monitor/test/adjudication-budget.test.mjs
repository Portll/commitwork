// adjudication-budget.test.mjs — G1: the shared human queue is priced in minutes; over budget defers
// loudly; an undetermined row has an age and a stale one is flagged (never silently equal to fresh).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { budgetState, admit, ageDays, isStale } from '../adjudication-budget.mjs';

describe('adjudication budget', () => {
  test('spent = pending x minutes/item; saturated when spent >= capacity', () => {
    const s = budgetState({ pending: 100, capacityMinutes: 600, minutesPerItem: 5 });
    assert.equal(s.spentMinutes, 500);
    assert.equal(s.remainingMinutes, 100);
    assert.equal(s.saturated, false);
    assert.equal(budgetState({ pending: 120, capacityMinutes: 600, minutesPerItem: 5 }).saturated, true);
  });

  test('admit fills to the remaining budget and DEFERS the rest, loudly', () => {
    const s = budgetState({ pending: 100, capacityMinutes: 600, minutesPerItem: 5 }); // 100 min left = 20 items
    const r = admit(50, s);
    assert.equal(r.admit, 20);
    assert.equal(r.defer, 30);
    assert.match(r.why, /deferred/);
  });

  test('a saturated budget admits nothing — the whole batch defers', () => {
    const s = budgetState({ pending: 200, capacityMinutes: 600, minutesPerItem: 5 });
    const r = admit(10, s);
    assert.equal(r.admit, 0);
    assert.equal(r.defer, 10);
  });

  test('age honours CW_NOW; a stale row is flagged, an unknown ts is null (never false)', () => {
    const prev = process.env.CW_NOW; process.env.CW_NOW = '2026-08-27T00:00:00.000Z';
    try {
      assert.equal(Math.round(ageDays('2026-08-20T00:00:00.000Z')), 7);
      assert.equal(isStale('2026-06-01T00:00:00.000Z'), true);   // > 30 days
      assert.equal(isStale('2026-08-25T00:00:00.000Z'), false);  // < 30 days
      assert.equal(isStale('not-a-date'), null);                 // unknown, never a reassuring false
    } finally { if (prev === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prev; }
  });
});
