// Classifies warnings as fresh, returned, set-aside, or unidentified against disregard records (monitor/disregarded-warnings.mjs classifyWarnings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWarnings } from '../disregarded-warnings.mjs';

test('returns empty result for no warnings and no records', () => {
  const result = classifyWarnings([], [], { now: '2024-01-01T00:00:00Z' });
  assert.deepEqual(result, {
    rows: [],
    counts: { fresh: 0, returned: 0, 'set-aside': 0, unidentified: 0 },
    quiet: [],
    invalid: []
  });
});

test('classifies warning as fresh when no matching record exists', () => {
  const warnings = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', seenAt: '2024-01-01T10:00:00Z' }];
  const records = [];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].disposition, 'fresh');
  assert.equal(result.rows[0].key, 'eslint:no-unused-vars|src/app.js');
  assert.equal(result.counts.fresh, 1);
  assert.equal(result.counts.returned, 0);
  assert.equal(result.counts['set-aside'], 0);
  assert.equal(result.counts.unidentified, 0);
});

test('classifies warning as set-aside when seenAt is before record at', () => {
  const warnings = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', seenAt: '2024-01-01T08:00:00Z' }];
  const records = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', why: 'known issue', who: 'alice', at: '2024-01-01T09:00:00Z' }];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.rows[0].disposition, 'set-aside');
  assert.deepEqual(result.rows[0].disregarded, {
    why: 'known issue',
    who: 'alice',
    at: '2024-01-01T09:00:00Z',
    firstAt: '2024-01-01T09:00:00Z',
    setAsides: 1
  });
  assert.equal(result.counts['set-aside'], 1);
});

test('classifies warning as returned when seenAt is after record at', () => {
  const warnings = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', seenAt: '2024-01-01T10:00:00Z' }];
  const records = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', why: 'known issue', who: 'alice', at: '2024-01-01T09:00:00Z' }];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.rows[0].disposition, 'returned');
  assert.deepEqual(result.rows[0].disregarded, {
    why: 'known issue',
    who: 'alice',
    at: '2024-01-01T09:00:00Z',
    firstAt: '2024-01-01T09:00:00Z',
    setAsides: 1
  });
  assert.equal(result.counts.returned, 1);
});

test('classifies warning as unidentified when key is invalid', () => {
  const warnings = [{ source: 'bad source', code: 'no-unused-vars', subject: 'src/app.js', seenAt: '2024-01-01T10:00:00Z' }];
  const records = [];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.rows[0].disposition, 'unidentified');
  assert.equal(result.rows[0].key, null);
  assert.equal(result.counts.unidentified, 1);
});

test('classifies warning as unidentified when seenAt is not a valid time', () => {
  const warnings = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', seenAt: 'not-a-time' }];
  const records = [];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.rows[0].disposition, 'unidentified');
  assert.equal(result.rows[0].key, 'eslint:no-unused-vars|src/app.js');
  assert.equal(result.counts.unidentified, 1);
});

test('ignores records with at after now', () => {
  const warnings = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', seenAt: '2024-01-01T10:00:00Z' }];
  const records = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', why: 'future', who: 'alice', at: '2024-01-02T00:00:00Z' }];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.rows[0].disposition, 'fresh');
  assert.equal(result.quiet.length, 0);
});

test('reports invalid records in invalid array', () => {
  const warnings = [];
  const records = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', why: '', who: 'alice', at: '2024-01-01T09:00:00Z' }];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.invalid.length, 1);
  assert.equal(result.invalid[0].errors.length, 1);
  assert.match(result.invalid[0].errors[0], /why is required/);
});

test('lists quiet records that have no matching warnings', () => {
  const warnings = [];
  const records = [
    { source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', why: 'known', who: 'alice', at: '2024-01-01T09:00:00Z' },
    { source: 'eslint', code: 'no-undef', subject: 'src/util.js', why: 'known', who: 'bob', at: '2024-01-01T08:00:00Z' }
  ];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.quiet.length, 2);
  assert.equal(result.quiet[0].key, 'eslint:no-undef|src/util.js');
  assert.equal(result.quiet[1].key, 'eslint:no-unused-vars|src/app.js');
});

test('uses latest record when multiple records match same key', () => {
  const warnings = [{ source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', seenAt: '2024-01-01T10:00:00Z' }];
  const records = [
    { source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', why: 'first', who: 'alice', at: '2024-01-01T08:00:00Z' },
    { source: 'eslint', code: 'no-unused-vars', subject: 'src/app.js', why: 'second', who: 'bob', at: '2024-01-01T09:00:00Z' }
  ];
  const result = classifyWarnings(warnings, records, { now: '2024-01-01T12:00:00Z' });
  assert.equal(result.rows[0].disposition, 'returned');
  assert.equal(result.rows[0].disregarded.why, 'second');
  assert.equal(result.rows[0].disregarded.who, 'bob');
  assert.equal(result.rows[0].disregarded.at, '2024-01-01T09:00:00Z');
  assert.equal(result.rows[0].disregarded.firstAt, '2024-01-01T08:00:00Z');
  assert.equal(result.rows[0].disregarded.setAsides, 2);
});
