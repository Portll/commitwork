// Extracts StartCalendarInterval dict entries from launchd XML (admin/routes/rollups.mjs parseCalendar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar } from '../routes/rollups.mjs';

test('returns null when StartCalendarInterval key is absent', () => {
  const xml = '<dict><key>Program</key><string>/bin/true</string></dict>';
  assert.equal(parseCalendar(xml), null);
});

test('returns array with empty object when block has dict but no matching keys', () => {
  const xml = '<key>StartCalendarInterval</key><dict><key>Program</key><string>x</string></dict>';
  assert.deepEqual(parseCalendar(xml), [{}]);
});

test('parses a single dict with Minute and Hour', () => {
  const xml = '<key>StartCalendarInterval</key><dict><key>Minute</key><integer>30</integer><key>Hour</key><integer>12</integer></dict>';
  assert.deepEqual(parseCalendar(xml), [{ Minute: 30, Hour: 12 }]);
});

test('parses multiple dicts in an array block', () => {
  const xml = '<key>StartCalendarInterval</key><array><dict><key>Minute</key><integer>0</integer><key>Hour</key><integer>9</integer></dict><dict><key>Minute</key><integer>0</integer><key>Hour</key><integer>17</integer></dict></array>';
  assert.deepEqual(parseCalendar(xml), [
    { Minute: 0, Hour: 9 },
    { Minute: 0, Hour: 17 }
  ]);
});

test('parses dict with Day, Weekday, and Month keys', () => {
  const xml = '<key>StartCalendarInterval</key><dict><key>Day</key><integer>1</integer><key>Weekday</key><integer>2</integer><key>Month</key><integer>3</integer></dict>';
  assert.deepEqual(parseCalendar(xml), [{ Day: 1, Weekday: 2, Month: 3 }]);
});

test('ignores keys that are not Minute Hour Day Weekday or Month', () => {
  const xml = '<key>StartCalendarInterval</key><dict><key>Foo</key><integer>99</integer><key>Minute</key><integer>5</integer></dict>';
  assert.deepEqual(parseCalendar(xml), [{ Minute: 5 }]);
});

test('handles whitespace between key and integer tags', () => {
  const xml = '<key>StartCalendarInterval</key><dict><key>Hour</key>\n  <integer>8</integer>\n</dict>';
  assert.deepEqual(parseCalendar(xml), [{ Hour: 8 }]);
});

test('returns null for empty string input', () => {
  assert.equal(parseCalendar(''), null);
});

test('parses dict with all five keys present', () => {
  const xml = '<key>StartCalendarInterval</key><dict><key>Minute</key><integer>15</integer><key>Hour</key><integer>10</integer><key>Day</key><integer>5</integer><key>Weekday</key><integer>1</integer><key>Month</key><integer>6</integer></dict>';
  assert.deepEqual(parseCalendar(xml), [{ Minute: 15, Hour: 10, Day: 5, Weekday: 1, Month: 6 }]);
});
