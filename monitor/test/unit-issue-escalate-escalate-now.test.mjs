// ISO timestamp from the forced env override or the current clock (monitor/issue-escalate.mjs escalateNow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalateNow } from '../issue-escalate.mjs';

function withFixedClock(fn) {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [1700000000000]));
    }
  };
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

test('uses the current clock when neither variable is set', () => {
  const r = withFixedClock(() => escalateNow({}));
  assert.equal(r, '2023-11-14T22:13:20.000Z');
});

test('uses the current clock when both variables are empty strings', () => {
  const r = withFixedClock(() => escalateNow({ CW_ESCALATE_NOW: '', CW_NOW: '' }));
  assert.equal(r, '2023-11-14T22:13:20.000Z');
});

test('uses CW_ESCALATE_NOW when it is the only variable set', () => {
  const r = withFixedClock(() => escalateNow({ CW_ESCALATE_NOW: '2023-01-01T12:00:00Z' }));
  assert.equal(r, '2023-01-01T12:00:00.000Z');
});

test('uses CW_NOW when it is the only variable set', () => {
  const r = withFixedClock(() => escalateNow({ CW_NOW: '2025-03-03T09:45:00Z' }));
  assert.equal(r, '2025-03-03T09:45:00.000Z');
});

test('prefers CW_ESCALATE_NOW over CW_NOW when both are set', () => {
  const r = escalateNow({
    CW_ESCALATE_NOW: '2024-02-02T08:30:00Z',
    CW_NOW: '2025-03-03T09:45:00Z',
  });
  assert.equal(r, '2024-02-02T08:30:00.000Z');
});

test('falls through to CW_NOW when CW_ESCALATE_NOW is an empty string', () => {
  const r = escalateNow({ CW_ESCALATE_NOW: '', CW_NOW: '2027-05-05T11:20:00Z' });
  assert.equal(r, '2027-05-05T11:20:00.000Z');
});

test('falls through to CW_NOW when CW_ESCALATE_NOW is the number zero', () => {
  const r = escalateNow({ CW_ESCALATE_NOW: 0, CW_NOW: '2028-06-06T12:25:00Z' });
  assert.equal(r, '2028-06-06T12:25:00.000Z');
});

test('normalises a forced time with an offset to UTC', () => {
  const r = escalateNow({ CW_ESCALATE_NOW: '2024-06-15T12:00:00+02:00' });
  assert.equal(r, '2024-06-15T10:00:00.000Z');
});

test('throws a RangeError when the forced value is not a valid date', () => {
  assert.throws(() => escalateNow({ CW_NOW: 'not-a-date' }), {
    name: 'RangeError',
    message: 'Invalid time value',
  });
});

test('reads process.env when called without an argument', () => {
  const saved = process.env.CW_ESCALATE_NOW;
  process.env.CW_ESCALATE_NOW = '2029-07-07T13:30:00Z';
  let r;
  try {
    r = escalateNow();
  } finally {
    if (saved === undefined) {
      delete process.env.CW_ESCALATE_NOW;
    } else {
      process.env.CW_ESCALATE_NOW = saved;
    }
  }
  assert.equal(r, '2029-07-07T13:30:00.000Z');
});
