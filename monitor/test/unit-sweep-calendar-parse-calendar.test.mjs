// Parses a time string into hour and minute or null (monitor/sweep-calendar.mjs parseCalendar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar } from '../sweep-calendar.mjs';

test('accepts single digit hour and valid minute', () => {
  assert.deepEqual(parseCalendar('9:05'), { hour: 9, minute: 5 });
});

test('accepts double digit hour and valid minute', () => {
  assert.deepEqual(parseCalendar('12:30'), { hour: 12, minute: 30 });
});

test('rejects triple digit hour', () => {
  assert.equal(parseCalendar('123:45'), null);
});

test('rejects triple digit minute', () => {
  assert.equal(parseCalendar('12:345'), null);
});

test('returns null for invalid format', () => {
  assert.equal(parseCalendar('abc'), null);
});

test('returns null for hour 24', () => {
  assert.equal(parseCalendar('24:00'), null);
});

test('returns null for minute 60', () => {
  assert.equal(parseCalendar('12:60'), null);
});

test('accepts hour 23 and minute 59', () => {
  assert.deepEqual(parseCalendar('23:59'), { hour: 23, minute: 59 });
});

test('returns null for hour 23 with invalid minute', () => {
  assert.equal(parseCalendar('23:60'), null);
});

test('returns null for valid hour with minute 60', () => {
  assert.equal(parseCalendar('12:60'), null);
});
