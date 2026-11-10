// Computes the host disk headroom verdict from a sample and thresholds (bin/lib/disk-headroom.mjs assessHostHeadroom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessHostHeadroom } from '../lib/disk-headroom.mjs';

test('returns unknown when sample is null', () => {
  const r = assessHostHeadroom(null);
  assert.deepEqual(r, { warnPct: 15, failPct: 8, verdict: "unknown", healthy: false, reason: "no headroom sample" });
});

test('returns unknown when sample.ok is false with a reason', () => {
  const r = assessHostHeadroom({ ok: false, reason: 'statfs failed' });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, verdict: "unknown", healthy: false, reason: "statfs failed" });
});

test('returns unknown when freePct is null', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: null });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, verdict: "unknown", healthy: false, reason: "volume total for /dev/sda1 was unreadable, so free percentage is unknown" });
});

test('returns unknown when fail threshold exceeds warn threshold', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: 50, freeMb: 1024 }, { warnPct: 10, failPct: 20 });
  assert.deepEqual(r, { warnPct: 10, failPct: 20, verdict: "unknown", healthy: false, freePct: 50, reason: "thresholds inverted: fail 20% is above warn 10%" });
});

test('returns fail when freePct is below fail threshold', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: 5, freeMb: 512 }, { warnPct: 15, failPct: 8 });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, freePct: 5, freeMb: 512, path: "/dev/sda1", verdict: "fail", healthy: false, reason: "5.0% free, under the 8% floor" });
});

test('returns warn when freePct is between fail and warn thresholds', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: 10, freeMb: 1024 }, { warnPct: 15, failPct: 8 });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, freePct: 10, freeMb: 1024, path: "/dev/sda1", verdict: "warn", healthy: false, reason: "10.0% free, under the 15% warning line" });
});

test('returns ok when freePct is at or above warn threshold', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: 20, freeMb: 2048 }, { warnPct: 15, failPct: 8 });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, freePct: 20, freeMb: 2048, path: "/dev/sda1", verdict: "ok", healthy: true });
});

test('returns ok when freePct equals warn threshold exactly', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: 15, freeMb: 1536 }, { warnPct: 15, failPct: 8 });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, freePct: 15, freeMb: 1536, path: "/dev/sda1", verdict: "ok", healthy: true });
});

test('returns fail when freePct equals fail threshold minus epsilon', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: 7.9, freeMb: 800 }, { warnPct: 15, failPct: 8 });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, freePct: 7.9, freeMb: 800, path: "/dev/sda1", verdict: "fail", healthy: false, reason: "7.9% free, under the 8% floor" });
});

test('returns warn when freePct equals warn threshold minus epsilon', () => {
  const r = assessHostHeadroom({ ok: true, path: '/dev/sda1', freePct: 14.9, freeMb: 1500 }, { warnPct: 15, failPct: 8 });
  assert.deepEqual(r, { warnPct: 15, failPct: 8, freePct: 14.9, freeMb: 1500, path: "/dev/sda1", verdict: "warn", healthy: false, reason: "14.9% free, under the 15% warning line" });
});
