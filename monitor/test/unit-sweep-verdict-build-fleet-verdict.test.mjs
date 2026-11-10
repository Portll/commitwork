// Fleet sweep verdict envelope with canary not-run reason (monitor/sweep-verdict.mjs buildFleetVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFleetVerdict } from '../sweep-verdict.mjs';

test('returns v 1 and kind sweep-fleet-verdict with at set to finishedAt', () => {
  const r = buildFleetVerdict({ stamp: 's1', group: 'g1', jobs: 3, areas: ['a'], finalize: { ok: true }, clean: 'clean', exit: 0, startedAt: 't0', finishedAt: 't1' });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s1", group: "g1", jobs: 3, areas: ["a"], finalize: { ok: true }, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "clean", exit: 0, startedAt: "t0", finishedAt: "t1" });
});

test('defaults areas to empty array and finalize to empty object when omitted', () => {
  const r = buildFleetVerdict({ stamp: 's2', group: 'g2', jobs: 1, clean: 'dirty', exit: 1, startedAt: 't0', finishedAt: 't1' });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s2", group: "g2", jobs: 1, areas: [], finalize: {}, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "dirty", exit: 1, startedAt: "t0", finishedAt: "t1" });
});

test('sets canary state to not-measured with fleet reason', () => {
  const r = buildFleetVerdict({ stamp: 's3', group: 'g3', jobs: 2, areas: [], finalize: {}, clean: 'unknown', exit: 0, startedAt: 't0', finishedAt: 't1' });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s3", group: "g3", jobs: 2, areas: [], finalize: {}, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "unknown", exit: 0, startedAt: "t0", finishedAt: "t1" });
});

test('defaults clean to unknown when not provided', () => {
  const r = buildFleetVerdict({ stamp: 's4', group: 'g4', jobs: 5, areas: ['x', 'y'], finalize: { done: 1 }, exit: 0, startedAt: 't0', finishedAt: 't1' });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s4", group: "g4", jobs: 5, areas: ["x", "y"], finalize: { done: 1 }, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "unknown", exit: 0, startedAt: "t0", finishedAt: "t1" });
});

test('strips root prefix from string values in areas when root is provided', () => {
  const r = buildFleetVerdict({ stamp: 's5', group: 'g5', jobs: 2, areas: ['/repo/sub/path', '/other'], finalize: {}, clean: 'clean', exit: 0, startedAt: 't0', finishedAt: 't1' }, { root: '/repo' });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s5", group: "g5", jobs: 2, areas: ["sub/path", "/other"], finalize: {}, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "clean", exit: 0, startedAt: "t0", finishedAt: "t1" });
});

test('preserves non-matching strings and strips root from nested object values', () => {
  const r = buildFleetVerdict({ stamp: 's6', group: 'g6', jobs: 1, areas: ['/keep', '/repo/inner'], finalize: { path: '/repo/deep', other: '/else' }, clean: 'clean', exit: 0, startedAt: 't0', finishedAt: 't1' }, { root: '/repo' });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s6", group: "g6", jobs: 1, areas: ["/keep", "inner"], finalize: { path: "deep", other: "/else" }, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "clean", exit: 0, startedAt: "t0", finishedAt: "t1" });
});

test('removes session and pid keys from nested objects during sanitization', () => {
  const r = buildFleetVerdict({ stamp: 's7', group: 'g7', jobs: 1, areas: [], finalize: { session: 'abc', pid: 123, keep: 'val' }, clean: 'clean', exit: 0, startedAt: 't0', finishedAt: 't1' }, { root: '/repo' });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s7", group: "g7", jobs: 1, areas: [], finalize: { keep: "val" }, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "clean", exit: 0, startedAt: "t0", finishedAt: "t1" });
});

test('handles null root by leaving all strings unchanged', () => {
  const r = buildFleetVerdict({ stamp: 's8', group: 'g8', jobs: 2, areas: ['/a/b', '/c/d'], finalize: { p: '/x/y' }, clean: 'clean', exit: 0, startedAt: 't0', finishedAt: 't1' }, { root: null });
  assert.deepEqual(r, { v: 1, kind: "sweep-fleet-verdict", at: "t1", stamp: "s8", group: "g8", jobs: 2, areas: ["/a/b", "/c/d"], finalize: { p: "/x/y" }, canary: { state: "not-measured", why: "the fleet parent does not run the canary; each scheduled area sweep records its own" }, clean: "clean", exit: 0, startedAt: "t0", finishedAt: "t1" });
});
