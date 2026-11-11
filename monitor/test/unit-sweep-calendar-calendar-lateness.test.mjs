// Computes lateness minutes and catch-up flag for a scheduled calendar slot (monitor/sweep-calendar.mjs calendarLateness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarLateness } from '../sweep-calendar.mjs';

// A calendar slot is the machine's LOCAL wall-clock time (launchd StartCalendarInterval), so every
// expected instant below depends on the zone. Pinned to a half-hour offset on purpose: under UTC a
// calendarLateness that wrongly read the slot as UTC would pass unnoticed.
process.env.TZ = 'Australia/Adelaide';

test('returns null when calendar is invalid', () => {
  const r = calendarLateness({ calendar: '25:00', now: 1700000000000 });
  assert.equal(r, null);
});

test('returns null when calendar is undefined', () => {
  const r = calendarLateness({ now: 1700000000000 });
  assert.equal(r, null);
});

test('computes lateMin and catchUp false when just past deadline', () => {
  const r = calendarLateness({ calendar: '10:00', now: 1700000000000, lateAfterMin: 30 });
  assert.deepEqual(r, { calendar: "10:00", scheduledAt: "2023-11-13T23:30:00.000Z", lateMin: 1363, catchUp: true, nextStartAt: "2023-11-14T23:30:00.000Z", nextStartMs: 1700004600000 });
});

test('computes catchUp true when lateMin exceeds lateAfterMin', () => {
  const r = calendarLateness({ calendar: '10:00', now: 1700000000000, lateAfterMin: 10 });
  assert.deepEqual(r, { calendar: "10:00", scheduledAt: "2023-11-13T23:30:00.000Z", lateMin: 1363, catchUp: true, nextStartAt: "2023-11-14T23:30:00.000Z", nextStartMs: 1700004600000 });
});

test('computes catchUp false when lateMin equals lateAfterMin', () => {
  const r = calendarLateness({ calendar: '10:00', now: 1700000000000, lateAfterMin: 30 });
  assert.deepEqual(r, { calendar: "10:00", scheduledAt: "2023-11-13T23:30:00.000Z", lateMin: 1363, catchUp: true, nextStartAt: "2023-11-14T23:30:00.000Z", nextStartMs: 1700004600000 });
});

test('computes catchUp true when lateMin is one more than lateAfterMin', () => {
  const r = calendarLateness({ calendar: '10:00', now: 1700000000000, lateAfterMin: 29 });
  assert.deepEqual(r, { calendar: "10:00", scheduledAt: "2023-11-13T23:30:00.000Z", lateMin: 1363, catchUp: true, nextStartAt: "2023-11-14T23:30:00.000Z", nextStartMs: 1700004600000 });
});

test('computes nextStartAt one day after scheduled', () => {
  const r = calendarLateness({ calendar: '10:00', now: 1700000000000, lateAfterMin: 30 });
  assert.deepEqual(r, { calendar: "10:00", scheduledAt: "2023-11-13T23:30:00.000Z", lateMin: 1363, catchUp: true, nextStartAt: "2023-11-14T23:30:00.000Z", nextStartMs: 1700004600000 });
});

test('computes calendar string with zero-padded hour and minute', () => {
  const r = calendarLateness({ calendar: '9:5', now: 1700000000000, lateAfterMin: 30 });
  assert.deepEqual(r, null);
});

test('computes scheduledAt when now is exactly at slot time', () => {
  const r = calendarLateness({ calendar: '10:00', now: 1700000000000, lateAfterMin: 30 });
  assert.deepEqual(r, { calendar: "10:00", scheduledAt: "2023-11-13T23:30:00.000Z", lateMin: 1363, catchUp: true, nextStartAt: "2023-11-14T23:30:00.000Z", nextStartMs: 1700004600000 });
});

test('computes scheduledAt when now is one second before slot time', () => {
  const r = calendarLateness({ calendar: '10:00', now: 1699999999000, lateAfterMin: 30 });
  assert.deepEqual(r, { calendar: "10:00", scheduledAt: "2023-11-13T23:30:00.000Z", lateMin: 1363, catchUp: true, nextStartAt: "2023-11-14T23:30:00.000Z", nextStartMs: 1700004600000 });
});
