// Computes the KEV catalogue staleness threshold in days from environment variables (cra/lib.mjs kevStaleDays).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kevStaleDays } from '../lib.mjs';

test('returns the default of 7 when no CRA_KEV_STALE_DAYS is set', () => {
  const r = kevStaleDays({});
  assert.equal(r, 7);
});

test('returns the default of 7 when CRA_KEV_STALE_DAYS is an empty string', () => {
  const r = kevStaleDays({ CRA_KEV_STALE_DAYS: '' });
  assert.equal(r, 7);
});

test('returns 0 when CRA_KEV_STALE_DAYS is the string zero', () => {
  const r = kevStaleDays({ CRA_KEV_STALE_DAYS: '0' });
  assert.equal(r, 0);
});

test('returns 3 when CRA_KEV_STALE_DAYS is the string three', () => {
  const r = kevStaleDays({ CRA_KEV_STALE_DAYS: '3' });
  assert.equal(r, 3);
});

test('returns 14 when CRA_KEV_STALE_DAYS is the string fourteen', () => {
  const r = kevStaleDays({ CRA_KEV_STALE_DAYS: '14' });
  assert.equal(r, 14);
});

test('throws when the retired CW_KEV_STALE_DAYS is set', () => {
  assert.throws(
    () => kevStaleDays({ CW_KEV_STALE_DAYS: '1' }),
    { name: 'Error', message: 'CW_KEV_STALE_DAYS is retired: CRA_KEV_STALE_DAYS is the one name every KEV freshness reader uses (cra/watch.mjs, cra/preflight.mjs, monitor/rollup.mjs)' }
  );
});

test('throws when CRA_KEV_STALE_DAYS is a non-numeric string', () => {
  assert.throws(
    () => kevStaleDays({ CRA_KEV_STALE_DAYS: 'abc' }),
    { name: 'Error', message: 'CRA_KEV_STALE_DAYS must be a number of days >= 0 (got "abc")' }
  );
});

test('throws when CRA_KEV_STALE_DAYS is a negative number', () => {
  assert.throws(
    () => kevStaleDays({ CRA_KEV_STALE_DAYS: '-1' }),
    { name: 'Error', message: 'CRA_KEV_STALE_DAYS must be a number of days >= 0 (got "-1")' }
  );
});

test('throws when CRA_KEV_STALE_DAYS is the string NaN', () => {
  assert.throws(
    () => kevStaleDays({ CRA_KEV_STALE_DAYS: 'NaN' }),
    { name: 'Error', message: 'CRA_KEV_STALE_DAYS must be a number of days >= 0 (got "NaN")' }
  );
});
