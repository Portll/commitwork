// Computes session rows with optional redaction and fleet tokens (admin/routes/overwatch-layer.mjs sessionRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionRows } from '../routes/overwatch-layer.mjs';

test('returns error shape when sessionsRead is null', () => {
  const result = sessionRows(null, null, false);
  assert.deepEqual(result, { ok: false, why: "spine sessions unreadable", rows: [], fleet: null });
});

test('returns error shape when sessionsRead.ok is false with why', () => {
  const result = sessionRows({ ok: false, why: 'denied' }, null, false);
  assert.deepEqual(result, { ok: false, why: "denied", rows: [], fleet: null });
});

test('returns error shape when sessionsRead.ok is false without why', () => {
  const result = sessionRows({ ok: false }, null, false);
  assert.deepEqual(result, { ok: false, why: "spine sessions unreadable", rows: [], fleet: null });
});

test('returns redacted rows when full is false and agentsRead is ok', () => {
  const result = sessionRows({ ok: true, sessions: [] }, { ok: true, sessions: [] }, false);
  assert.deepEqual(result, { ok: true, redacted: true, fleet: { totals: { input: null, output: null, cacheRead: null, cacheCreation: null }, turns: 0, measured: 0, of: 0, unmeasured: [] }, rows: [] });
});

test('returns redacted rows when full is false and agentsRead is not ok', () => {
  const result = sessionRows({ ok: true, sessions: [] }, { ok: false }, false);
  assert.deepEqual(result, { ok: true, redacted: true, fleet: { totals: { input: null, output: null, cacheRead: null, cacheCreation: null }, turns: 0, measured: 0, of: 0, unmeasured: [] }, rows: [] });
});

test('returns unredacted rows when full is true', () => {
  const result = sessionRows({ ok: true, sessions: [] }, { ok: true, sessions: [] }, true);
  assert.deepEqual(result, { ok: true, rows: [], fleet: { totals: { input: null, output: null, cacheRead: null, cacheCreation: null }, turns: 0, measured: 0, of: 0, unmeasured: [] }, redacted: false });
});

test('returns redacted rows when full is false and agentsRead is null', () => {
  const result = sessionRows({ ok: true, sessions: [] }, null, false);
  assert.deepEqual(result, { ok: true, redacted: true, fleet: { totals: { input: null, output: null, cacheRead: null, cacheCreation: null }, turns: 0, measured: 0, of: 0, unmeasured: [] }, rows: [] });
});

test('returns unredacted rows when full is true and agentsRead is null', () => {
  const result = sessionRows({ ok: true, sessions: [] }, null, true);
  assert.deepEqual(result, { ok: true, rows: [], fleet: { totals: { input: null, output: null, cacheRead: null, cacheCreation: null }, turns: 0, measured: 0, of: 0, unmeasured: [] }, redacted: false });
});
