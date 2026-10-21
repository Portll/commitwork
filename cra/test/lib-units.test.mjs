// cra/test/lib-units.test.mjs — case tests for addDays, addHours, addMonths, daysBetween, epssFor, isOverdue, resolveKeyDir, slugify, withCraStoreLock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { addDays, addHours, addMonths, daysBetween, epssFor, isOverdue, resolveKeyDir, slugify, withCraStoreLock } from '../lib.mjs';

test('addDays adds one day', () => {
  assert.equal(addDays('2024-01-01T00:00:00.000Z', 1), '2024-01-02T00:00:00.000Z');
});

test('addDays adds multiple days', () => {
  assert.equal(addDays('2024-01-01T00:00:00.000Z', 3), '2024-01-04T00:00:00.000Z');
});

test('addDays with zero days returns same date', () => {
  assert.equal(addDays('2024-01-01T00:00:00.000Z', 0), '2024-01-01T00:00:00.000Z');
});

test('addDays with negative days subtracts days', () => {
  assert.equal(addDays('2024-01-01T00:00:00.000Z', -1), '2023-12-31T00:00:00.000Z');
});

test('addDays preserves time component', () => {
  assert.equal(addDays('2024-01-01T12:30:00.000Z', 1), '2024-01-02T12:30:00.000Z');
});

test('addDays with fractional days', () => {
  assert.equal(addDays('2024-01-01T00:00:00.000Z', 0.5), '2024-01-01T12:00:00.000Z');
});

test('addDays with invalid ISO string throws', () => {
  assert.throws(() => addDays('not-a-date', 1), RangeError);
});

test('addDays with non-numeric days produces invalid date', () => {
  assert.throws(() => addDays('2024-01-01T00:00:00.000Z', 'abc'), RangeError);
});

test('addHours adds positive hours', () => {
  assert.equal(addHours('2024-01-01T00:00:00.000Z', 1), '2024-01-01T01:00:00.000Z');
});

test('addHours adds multiple hours', () => {
  assert.equal(addHours('2024-01-01T00:00:00.000Z', 25), '2024-01-02T01:00:00.000Z');
});

test('addHours with zero hours returns same time', () => {
  assert.equal(addHours('2024-06-15T12:30:00.000Z', 0), '2024-06-15T12:30:00.000Z');
});

test('addHours with negative hours subtracts', () => {
  assert.equal(addHours('2024-01-01T00:00:00.000Z', -1), '2023-12-31T23:00:00.000Z');
});

test('addHours crosses month boundary', () => {
  assert.equal(addHours('2024-01-31T23:00:00.000Z', 2), '2024-02-01T01:00:00.000Z');
});

test('addHours with fractional hours', () => {
  assert.equal(addHours('2024-03-10T08:00:00.000Z', 0.5), '2024-03-10T08:30:00.000Z');
});

test('addHours throws on invalid date string', () => {
  assert.throws(() => addHours('not-a-date', 1), RangeError);
});

test('addMonths: normal case, no day overflow', () => {
  assert.equal(addMonths('2024-01-15T00:00:00.000Z', 1), '2024-02-15T00:00:00.000Z');
});

test('addMonths: day overflow clamps to last day of month', () => {
  assert.equal(addMonths('2024-01-31T00:00:00.000Z', 1), '2024-02-29T00:00:00.000Z');
});

test('addMonths: leap year Feb 29 + 1 month', () => {
  assert.equal(addMonths('2024-02-29T00:00:00.000Z', 1), '2024-03-29T00:00:00.000Z');
});

test('addMonths: non-leap year Jan 31 + 1 month', () => {
  assert.equal(addMonths('2023-01-31T00:00:00.000Z', 1), '2023-02-28T00:00:00.000Z');
});

test('addMonths: negative months', () => {
  assert.equal(addMonths('2024-03-15T00:00:00.000Z', -1), '2024-02-15T00:00:00.000Z');
});

test('addMonths: zero months returns same date', () => {
  assert.equal(addMonths('2024-06-10T12:30:00.000Z', 0), '2024-06-10T12:30:00.000Z');
});

test('addMonths: crossing year boundary', () => {
  assert.equal(addMonths('2024-12-15T00:00:00.000Z', 1), '2025-01-15T00:00:00.000Z');
});

test('addMonths: day 31 to a 30-day month', () => {
  assert.equal(addMonths('2024-01-31T00:00:00.000Z', 2), '2024-03-31T00:00:00.000Z');
});

