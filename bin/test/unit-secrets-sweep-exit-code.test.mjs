// Maps a scan result and failOnContext flag to a process exit code (bin/secrets-sweep.mjs exitCode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitCode } from '../secrets-sweep.mjs';

test('returns 2 when the result has any failures', () => {
  const r = exitCode({ failures: ['x'], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0, 'FALSE-POSITIVE': 0 } });
  assert.equal(r, 2);
});

test('returns 1 when the summary reports a real secret', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 1, 'SENSITIVE-CONTEXT': 0, 'FALSE-POSITIVE': 0 } });
  assert.equal(r, 1);
});

test('returns 1 when failOnContext is true and the summary reports sensitive context', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 1, 'FALSE-POSITIVE': 0 } }, { failOnContext: true });
  assert.equal(r, 1);
});

test('returns 0 when there are no failures, no secrets, and no context with failOnContext false', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0, 'FALSE-POSITIVE': 0 } });
  assert.equal(r, 0);
});

test('returns 0 when there are no failures, no secrets, and no context with failOnContext true', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0, 'FALSE-POSITIVE': 0 } }, { failOnContext: true });
  assert.equal(r, 0);
});

test('returns 0 when there are no failures, no secrets, and context is present but failOnContext is false', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 1, 'FALSE-POSITIVE': 0 } });
  assert.equal(r, 0);
});

test('returns 2 when the result has multiple failures', () => {
  const r = exitCode({ failures: ['a', 'b'], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0, 'FALSE-POSITIVE': 0 } });
  assert.equal(r, 2);
});

test('returns 1 when the summary reports multiple real secrets', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 2, 'SENSITIVE-CONTEXT': 0, 'FALSE-POSITIVE': 0 } });
  assert.equal(r, 1);
});

test('returns 1 when failOnContext is true and the summary reports multiple sensitive context entries', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 2, 'FALSE-POSITIVE': 0 } }, { failOnContext: true });
  assert.equal(r, 1);
});

test('returns 0 when there are no failures, no secrets, and multiple context entries with failOnContext false', () => {
  const r = exitCode({ failures: [], summary: { 'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 2, 'FALSE-POSITIVE': 0 } });
  assert.equal(r, 0);
});
