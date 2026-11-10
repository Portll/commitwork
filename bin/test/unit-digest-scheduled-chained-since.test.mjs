// The window end of the latest written digest run if it ended within seven days before until (bin/digest-scheduled.mjs chainedSince).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainedSince } from '../digest-scheduled.mjs';
import { JOB_RECORD_KIND } from '../digest.mjs';

const rec = (until, extra = {}) => ({
  kind: JOB_RECORD_KIND,
  job: 'digest',
  steps: [{ step: 'write', written: true }],
  window: { until },
  ...extra,
});

test('returns the window end of a lone written digest record that ended one day before until', () => {
  const records = [rec('2026-01-01T00:00:00.000Z')];
  assert.equal(chainedSince(records, '2026-01-02T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
});

test('returns the window end when the gap is one millisecond and null when the gap is zero', () => {
  const records = [rec('2026-01-01T00:00:00.000Z')];
  assert.equal(chainedSince(records, '2026-01-01T00:00:00.001Z'), '2026-01-01T00:00:00.000Z');
  assert.equal(chainedSince(records, '2026-01-01T00:00:00.000Z'), null);
});

test('returns the window end when the gap is exactly seven days and null one millisecond later', () => {
  const records = [rec('2026-01-01T00:00:00.000Z')];
  assert.equal(chainedSince(records, '2026-01-08T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
  assert.equal(chainedSince(records, '2026-01-08T00:00:00.001Z'), null);
});

test('returns null when the window ends after until or the list is empty', () => {
  assert.equal(chainedSince([rec('2026-01-02T00:00:00.000Z')], '2026-01-01T00:00:00.000Z'), null);
  assert.equal(chainedSince([], '2026-01-01T00:00:00.000Z'), null);
});

test('skips records of another kind or of another job', () => {
  const until = '2026-01-02T00:00:00.000Z';
  assert.equal(chainedSince([rec('2026-01-01T00:00:00.000Z', { kind: 'other' })], until), null);
  assert.equal(chainedSince([rec('2026-01-01T00:00:00.000Z', { job: 'other' })], until), null);
});

test('skips null records and records without a written write step to reach an earlier written one', () => {
  const records = [
    rec('2026-01-01T00:00:00.000Z'),
    rec('2026-01-02T00:00:00.000Z', {
      steps: [{ step: 'write', written: 'true' }, { step: 'render', written: true }, null],
    }),
    rec('2026-01-03T00:00:00.000Z', { steps: undefined }),
    null,
  ];
  assert.equal(chainedSince(records, '2026-01-04T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
});

test('lets the latest written record decide even when its gap is out of range', () => {
  const records = [rec('2026-01-01T00:00:00.000Z'), rec('2026-01-10T00:00:00.000Z')];
  assert.equal(chainedSince(records, '2026-01-10T00:00:00.000Z'), null);
});

test('reads only indices below length on an array-like input', () => {
  const records = {
    length: 1,
    0: rec('2026-01-01T00:00:00.000Z'),
    2: rec('2026-01-05T00:00:00.000Z'),
  };
  assert.equal(chainedSince(records, '2026-01-06T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
});
