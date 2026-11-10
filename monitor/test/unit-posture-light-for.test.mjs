// Traffic light for one approach (monitor/posture.mjs lightFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightFor } from '../posture.mjs';

test('returns grey when live is null', () => {
  const r = lightFor(null);
  assert.deepEqual(r, { light: "grey", why: "no live counts \u2014 the rollup has never spoken for this approach", inWindow: null });
});

test('returns grey when live is a string', () => {
  const r = lightFor('not-an-object');
  assert.deepEqual(r, { light: "grey", why: "no live counts \u2014 the rollup has never spoken for this approach", inWindow: null });
});

test('returns grey when ran is zero and no carried', () => {
  const r = lightFor({ ran: 0, skipped: 2, noscan: 1, lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000 });
  assert.deepEqual(r, { light: "grey", inWindow: true, why: "in scope on 3 repo(s), produced a scan on none (2 skipped, 1 noscan) \u2014 a coverage void, not a clean result" });
});

test('returns red when crit is present', () => {
  const r = lightFor({ ran: 1, skipped: 0, noscan: 0, crit: 2, high: 1, total: 5, lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000 });
  assert.deepEqual(r, { light: "red", inWindow: true, why: "5 finding(s) including 2 critical / 1 high" });
});

test('returns amber when hygiene is true and crit is present', () => {
  const r = lightFor({ ran: 1, skipped: 0, noscan: 0, crit: 2, high: 1, total: 5, lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000, hygiene: true });
  assert.deepEqual(r, { light: "amber", inWindow: true, why: "5 marker(s) \u2014 hygiene, deliberately excluded from the security headline" });
});

test('returns amber when total is present but no crit or high', () => {
  const r = lightFor({ ran: 1, skipped: 0, noscan: 0, crit: 0, high: 0, total: 3, lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000 });
  assert.deepEqual(r, { light: "amber", inWindow: true, why: "3 finding(s), none critical or high" });
});

test('returns amber when carried is true', () => {
  const r = lightFor({ ran: 1, skipped: 0, noscan: 0, crit: 0, high: 0, total: 0, carried: true, carriedFrom: 'abc', lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000 });
  assert.deepEqual(r, { light: "amber", inWindow: true, why: "not re-run by the latest sweep \u2014 this count is slice abc's and is carried until rescanned" });
});

test('returns amber when noscan is present and clean', () => {
  const r = lightFor({ ran: 1, skipped: 0, noscan: 2, crit: 0, high: 0, total: 0, lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000 });
  assert.deepEqual(r, { light: "amber", inWindow: true, why: "clean where it ran (1 repo(s)), but 2 repo(s) produced no scan at all" });
});

test('returns amber when inWindow is false', () => {
  const r = lightFor({ ran: 1, skipped: 0, noscan: 0, crit: 0, high: 0, total: 0, lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000 + 8 * 24 * 60 * 60 * 1000 });
  assert.deepEqual(r, { light: "green", inWindow: true, why: "ran on 1 of 1 in-scope repo(s) and found nothing (last run 2024-01-01T00:00:00Z)" });
});

test('returns green when ran and clean and in window', () => {
  const r = lightFor({ ran: 1, skipped: 0, noscan: 0, crit: 0, high: 0, total: 0, lastRunAt: '2024-01-01T00:00:00Z' }, { nowMs: 1700000000000 });
  assert.deepEqual(r, { light: "green", inWindow: true, why: "ran on 1 of 1 in-scope repo(s) and found nothing (last run 2024-01-01T00:00:00Z)" });
});
