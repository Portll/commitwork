// A sweep fired hours after its calendar slot is a catch-up: it waits for the fleet slot until
// its next slot instead of being deferred at 4 h. Driven with fixed clocks, in local time.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar, calendarLateness, catchUpDeadlineMs, lateAfterMin, DEFAULT_LATE_AFTER_MIN, CATCH_UP_MARGIN_MS } from '../sweep-calendar.mjs';
import { DEFAULT_DEADLINE_MS } from '../sweep-slot.mjs';

const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe('calendar lateness', () => {
  test('no calendar, or a malformed one, means nothing applies', () => {
    assert.equal(calendarLateness({ calendar: undefined, now: local(2026, 10, 18, 15, 41) }), null);
    for (const bad of ['', '7', '25:00', '07:60', 'tonight', '7:1']) assert.equal(parseCalendar(bad), null, bad);
    assert.deepEqual(parseCalendar('7:15'), { hour: 7, minute: 15 });
  });

  test('a start minutes after its slot is on time', () => {
    const r = calendarLateness({ calendar: '07:15', now: local(2026, 10, 18, 7, 20) });
    assert.equal(r.lateMin, 5);
    assert.equal(r.catchUp, false);
    assert.equal(r.calendar, '07:15');
  });

  test('a start hours after its slot is a catch-up, against TODAY\'s slot', () => {
    const r = calendarLateness({ calendar: '07:15', now: local(2026, 10, 18, 15, 41) });
    assert.equal(r.lateMin, 8 * 60 + 26);
    assert.equal(r.catchUp, true);
    assert.equal(new Date(r.scheduledAt).getTime(), local(2026, 10, 18, 7, 15));
    assert.equal(r.nextStartMs, local(2026, 10, 19, 7, 15));
  });

  test('a start before today\'s slot measures against yesterday\'s', () => {
    const r = calendarLateness({ calendar: '23:30', now: local(2026, 10, 18, 0, 10) });
    assert.equal(r.lateMin, 40);
    assert.equal(r.catchUp, true);
    assert.equal(new Date(r.scheduledAt).getTime(), local(2026, 10, 17, 23, 30));
  });

  test('the late threshold is the env override or the default', () => {
    assert.equal(lateAfterMin({}), DEFAULT_LATE_AFTER_MIN);
    assert.equal(lateAfterMin({ CW_SWEEP_LATE_MIN: '90' }), 90);
    assert.equal(lateAfterMin({ CW_SWEEP_LATE_MIN: 'soon' }), DEFAULT_LATE_AFTER_MIN);
    const r = calendarLateness({ calendar: '07:15', now: local(2026, 10, 18, 8, 0), lateAfterMin: 90 });
    assert.equal(r.catchUp, false, '45 min late is under a 90 min threshold');
  });
});

describe('catch-up deadline', () => {
  test('an on-time sweep keeps the normal deadline', () => {
    const now = local(2026, 10, 18, 7, 20);
    const r = calendarLateness({ calendar: '07:15', now });
    assert.equal(catchUpDeadlineMs(r, { now }), DEFAULT_DEADLINE_MS);
    assert.equal(catchUpDeadlineMs(null, { now }), DEFAULT_DEADLINE_MS);
  });

  test('a catch-up may wait until a margin before its next slot', () => {
    const now = local(2026, 10, 18, 15, 41);
    const r = calendarLateness({ calendar: '07:15', now });
    const expected = local(2026, 10, 19, 7, 15) - CATCH_UP_MARGIN_MS - now;
    assert.equal(catchUpDeadlineMs(r, { now }), expected);
    assert.ok(expected > DEFAULT_DEADLINE_MS, 'the point of the catch-up is a longer wait');
  });

  test('a catch-up close to its next slot never gets LESS than the normal deadline', () => {
    const now = local(2026, 10, 19, 6, 50);
    const r = calendarLateness({ calendar: '07:15', now });
    assert.equal(r.catchUp, true, '23 h late');
    assert.equal(catchUpDeadlineMs(r, { now }), DEFAULT_DEADLINE_MS);
  });
});
