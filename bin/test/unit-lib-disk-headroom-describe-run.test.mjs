// Human-readable disk headroom status line (bin/lib/disk-headroom.mjs describeRun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRun } from '../lib/disk-headroom.mjs';

test('returns ok message when attributable is true', () => {
  const r = describeRun({ attributable: true, lowestMb: 100, thresholdMb: 50 });
  assert.equal(r, "disk ok \u2014 100 MB free at the low-water mark (floor 50 MB)");
});

test('returns ok message when attributable is 1', () => {
  const r = describeRun({ attributable: 1, lowestMb: 200, thresholdMb: 100 });
  assert.equal(r, "disk ok \u2014 200 MB free at the low-water mark (floor 100 MB)");
});

test('returns ok message when attributable is non-zero number', () => {
  const r = describeRun({ attributable: 42, lowestMb: 500, thresholdMb: 250 });
  assert.equal(r, "disk ok \u2014 500 MB free at the low-water mark (floor 250 MB)");
});

test('returns ok message when attributable is non-empty string', () => {
  const r = describeRun({ attributable: 'yes', lowestMb: 300, thresholdMb: 150 });
  assert.equal(r, "disk ok \u2014 300 MB free at the low-water mark (floor 150 MB)");
});

test('returns disk fail message when attributable is false', () => {
  const r = describeRun({ attributable: false, verdict: 'fail', reason: 'no space' });
  assert.equal(r, "DISK FAIL \u2014 no space. Treat this run's failures as UNDETERMINED.");
});

test('returns disk fail message when attributable is 0', () => {
  const r = describeRun({ attributable: 0, verdict: 'fail', reason: 'disk full' });
  assert.equal(r, "DISK FAIL \u2014 disk full. Treat this run's failures as UNDETERMINED.");
});

test('returns disk fail message when attributable is empty string', () => {
  const r = describeRun({ attributable: '', verdict: 'fail', reason: 'unavailable' });
  assert.equal(r, "DISK FAIL \u2014 unavailable. Treat this run's failures as UNDETERMINED.");
});

test('returns disk fail message when attributable is null', () => {
  const r = describeRun({ attributable: null, verdict: 'fail', reason: 'statfs error' });
  assert.equal(r, "DISK FAIL \u2014 statfs error. Treat this run's failures as UNDETERMINED.");
});

test('returns disk fail message when attributable is undefined', () => {
  const r = describeRun({ verdict: 'fail', reason: 'missing data' });
  assert.equal(r, "DISK FAIL \u2014 missing data. Treat this run's failures as UNDETERMINED.");
});
