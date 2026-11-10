// Detects per-path degradation between two touch snapshots (bin/lib/touch-chain.mjs chainDegradation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainDegradation } from '../lib/touch-chain.mjs';

test('returns ok true and empty degraded when after is null', () => {
  const before = { 'a.txt': { state: 'ok', broken: 0, torn: 0, examined: 1 } };
  const after = null;
  assert.deepEqual(chainDegradation(before, after), { ok: true, degraded: [] });
});

test('returns ok true and empty degraded when before is null', () => {
  const before = null;
  const after = { 'a.txt': { state: 'ok', broken: 0, torn: 0, examined: 1 } };
  assert.deepEqual(chainDegradation(before, after), { ok: true, degraded: [] });
});

test('flags a path that became unreadable', () => {
  const before = { 'a.txt': { state: 'ok', broken: 0, torn: 0, examined: 1 } };
  const after = { 'a.txt': { state: 'unreadable', broken: 0, torn: 0, examined: 1 } };
  assert.deepEqual(chainDegradation(before, after), { ok: false, degraded: [{ path: "a.txt", was: { state: "ok", broken: 0, torn: 0, examined: 1 }, now: { state: "unreadable", broken: 0, torn: 0, examined: 1 }, why: "became unreadable" }] });
});

test('does not flag a path that was already unreadable', () => {
  const before = { 'a.txt': { state: 'unreadable', broken: 0, torn: 0, examined: 1 } };
  const after = { 'a.txt': { state: 'unreadable', broken: 0, torn: 0, examined: 1 } };
  assert.deepEqual(chainDegradation(before, after), { ok: true, degraded: [] });
});

test('flags a path whose broken count increased', () => {
  const before = { 'a.txt': { state: 'ok', broken: 1, torn: 0, examined: 1 } };
  const after = { 'a.txt': { state: 'ok', broken: 2, torn: 0, examined: 1 } };
  assert.deepEqual(chainDegradation(before, after), { ok: false, degraded: [{ path: "a.txt", was: { state: "ok", broken: 1, torn: 0, examined: 1 }, now: { state: "ok", broken: 2, torn: 0, examined: 1 }, why: "broken 1 -> 2" }] });
});

test('does not flag a path whose broken count is equal', () => {
  const before = { 'a.txt': { state: 'ok', broken: 2, torn: 0, examined: 1 } };
  const after = { 'a.txt': { state: 'ok', broken: 2, torn: 0, examined: 1 } };
  assert.deepEqual(chainDegradation(before, after), { ok: true, degraded: [] });
});

test('flags a path whose torn count increased', () => {
  const before = { 'a.txt': { state: 'ok', broken: 0, torn: 1, examined: 1 } };
  const after = { 'a.txt': { state: 'ok', broken: 0, torn: 2, examined: 1 } };
  assert.deepEqual(chainDegradation(before, after), { ok: false, degraded: [{ path: "a.txt", was: { state: "ok", broken: 0, torn: 1, examined: 1 }, now: { state: "ok", broken: 0, torn: 2, examined: 1 }, why: "torn 1 -> 2" }] });
});

test('does not flag a path whose torn count is equal', () => {
  const before = { 'a.txt': { state: 'ok', broken: 0, torn: 2, examined: 1 } };
  const after = { 'a.txt': { state: 'ok', broken: 0, torn: 2, examined: 1 } };
  assert.deepEqual(chainDegradation(before, after), { ok: true, degraded: [] });
});

test('flags a path whose examined count dropped to zero', () => {
  const before = { 'a.txt': { state: 'ok', broken: 0, torn: 0, examined: 1 } };
  const after = { 'a.txt': { state: 'ok', broken: 0, torn: 0, examined: 0 } };
  assert.deepEqual(chainDegradation(before, after), { ok: false, degraded: [{ path: "a.txt", was: { state: "ok", broken: 0, torn: 0, examined: 1 }, now: { state: "ok", broken: 0, torn: 0, examined: 0 }, why: "examined 1 -> 0 (nothing left to verify)" }] });
});

test('does not flag a path whose examined count was already zero', () => {
  const before = { 'a.txt': { state: 'ok', broken: 0, torn: 0, examined: 0 } };
  const after = { 'a.txt': { state: 'ok', broken: 0, torn: 0, examined: 0 } };
  assert.deepEqual(chainDegradation(before, after), { ok: true, degraded: [] });
});
