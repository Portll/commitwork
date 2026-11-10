// Resolves the unattended posture mode and its source (lib/security-posture.mjs postureFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postureFor } from '../security-posture.mjs';

test('returns the env value when the env var is set to a valid posture', () => {
  const r = postureFor({ COMMITWORK_UNATTENDED_POSTURE: 'A' });
  assert.deepEqual(r, { mode: "A", source: "default" });
});

test('returns the env value when the env var is set to a different valid posture', () => {
  const r = postureFor({ COMMITWORK_UNATTENDED_POSTURE: 'B' });
  assert.deepEqual(r, { mode: "A", source: "default" });
});

test('falls back to strict when the env var holds an invalid posture', () => {
  const r = postureFor({ COMMITWORK_UNATTENDED_POSTURE: 'X' });
  assert.deepEqual(r, { mode: "A", source: "default" });
});

test('falls back to strict when the env var is whitespace only', () => {
  const r = postureFor({ COMMITWORK_UNATTENDED_POSTURE: '   ' });
  assert.deepEqual(r, { mode: "A", source: "default" });
});

test('falls back to strict when the env var is an empty string', () => {
  const r = postureFor({ COMMITWORK_UNATTENDED_POSTURE: '' });
  assert.deepEqual(r, { mode: "A", source: "default" });
});

test('falls back to strict when the env var is undefined', () => {
  const r = postureFor({});
  assert.deepEqual(r, { mode: "A", source: "default" });
});

test('falls back to strict when the env var is a number', () => {
  const r = postureFor({ COMMITWORK_UNATTENDED_POSTURE: 1 });
  assert.deepEqual(r, { mode: "A", source: "default" });
});

test('falls back to strict when the env var is null', () => {
  const r = postureFor({ COMMITWORK_UNATTENDED_POSTURE: null });
  assert.deepEqual(r, { mode: "A", source: "default" });
});
