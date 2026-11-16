// EPSS freshness from the per-score dates.
//
// epss.json is a flat {cve: score} map and accumulates scores across fetches, so freshness cannot
// be one stamp over the file: a single recent fetch would describe years of old scores as fresh.
// The dates live in the sidecar (epssRecordsFrom's `detail`), and the verdict is per entry, by the
// OLDEST one. The judge is pure (monitor/epss.mjs), so the clock and threshold are given here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { epssFreshnessFrom } from '../epss.mjs';

const NOW = new Date('2026-09-01T12:00:00Z');
const STALE_DAYS = 7;
const at = (id, date) => [id, { probability: '0.5', percentile: '0.9', date }];

describe('EPSS freshness', () => {
  test('every score dated within the threshold is fresh', () => {
    const detail = Object.fromEntries([at('CVE-2026-0001', '2026-08-30'), at('CVE-2026-0002', '2026-08-31')]);
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0001', 'CVE-2026-0002'], detail, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'fresh', entries: 2, dated: 2, undated: 0,
      oldestDate: '2026-08-30', newestDate: '2026-08-31', ageDays: 2,
      note: '2 scored CVE(s), all dated; oldest 2026-08-30, 2d old (limit 7d)',
    });
  });

  test('one score older than the threshold makes the cache stale, at the OLDEST date', () => {
    // A newest-only judgement would read 1 day and call this fresh; the oldest is what counts.
    const detail = Object.fromEntries([
      at('CVE-2026-0011', '2026-08-31'),
      at('CVE-2026-0012', '2026-08-01'),
      at('CVE-2026-0013', '2026-08-20'),
    ]);
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0011', 'CVE-2026-0012', 'CVE-2026-0013'], detail, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'stale', entries: 3, dated: 3, undated: 0,
      oldestDate: '2026-08-01', newestDate: '2026-08-31', ageDays: 31,
      note: '3 scored CVE(s), 0 undated; oldest 2026-08-01, 31d old (limit 7d)',
    });
  });

  test('scores with no sidecar entry keep the state unknown, however fresh the dated ones are', () => {
    // The dated subset alone would read fresh; the cache cannot vouch for the undated entries.
    const detail = Object.fromEntries([at('CVE-2026-0021', '2026-08-31'), at('CVE-2026-0022', '2026-08-30')]);
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0021', 'CVE-2026-0022', 'CVE-2026-0023'], detail, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'unknown', entries: 3, dated: 2, undated: 1,
      oldestDate: '2026-08-30', newestDate: '2026-08-31', ageDays: 2,
      note: '3 scored CVE(s), 1 undated; freshness undetermined',
    });
  });

  test('a date that does not parse is undated, never old and never new', () => {
    const detail = Object.fromEntries([at('CVE-2026-0031', '2026-08-31'), at('CVE-2026-0032', 'not-a-date')]);
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0031', 'CVE-2026-0032'], detail, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'unknown', entries: 2, dated: 1, undated: 1,
      oldestDate: '2026-08-31', newestDate: '2026-08-31', ageDays: 1,
      note: '2 scored CVE(s), 1 undated; freshness undetermined',
    });
  });

  test('an impossible calendar date or a malformed timestamp is undated', () => {
    const detail = Object.fromEntries([at('CVE-2026-0035', '2026-02-30'), at('CVE-2026-0036', '2026-08-31T99:99Z')]);
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0035', 'CVE-2026-0036'], detail, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'unknown', entries: 2, dated: 0, undated: 2,
      oldestDate: null, newestDate: null, ageDays: null,
      note: '2 scored CVE(s), 2 undated; freshness undetermined',
    });
  });

  test('an empty score cache is unknown with null dates', () => {
    assert.deepEqual(epssFreshnessFrom([], {}, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'unknown', entries: 0, dated: 0, undated: 0,
      oldestDate: null, newestDate: null, ageDays: null,
      note: '0 scored CVE(s), 0 undated; freshness undetermined',
    });
  });

  test('a full ISO timestamp counts as a date, by its calendar day', () => {
    const detail = Object.fromEntries([at('CVE-2026-0041', '2026-08-31T23:59:59.000Z')]);
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0041'], detail, { now: NOW.getTime(), staleDays: STALE_DAYS }), {
      state: 'fresh', entries: 1, dated: 1, undated: 0,
      oldestDate: '2026-08-31', newestDate: '2026-08-31', ageDays: 1,
      note: '1 scored CVE(s), all dated; oldest 2026-08-31, 1d old (limit 7d)',
    });
  });

  test('sidecar keys not in scoreIds are ignored', () => {
    // The sidecar accumulates too; a key with no score in epss.json must not age the verdict.
    const detail = Object.fromEntries([at('CVE-2026-0051', '2026-08-31'), at('CVE-2026-0052', '2020-01-01')]);
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0051'], detail, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'fresh', entries: 1, dated: 1, undated: 0,
      oldestDate: '2026-08-31', newestDate: '2026-08-31', ageDays: 1,
      note: '1 scored CVE(s), all dated; oldest 2026-08-31, 1d old (limit 7d)',
    });
  });

  test('a null detail is empty: every score is undated', () => {
    assert.deepEqual(epssFreshnessFrom(['CVE-2026-0061', 'CVE-2026-0062'], null, { now: NOW, staleDays: STALE_DAYS }), {
      state: 'unknown', entries: 2, dated: 0, undated: 2,
      oldestDate: null, newestDate: null, ageDays: null,
      note: '2 scored CVE(s), 2 undated; freshness undetermined',
    });
  });

  test('ageDays equal to the threshold is still fresh — the comparison is strict', () => {
    const detail = Object.fromEntries([at('CVE-2026-0071', '2026-08-25')]); // exactly 7.5 days -> 7
    const r = epssFreshnessFrom(['CVE-2026-0071'], detail, { now: NOW, staleDays: STALE_DAYS });
    assert.equal(r.ageDays, 7);
    assert.equal(r.state, 'fresh');
  });

  test('an unusable threshold yields unknown, never a verdict', () => {
    const detail = Object.fromEntries([at('CVE-2026-0081', '2026-08-31')]);
    for (const staleDays of [undefined, null, 'seven', -1, NaN]) {
      const r = epssFreshnessFrom(['CVE-2026-0081'], detail, { now: NOW, staleDays });
      assert.equal(r.state, 'unknown', `staleDays ${String(staleDays)} cannot support a verdict`);
      assert.equal(r.ageDays, 1, 'the observation is still published');
    }
  });
});
