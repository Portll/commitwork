// Builds a measurement record with timestamp, duration, status, exit code, digest, and detail (bin/measured.mjs measuredInProcess).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredInProcess } from '../measured.mjs';

test('returns ok true and exit 0 when ok defaults to true', () => {
  const r = measuredInProcess('src', 'data', { now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 0, ok: true, exit: 0, digest: "sha256:3a6eb0790f39ac87", detail: null });
});

test('returns ok false and exit 1 when ok is false', () => {
  const r = measuredInProcess('src', 'data', { ok: false, now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 0, ok: false, exit: 1, digest: "sha256:3a6eb0790f39ac87", detail: null });
});

test('returns ms 0 when ms defaults to 0', () => {
  const r = measuredInProcess('src', 'data', { now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 0, ok: true, exit: 0, digest: "sha256:3a6eb0790f39ac87", detail: null });
});

test('returns ms 1 when ms is 1', () => {
  const r = measuredInProcess('src', 'data', { ms: 1, now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 1, ok: true, exit: 0, digest: "sha256:3a6eb0790f39ac87", detail: null });
});

test('returns null digest when raw is null', () => {
  const r = measuredInProcess('src', null, { now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 0, ok: true, exit: 0, digest: null, detail: null });
});

test('returns null digest when raw is undefined', () => {
  const r = measuredInProcess('src', undefined, { now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 0, ok: true, exit: 0, digest: null, detail: null });
});

test('returns detail null when detail defaults to null', () => {
  const r = measuredInProcess('src', 'data', { now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 0, ok: true, exit: 0, digest: "sha256:3a6eb0790f39ac87", detail: null });
});

test('returns detail value when detail is provided', () => {
  const r = measuredInProcess('src', 'data', { detail: 'info', now: () => 'T' });
  assert.deepEqual(r, { source: "src", at: "T", ms: 0, ok: true, exit: 0, digest: "sha256:3a6eb0790f39ac87", detail: "info" });
});
