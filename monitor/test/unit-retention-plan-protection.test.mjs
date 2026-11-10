// Computes which sweep batches are protected from deletion (monitor/retention.mjs planProtection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planProtection } from '../retention.mjs';

test('protects unscoped batches when area is missing', () => {
  const r = planProtection([{ name: 'sweep-20260101000000' }], { now: 1767225600000 });
  assert.deepEqual(r, { protect: new Set(["sweep-20260101000000"]), why: new Map([["sweep-20260101000000", "among the newest 3 of global"]]), byArea: new Map([["(unscoped)", { policy: { area: null, keepFullSweeps: 3, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null }, total: 1, protected: 1 }]]) });
});

test('protects the newest batch when keepFullSweeps is 1', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000' },
      { area: 'a', name: 'sweep-20260102000000' },
    ],
    { globalKeep: 1, now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260102000000"]), why: new Map([["sweep-20260102000000", "among the newest 1 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 1, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null }, total: 2, protected: 1 }]]) });
});

test('protects batches inside the keepDays floor', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000' },
      { area: 'a', name: 'sweep-20260102000000' },
    ],
    { reg: { retention: { keepDays: 1 } }, now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260101000000", "sweep-20260102000000"]), why: new Map([["sweep-20260101000000", "among the newest 3 of global"], ["sweep-20260102000000", "among the newest 3 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 3, keepDays: 1, keepFrom: "global", keepDaysFrom: "global", note: null }, total: 2, protected: 2 }]]) });
});

test('protects batches exactly at the keepDays floor boundary', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000' },
      { area: 'a', name: 'sweep-20260102000000' },
    ],
    { reg: { retention: { keepDays: 1 } }, now: 1767312000000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260101000000", "sweep-20260102000000"]), why: new Map([["sweep-20260101000000", "among the newest 3 of global"], ["sweep-20260102000000", "among the newest 3 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 3, keepDays: 1, keepFrom: "global", keepDaysFrom: "global", note: null }, total: 2, protected: 2 }]]) });
});

test('protects batches with unparseable stamps', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000' },
      { area: 'a', name: 'sweep-20261399000000' },
    ],
    { now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20261399000000", "sweep-20260101000000"]), why: new Map([["sweep-20261399000000", "age unreadable from its name \u2014 protected rather than assumed old"], ["sweep-20260101000000", "among the newest 3 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 3, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null }, total: 2, protected: 2 }]]) });
});

test('protects batches with identical timestamps using name tiebreak', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000-b' },
      { area: 'a', name: 'sweep-20260101000000-a' },
    ],
    { globalKeep: 1, now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260101000000-b"]), why: new Map([["sweep-20260101000000-b", "among the newest 1 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 1, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null }, total: 2, protected: 1 }]]) });
});

test('protects batches with identical timestamps using name tiebreak reversed', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000-a' },
      { area: 'a', name: 'sweep-20260101000000-b' },
    ],
    { globalKeep: 1, now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260101000000-b"]), why: new Map([["sweep-20260101000000-b", "among the newest 1 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 1, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null }, total: 2, protected: 1 }]]) });
});

test('protects batches when keepFullSweeps is 2', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000' },
      { area: 'a', name: 'sweep-20260102000000' },
      { area: 'a', name: 'sweep-20260103000000' },
    ],
    { globalKeep: 2, now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260102000000", "sweep-20260103000000"]), why: new Map([["sweep-20260102000000", "among the newest 2 of global"], ["sweep-20260103000000", "among the newest 2 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 2, keepDays: null, keepFrom: "global", keepDaysFrom: null, note: null }, total: 3, protected: 2 }]]) });
});

test('protects batches with area-specific retention', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000' },
      { area: 'a', name: 'sweep-20260102000000' },
    ],
    { reg: { areas: [{ slug: 'a', retention: { keepFullSweeps: 1 } }] }, now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260102000000"]), why: new Map([["sweep-20260102000000", "among the newest 1 of area 'a'"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 1, keepDays: null, keepFrom: "area 'a'", keepDaysFrom: null, note: null }, total: 2, protected: 1 }]]) });
});

test('protects batches with global keepDays', () => {
  const r = planProtection(
    [
      { area: 'a', name: 'sweep-20260101000000' },
      { area: 'a', name: 'sweep-20260102000000' },
    ],
    { reg: { retention: { keepDays: 1 } }, now: 1767225600000 }
  );
  assert.deepEqual(r, { protect: new Set(["sweep-20260101000000", "sweep-20260102000000"]), why: new Map([["sweep-20260101000000", "among the newest 3 of global"], ["sweep-20260102000000", "among the newest 3 of global"]]), byArea: new Map([["a", { policy: { area: "a", keepFullSweeps: 3, keepDays: 1, keepFrom: "global", keepDaysFrom: "global", note: null }, total: 2, protected: 2 }]]) });
});
