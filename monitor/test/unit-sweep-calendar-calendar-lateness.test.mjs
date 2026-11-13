// Computes lateness minutes and catch-up flag for a scheduled calendar slot (monitor/sweep-calendar.mjs calendarLateness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarLateness } from '../sweep-calendar.mjs';

// calendarLateness compares against the LOCAL wall clock, so every instant here is built from local
// parts and the expected instants are derived from the same parts. The local zone is whatever the
// host runs in; both sides shift together.
const localMs = (day, hour, minute, second = 0) => new Date(2023, 10, day, hour, minute, second).getTime();
const localIso = (day, hour, minute, second = 0) => new Date(2023, 10, day, hour, minute, second).toISOString();

test('returns null when calendar is invalid', () => {
  const r = calendarLateness({ calendar: '25:00', now: localMs(14, 10, 5) });
  assert.equal(r, null);
});

test('returns null when calendar is undefined', () => {
  const r = calendarLateness({ now: localMs(14, 10, 5) });
  assert.equal(r, null);
});

test('returns null when the calendar minute is not two digits', () => {
  const r = calendarLateness({ calendar: '9:5', now: localMs(14, 10, 5), lateAfterMin: 30 });
  assert.equal(r, null);
});

test('computes lateMin 5 and catchUp false when 5 minutes late against lateAfterMin 30', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 10, 5), lateAfterMin: 30 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(14, 10, 0),
    lateMin: 5,
    catchUp: false,
    nextStartAt: localIso(15, 10, 0),
    nextStartMs: localMs(15, 10, 0),
  });
});

test('computes catchUp true when 31 minutes late against lateAfterMin 30', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 10, 31), lateAfterMin: 30 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(14, 10, 0),
    lateMin: 31,
    catchUp: true,
    nextStartAt: localIso(15, 10, 0),
    nextStartMs: localMs(15, 10, 0),
  });
});

test('computes catchUp false when lateMin equals lateAfterMin', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 10, 30), lateAfterMin: 30 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(14, 10, 0),
    lateMin: 30,
    catchUp: false,
    nextStartAt: localIso(15, 10, 0),
    nextStartMs: localMs(15, 10, 0),
  });
});

test('computes catchUp true when lateMin exceeds lateAfterMin', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 10, 11), lateAfterMin: 10 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(14, 10, 0),
    lateMin: 11,
    catchUp: true,
    nextStartAt: localIso(15, 10, 0),
    nextStartMs: localMs(15, 10, 0),
  });
});

test('computes catchUp true when lateMin is one more than lateAfterMin', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 10, 30), lateAfterMin: 29 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(14, 10, 0),
    lateMin: 30,
    catchUp: true,
    nextStartAt: localIso(15, 10, 0),
    nextStartMs: localMs(15, 10, 0),
  });
});

test('computes nextStartAt one day after scheduled', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 11, 0), lateAfterMin: 30 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(14, 10, 0),
    lateMin: 60,
    catchUp: true,
    nextStartAt: localIso(15, 10, 0),
    nextStartMs: localMs(15, 10, 0),
  });
});

test('computes lateMin 0 when now is exactly at slot time', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 10, 0), lateAfterMin: 30 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(14, 10, 0),
    lateMin: 0,
    catchUp: false,
    nextStartAt: localIso(15, 10, 0),
    nextStartMs: localMs(15, 10, 0),
  });
});

test('computes scheduledAt as the previous day when now is one second before slot time', () => {
  const r = calendarLateness({ calendar: '10:00', now: localMs(14, 9, 59, 59), lateAfterMin: 30 });
  assert.deepEqual(r, {
    calendar: "10:00",
    scheduledAt: localIso(13, 10, 0),
    lateMin: 1440,
    catchUp: true,
    nextStartAt: localIso(14, 10, 0),
    nextStartMs: localMs(14, 10, 0),
  });
});