test('returns 0 for identical timestamps', () => {
  assert.equal(daysBetween('2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'), 0);
});

test('returns 1 for one day apart', () => {
  assert.equal(daysBetween('2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z'), 1);
});

test('returns -1 when a is after b', () => {
  assert.equal(daysBetween('2024-01-02T00:00:00.000Z', '2024-01-01T00:00:00.000Z'), -1);
});

test('returns fractional days for 12 hours', () => {
  assert.equal(daysBetween('2024-01-01T00:00:00.000Z', '2024-01-01T12:00:00.000Z'), 0.5);
});

test('returns 30 for one month of days', () => {
  assert.equal(daysBetween('2024-01-01T00:00:00.000Z', '2024-01-31T00:00:00.000Z'), 30);
});

test('returns 365 for one non-leap year', () => {
  assert.equal(daysBetween('2023-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'), 365);
});

test('returns 366 for one leap year', () => {
  assert.equal(daysBetween('2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'), 366);
});

test('returns NaN for invalid date strings', () => {
  assert.ok(Number.isNaN(daysBetween('not-a-date', '2024-01-01T00:00:00.000Z')));
});

test('returns the number when the key exists with a numeric value', () => {
  const doc = { 'CVE-2024-0001': 0.123 };
  assert.equal(epssFor(doc, 'CVE-2024-0001'), 0.123);
});

test('returns null when the key is missing', () => {
  const doc = { 'CVE-2024-0001': 0.5 };
  assert.equal(epssFor(doc, 'CVE-2024-9999'), null);
});

test('returns null when the value is a string, not a number', () => {
  const doc = { 'CVE-2024-0001': '0.5' };
  assert.equal(epssFor(doc, 'CVE-2024-0001'), null);
});

test('returns null when the value is an object', () => {
  const doc = { 'CVE-2024-0001': { score: 0.5 } };
  assert.equal(epssFor(doc, 'CVE-2024-0001'), null);
});

test('returns null when epssDoc is null', () => {
  assert.equal(epssFor(null, 'CVE-2024-0001'), null);
});

test('returns null when epssDoc is undefined', () => {
  assert.equal(epssFor(undefined, 'CVE-2024-0001'), null);
});

test('returns 0 when the value is the number zero', () => {
  const doc = { 'CVE-2024-0001': 0 };
  assert.equal(epssFor(doc, 'CVE-2024-0001'), 0);
});

test('returns null when the value is boolean true', () => {
  const doc = { 'CVE-2024-0001': true };
  assert.equal(epssFor(doc, 'CVE-2024-0001'), null);
});

test('returns true when refIso is after dueIso', () => {
  assert.equal(isOverdue('2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z'), true);
});

test('returns false when refIso is before dueIso', () => {
  assert.equal(isOverdue('2024-01-02T00:00:00.000Z', '2024-01-01T00:00:00.000Z'), false);
});

test('returns false when refIso equals dueIso', () => {
  assert.equal(isOverdue('2024-06-15T12:00:00.000Z', '2024-06-15T12:00:00.000Z'), false);
});

test('returns true when refIso is one millisecond after dueIso', () => {
  assert.equal(isOverdue('2024-03-10T08:30:00.000Z', '2024-03-10T08:30:00.001Z'), true);
});

test('returns false when refIso is one millisecond before dueIso', () => {
  assert.equal(isOverdue('2024-03-10T08:30:00.001Z', '2024-03-10T08:30:00.000Z'), false);
});

test('handles different time zones in ISO strings', () => {
  // dueIso is 2024-01-01T05:00:00Z, refIso is 2024-01-01T04:00:00Z (earlier)
  assert.equal(isOverdue('2024-01-01T05:00:00.000Z', '2024-01-01T04:00:00.000Z'), false);
  // dueIso is 2024-01-01T04:00:00Z, refIso is 2024-01-01T05:00:00Z (later)
  assert.equal(isOverdue('2024-01-01T04:00:00.000Z', '2024-01-01T05:00:00.000Z'), true);
});

test('returns CW_ATTEST_KEYDIR when set', () => {
  const prev = process.env.CW_ATTEST_KEYDIR;
  process.env.CW_ATTEST_KEYDIR = '/custom/keydir';
  try {
    assert.equal(resolveKeyDir({ reportsRoot: '/x/reports' }), '/custom/keydir');
  } finally {
    if (prev === undefined) delete process.env.CW_ATTEST_KEYDIR;
    else process.env.CW_ATTEST_KEYDIR = prev;
  }
});

