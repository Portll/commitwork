// Computes whether a run's disk headroom is ok, low, or unknown (bin/lib/disk-headroom.mjs assessRun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRun } from '../lib/disk-headroom.mjs';

test('returns unknown when before is missing', () => {
  const r = assessRun(undefined, { ok: true, freeMb: 100 }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "unknown", attributable: false, thresholdMb: 50, reason: "a headroom sample is missing" });
});

test('returns unknown when after is missing', () => {
  const r = assessRun({ ok: true, freeMb: 100 }, undefined, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "unknown", attributable: false, thresholdMb: 50, reason: "a headroom sample is missing" });
});

test('returns unknown when before is not ok', () => {
  const r = assessRun({ ok: false, reason: 'statfs failed' }, { ok: true, freeMb: 100 }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "unknown", attributable: false, thresholdMb: 50, reason: "statfs failed" });
});

test('returns unknown when after is not ok', () => {
  const r = assessRun({ ok: true, freeMb: 100 }, { ok: false, reason: 'statfs failed' }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "unknown", attributable: false, thresholdMb: 50, reason: "statfs failed" });
});

test('returns low when lowest free space is below threshold', () => {
  const r = assessRun({ ok: true, freeMb: 100 }, { ok: true, freeMb: 40 }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "low", attributable: false, thresholdMb: 50, lowestMb: 40, reason: "free space fell to 40 MB, under the 50 MB floor \u2014 failures in this run are undetermined, not attributable" });
});

test('returns low when lowest free space equals threshold minus one', () => {
  const r = assessRun({ ok: true, freeMb: 100 }, { ok: true, freeMb: 49 }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "low", attributable: false, thresholdMb: 50, lowestMb: 49, reason: "free space fell to 49 MB, under the 50 MB floor \u2014 failures in this run are undetermined, not attributable" });
});

test('returns ok when lowest free space equals threshold', () => {
  const r = assessRun({ ok: true, freeMb: 100 }, { ok: true, freeMb: 50 }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "ok", attributable: true, thresholdMb: 50, lowestMb: 50 });
});

test('returns ok when lowest free space is above threshold', () => {
  const r = assessRun({ ok: true, freeMb: 100 }, { ok: true, freeMb: 60 }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "ok", attributable: true, thresholdMb: 50, lowestMb: 60 });
});

test('uses provided minFreeMb option instead of env default', () => {
  const r = assessRun({ ok: true, freeMb: 100 }, { ok: true, freeMb: 60 }, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "ok", attributable: true, thresholdMb: 50, lowestMb: 60 });
});

test('returns unknown with fallback reason when both samples are missing', () => {
  const r = assessRun(undefined, undefined, { minFreeMb: 50 });
  assert.deepEqual(r, { verdict: "unknown", attributable: false, thresholdMb: 50, reason: "a headroom sample is missing" });
});
