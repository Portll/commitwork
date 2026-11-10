// Builds a void probe result object with state, ok, code, reason, and extra fields (bin/lib/probe-oracle.mjs probeVoid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeVoid } from '../lib/probe-oracle.mjs';

test('returns void state with ok false and given code and reason', () => {
  const r = probeVoid('E1', 'nope');
  assert.deepEqual(r, { state: "void", ok: false, code: "E1", reason: "nope" });
});

test('spreads extra fields into the result object', () => {
  const r = probeVoid('E2', 'why', { detail: 'x', n: 1 });
  assert.deepEqual(r, { state: "void", ok: false, code: "E2", reason: "why", detail: "x", n: 1 });
});

test('handles empty extra object without adding keys', () => {
  const r = probeVoid('E3', 'reason here', {});
  assert.deepEqual(r, { state: "void", ok: false, code: "E3", reason: "reason here" });
});

test('handles long code and reason strings', () => {
  const code = 'x'.repeat(100);
  const reason = 'y'.repeat(200);
  const r = probeVoid(code, reason);
  assert.deepEqual(r, { state: "void", ok: false, code: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", reason: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy" });
});

test('handles extra with multiple keys and nested values', () => {
  const r = probeVoid('E5', 'msg', { a: 1, b: 'two', c: [3, 4] });
  assert.deepEqual(r, { state: "void", ok: false, code: "E5", reason: "msg", a: 1, b: "two", c: [3, 4] });
});

test('handles unicode code and reason', () => {
  const r = probeVoid('ok', 'fine');
  assert.deepEqual(r, { state: "void", ok: false, code: "ok", reason: "fine" });
});

test('handles extra with boolean and null values', () => {
  const r = probeVoid('E7', 'r', { flag: true, val: null });
  assert.deepEqual(r, { state: "void", ok: false, code: "E7", reason: "r", flag: true, val: null });
});

test('handles single character inputs', () => {
  const r = probeVoid('a', 'b');
  assert.deepEqual(r, { state: "void", ok: false, code: "a", reason: "b" });
});