test('falls back to join(reportsRoot, "..", "cra", ".keys") when env unset', () => {
  const prev = process.env.CW_ATTEST_KEYDIR;
  delete process.env.CW_ATTEST_KEYDIR;
  try {
    assert.equal(resolveKeyDir({ reportsRoot: '/data/reports' }), join('/data', 'cra', '.keys'));
  } finally {
    if (prev !== undefined) process.env.CW_ATTEST_KEYDIR = prev;
  }
});

test('handles nested reportsRoot path', () => {
  const prev = process.env.CW_ATTEST_KEYDIR;
  delete process.env.CW_ATTEST_KEYDIR;
  try {
    assert.equal(resolveKeyDir({ reportsRoot: '/a/b/c/reports' }), join('/a/b/c', 'cra', '.keys'));
  } finally {
    if (prev !== undefined) process.env.CW_ATTEST_KEYDIR = prev;
  }
});

test('env value is returned verbatim even if it looks like a relative path', () => {
  const prev = process.env.CW_ATTEST_KEYDIR;
  process.env.CW_ATTEST_KEYDIR = 'relative/dir';
  try {
    assert.equal(resolveKeyDir({ reportsRoot: '/x' }), 'relative/dir');
  } finally {
    if (prev === undefined) delete process.env.CW_ATTEST_KEYDIR;
    else process.env.CW_ATTEST_KEYDIR = prev;
  }
});

test('empty string env is falsy so fallback is used', () => {
  const prev = process.env.CW_ATTEST_KEYDIR;
  process.env.CW_ATTEST_KEYDIR = '';
  try {
    assert.equal(resolveKeyDir({ reportsRoot: '/r' }), join('/', 'cra', '.keys'));
  } finally {
    if (prev === undefined) delete process.env.CW_ATTEST_KEYDIR;
    else process.env.CW_ATTEST_KEYDIR = prev;
  }
});

test('slugify: simple lowercase', () => {
  assert.equal(slugify('Hello'), 'hello');
});

test('slugify: spaces become hyphens', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify: multiple special chars collapse to one hyphen', () => {
  assert.equal(slugify('Hello!!! World'), 'hello-world');
});

test('slugify: leading and trailing hyphens removed', () => {
  assert.equal(slugify('  Hello  '), 'hello');
});

test('slugify: all special chars returns empty string', () => {
  assert.equal(slugify('!!!'), '');
});

test('slugify: numbers preserved', () => {
  assert.equal(slugify('Hello123'), 'hello123');
});

test('slugify: mixed case and symbols', () => {
  assert.equal(slugify('My-Test_Page'), 'my-test-page');
});

test('slugify: empty string returns empty string', () => {
  assert.equal(slugify(''), '');
});

// A store path of its own per test: a shared one would contend with a concurrent run of this suite.
const storeFor = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cra-lock-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return join(d, 'cases.jsonl');
};

test('returns ok:true and the fn result when the lock is acquired', (t) => {
  const result = withCraStoreLock(storeFor(t), () => 42);
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
});

test('returns ok:true with undefined value when fn returns undefined', (t) => {
  const result = withCraStoreLock(storeFor(t), () => undefined);
  assert.equal(result.ok, true);
  assert.equal(result.value, undefined);
});

test('returns ok:true with null value when fn returns null', (t) => {
  const result = withCraStoreLock(storeFor(t), () => null);
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test('returns ok:true with an object value', (t) => {
  const obj = { a: 1, b: 'two' };
  const result = withCraStoreLock(storeFor(t), () => obj);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, obj);
});

test('returns ok:true with a string value', (t) => {
  const result = withCraStoreLock(storeFor(t), () => 'hello');
  assert.equal(result.ok, true);
  assert.equal(result.value, 'hello');
});

test('returns ok:true with a false value', (t) => {
  const result = withCraStoreLock(storeFor(t), () => false);
  assert.equal(result.ok, true);
  assert.equal(result.value, false);
});

test('returns ok:true with a zero value', (t) => {
  const result = withCraStoreLock(storeFor(t), () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.value, 0);
});

test('returns ok:true with an empty array value', (t) => {
  const result = withCraStoreLock(storeFor(t), () => []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, []);
});
