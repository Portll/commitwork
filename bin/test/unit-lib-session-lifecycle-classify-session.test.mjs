// Classifies a session as live, idle, closed, disappeared, or unknown (bin/lib/session-lifecycle.mjs classifySession).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySession } from '../lib/session-lifecycle.mjs';

test('returns closed when a marker is present', () => {
  const r = classifySession({ hasMarker: true, hasSocket: true, lastRowAt: '2024-01-01T00:00:00Z', now: 1704067200000 });
  assert.equal(r, "closed");
});

test('returns live when socket is open and last row is within the active window', () => {
  const r = classifySession({ hasSocket: true, hasMarker: false, lastRowAt: '2024-01-01T00:00:00Z', now: 1704067200000 });
  assert.equal(r, "live");
});

test('returns idle when socket is open and last row is outside the active window', () => {
  const r = classifySession({ hasSocket: true, hasMarker: false, lastRowAt: '2024-01-01T00:00:00Z', now: 1704068200000 });
  assert.equal(r, "idle");
});

test('returns disappeared when no socket and last row is valid', () => {
  const r = classifySession({ hasSocket: false, hasMarker: false, lastRowAt: '2024-01-01T00:00:00Z', now: 1704067200000 });
  assert.equal(r, "disappeared");
});

test('returns unknown when no socket and no last row', () => {
  const r = classifySession({ hasSocket: false, hasMarker: false, lastRowAt: null, now: 1704067200000 });
  assert.equal(r, "unknown");
});

test('returns idle when socket is open and last row is invalid', () => {
  const r = classifySession({ hasSocket: true, hasMarker: false, lastRowAt: 'not-a-date', now: 1704067200000 });
  assert.equal(r, "idle");
});

test('returns disappeared when no socket and last row is invalid', () => {
  const r = classifySession({ hasSocket: false, hasMarker: false, lastRowAt: 'not-a-date', now: 1704067200000 });
  assert.equal(r, "unknown");
});

test('returns live when socket is open and last row is exactly at the active window boundary', () => {
  const r = classifySession({ hasSocket: true, hasMarker: false, lastRowAt: '2024-01-01T00:00:00Z', now: 1704068100000 });
  assert.equal(r, "live");
});
