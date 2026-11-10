// Maps an attribution record to a display view with a classified who kind. (monitor/attribution.mjs annotationView).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationView } from '../attribution.mjs';

test('returns null when the input is null', () => {
  assert.deepEqual(annotationView(null), null);
});

test('returns null when the input is undefined', () => {
  assert.deepEqual(annotationView(undefined), null);
});

test('returns null when the input is an empty string', () => {
  assert.deepEqual(annotationView(''), null);
});

test('returns null when the input is zero', () => {
  assert.deepEqual(annotationView(0), null);
});

test('returns null when the input is false', () => {
  assert.deepEqual(annotationView(false), null);
});

test('returns a view with empty who and unknown kind when who is missing', () => {
  assert.deepEqual(annotationView({ action: 'allow', at: 1, reason: 'ok' }), { action: "allow", at: 1, reason: "ok", who: "", whoKind: "unknown" });
});

test('returns a view with empty who and unknown kind when who is an empty string', () => {
  assert.deepEqual(annotationView({ action: 'block', at: 2, reason: 'bad', who: '' }), { action: "block", at: 2, reason: "bad", who: "", whoKind: "unknown" });
});

test('returns a view with empty who and unknown kind when who is null', () => {
  assert.deepEqual(annotationView({ action: 'allow', at: 3, reason: 'ok', who: null }), { action: "allow", at: 3, reason: "ok", who: "", whoKind: "unknown" });
});

test('returns a view with empty who and unknown kind when who is undefined', () => {
  assert.deepEqual(annotationView({ action: 'allow', at: 4, reason: 'ok', who: undefined }), { action: "allow", at: 4, reason: "ok", who: "", whoKind: "unknown" });
});

test('returns a view with the who value and machine kind for a bot token', () => {
  assert.deepEqual(annotationView({ action: 'block', at: 5, reason: 'auto', who: 'renovate[bot]' }), { action: "block", at: 5, reason: "auto", who: "renovate[bot]", whoKind: "machine" });
});
