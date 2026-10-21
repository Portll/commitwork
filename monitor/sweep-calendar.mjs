// commitwork monitor — a sweep that starts long after its calendar slot is a CATCH-UP, not a run.
//
// launchd fires every StartCalendarInterval job the machine slept through the moment it wakes:
// after a long hibernate the whole ladder starts in one second. Each sweep then queues on the
// fleet slot with the 4 h deadline meant for a quiet night, and most are deferred, so every area
// reads STALE while nothing is wrong with any scanner.
//
// The agent tells the sweep its slot through CW_SWEEP_CALENDAR ("HH:MM", local time, written by
// install-agents.mjs). A sweep more than CW_SWEEP_LATE_MIN minutes past it (default 30, two
// staggers) is late, and a late sweep may wait for a slot until shortly before its NEXT calendar
// slot instead of 4 h, so the backlog drains in order rather than being refused. Without the
// variable nothing here applies; a hand-run sweep has no calendar to be late against.

import { DEFAULT_DEADLINE_MS } from './sweep-slot.mjs';

export const DEFAULT_LATE_AFTER_MIN = 30;
export const CATCH_UP_MARGIN_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseCalendar(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * How late this start is against its calendar slot, in the machine's local time.
 * -> null when no usable calendar was given, else
 *    { calendar, scheduledAt, lateMin, catchUp, nextStartAt, nextStartMs }
 */
export function calendarLateness({ calendar, now = Date.now(), lateAfterMin = DEFAULT_LATE_AFTER_MIN } = {}) {
  const slot = parseCalendar(calendar);
  if (!slot) return null;
  const scheduled = new Date(now);
  scheduled.setHours(slot.hour, slot.minute, 0, 0);
  if (scheduled.getTime() > now) scheduled.setDate(scheduled.getDate() - 1);
  const next = new Date(scheduled);
  next.setDate(next.getDate() + 1);
  const lateMin = Math.round((now - scheduled.getTime()) / 60000);
  return {
    calendar: `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`,
    scheduledAt: scheduled.toISOString(),
    lateMin,
    catchUp: lateMin > lateAfterMin,
    nextStartAt: next.toISOString(),
    nextStartMs: next.getTime(),
  };
}

/** The slot deadline a catch-up may use: until a margin before the next calendar slot, never below the normal one. */
export function catchUpDeadlineMs(late, { now = Date.now(), floorMs = DEFAULT_DEADLINE_MS, marginMs = CATCH_UP_MARGIN_MS } = {}) {
  if (!late?.catchUp) return floorMs;
  return Math.max(floorMs, Math.min(DAY_MS, late.nextStartMs - marginMs - now));
}

export const lateAfterMin = (env = process.env) => {
  const n = Number(env.CW_SWEEP_LATE_MIN);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LATE_AFTER_MIN;
};
