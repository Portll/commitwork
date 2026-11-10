// Builds a measured record from an artifact path and raw value (bin/measured.mjs measuredFromArtifact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredFromArtifact } from '../measured.mjs';

test('returns ok true and exit 0 when raw is a non-null value', () => {
  const r = measuredFromArtifact('a.txt', 'hello', { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:a.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: true, exit: 0, digest: "sha256:2cf24dba5fb0a30e", detail: null });
});

test('returns ok false and exit 1 when raw is null', () => {
  const r = measuredFromArtifact('b.txt', null, { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:b.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: false, exit: 1, digest: null, detail: null });
});

test('returns ok false and exit 1 when raw is undefined', () => {
  const r = measuredFromArtifact('c.txt', undefined, { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:c.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: true, exit: 0, digest: null, detail: null });
});

test('returns ok true and exit 0 when raw is the string null', () => {
  const r = measuredFromArtifact('d.txt', 'null', { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:d.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: true, exit: 0, digest: "sha256:74234e98afe7498f", detail: null });
});

test('returns ok true and exit 0 when raw is an empty string', () => {
  const r = measuredFromArtifact('e.txt', '', { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:e.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: true, exit: 0, digest: "sha256:e3b0c44298fc1c14", detail: null });
});

test('returns ok false and exit 1 when raw is the number zero', () => {
  const r = measuredFromArtifact('f.txt', 0, { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:f.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: true, exit: 0, digest: "sha256:5feceb66ffc86f38", detail: null });
});

test('returns ok true and exit 0 when raw is the boolean false', () => {
  const r = measuredFromArtifact('g.txt', false, { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:g.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: true, exit: 0, digest: "sha256:fcbcf165908dd18a", detail: null });
});

test('returns ok true and exit 0 when raw is an empty object', () => {
  const r = measuredFromArtifact('h.txt', {}, { now: () => '2025-01-01T00:00:00Z' });
  assert.deepEqual(r, { source: "artifact:h.txt", at: "2025-01-01T00:00:00Z", ms: 0, ok: true, exit: 0, digest: "sha256:b28c94b2195c8ed2", detail: null });
});
