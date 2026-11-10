// Computes a serializable snapshot of a dependency report (bin/lib/deps-ledger.mjs snapshotOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf } from '../lib/deps-ledger.mjs';

test('maps a report with no advisories and no deps to an empty snapshot', () => {
  const r = snapshotOf({ cooldown: 0, deps: [], advisories: { error: null, counts: { high: 0 }, prod: [], rows: [] } });
  assert.deepEqual(r, { cooldown: 0, deps: [], advisories: { counts: { high: 0 }, prod: [], rows: [] } });
});

test('maps a dep with updates and held entries preserving their fields', () => {
  const r = snapshotOf({
    cooldown: 5,
    deps: [{ name: 'a', kind: 'prod', locked: '1.0.0', lockedPublishedAt: 't1', latest: '2.0.0', latestPublishedAt: 't2', skipped: false, updates: [{ type: 'minor', version: '1.1.0', publishedAt: 't3' }], held: [{ type: 'major', version: '2.0.0', publishedAt: 't4', reason: 'r' }] }],
    advisories: { error: null, counts: { high: 1 }, prod: ['a'], rows: [{ name: 'a', severity: 'high', exposure: 'prod', fix: { state: 'fixed' } }] }
  });
  assert.deepEqual(r, { cooldown: 5, deps: [{ name: "a", kind: "prod", locked: "1.0.0", lockedPublishedAt: "t1", latest: "2.0.0", latestPublishedAt: "t2", skipped: false, updates: [{ type: "minor", version: "1.1.0", publishedAt: "t3" }], held: [{ type: "major", version: "2.0.0", publishedAt: "t4", reason: "r" }] }], advisories: { counts: { high: 1 }, prod: ["a"], rows: [{ name: "a", severity: "high", exposure: "prod", fix: "fixed" }] } });
});

test('maps advisories with an error to an error-only object', () => {
  const r = snapshotOf({ cooldown: 1, deps: [], advisories: { error: 'boom', counts: { high: 9 }, prod: ['x'], rows: [{ name: 'x', severity: 'high', exposure: 'prod', fix: { state: 'pending' } }] } });
  assert.deepEqual(r, { cooldown: 1, deps: [], advisories: { error: "boom" } });
});

test('maps advisories without error to counts, prod, and rows with fix state', () => {
  const r = snapshotOf({ cooldown: 2, deps: [], advisories: { error: null, counts: { high: 2, low: 1 }, prod: ['a', 'b'], rows: [{ name: 'a', severity: 'high', exposure: 'prod', fix: { state: 'fixed' } }, { name: 'b', severity: 'low', exposure: 'dev', fix: { state: 'pending' } }] } });
  assert.deepEqual(r, { cooldown: 2, deps: [], advisories: { counts: { high: 2, low: 1 }, prod: ["a", "b"], rows: [{ name: "a", severity: "high", exposure: "prod", fix: "fixed" }, { name: "b", severity: "low", exposure: "dev", fix: "pending" }] } });
});

test('maps a dep with empty updates and held arrays', () => {
  const r = snapshotOf({ cooldown: 3, deps: [{ name: 'b', kind: 'dev', locked: '0.1.0', lockedPublishedAt: 't1', latest: '0.2.0', latestPublishedAt: 't2', skipped: true, updates: [], held: [] }], advisories: { error: null, counts: { high: 0 }, prod: [], rows: [] } });
  assert.deepEqual(r, { cooldown: 3, deps: [{ name: "b", kind: "dev", locked: "0.1.0", lockedPublishedAt: "t1", latest: "0.2.0", latestPublishedAt: "t2", skipped: true, updates: [], held: [] }], advisories: { counts: { high: 0 }, prod: [], rows: [] } });
});

test('maps multiple deps and multiple advisories rows', () => {
  const r = snapshotOf({
    cooldown: 7,
    deps: [
      { name: 'x', kind: 'prod', locked: '1.0.0', lockedPublishedAt: 't1', latest: '1.1.0', latestPublishedAt: 't2', skipped: false, updates: [{ type: 'patch', version: '1.0.1', publishedAt: 't3' }], held: [] },
      { name: 'y', kind: 'dev', locked: '2.0.0', lockedPublishedAt: 't4', latest: '3.0.0', latestPublishedAt: 't5', skipped: true, updates: [], held: [{ type: 'major', version: '3.0.0', publishedAt: 't6', reason: 'incompatible' }] }
    ],
    advisories: { error: null, counts: { high: 1, medium: 1 }, prod: ['x'], rows: [{ name: 'x', severity: 'high', exposure: 'prod', fix: { state: 'fixed' } }, { name: 'y', severity: 'medium', exposure: 'dev', fix: { state: 'pending' } }] }
  });
  assert.deepEqual(r, { cooldown: 7, deps: [{ name: "x", kind: "prod", locked: "1.0.0", lockedPublishedAt: "t1", latest: "1.1.0", latestPublishedAt: "t2", skipped: false, updates: [{ type: "patch", version: "1.0.1", publishedAt: "t3" }], held: [] }, { name: "y", kind: "dev", locked: "2.0.0", lockedPublishedAt: "t4", latest: "3.0.0", latestPublishedAt: "t5", skipped: true, updates: [], held: [{ type: "major", version: "3.0.0", publishedAt: "t6", reason: "incompatible" }] }], advisories: { counts: { high: 1, medium: 1 }, prod: ["x"], rows: [{ name: "x", severity: "high", exposure: "prod", fix: "fixed" }, { name: "y", severity: "medium", exposure: "dev", fix: "pending" }] } });
});

test('throws a TypeError when report is null', () => {
  assert.throws(() => snapshotOf(null), { name: "TypeError", message: "Cannot read properties of null (reading 'advisories')" });
});

test('throws a TypeError when report is undefined', () => {
  assert.throws(() => snapshotOf(undefined), { name: "TypeError", message: "Cannot read properties of undefined (reading 'advisories')" });
});
