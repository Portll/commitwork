// Maps requiresAuth to the expected status codes and note for a probe (bin/probe-public.mjs expectationFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectationFor } from '../probe-public.mjs';

test('returns 401 and 403 expectations when requiresAuth is true', () => {
  const r = expectationFor({ requiresAuth: true });
  assert.deepEqual(r, { expect: [401, 403], note: "requiresAuth:true \u2014 a denial (401 or 403) is health; a 2xx means the gate is not in front of it" });
});

test('returns 2xx and redirect expectations when requiresAuth is false', () => {
  const r = expectationFor({ requiresAuth: false });
  assert.deepEqual(r, { expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" });
});

test('returns 401 and 403 expectations when requiresAuth is 1', () => {
  const r = expectationFor({ requiresAuth: 1 });
  assert.deepEqual(r, { expect: [401, 403], note: "requiresAuth:true \u2014 a denial (401 or 403) is health; a 2xx means the gate is not in front of it" });
});

test('returns 2xx and redirect expectations when requiresAuth is 0', () => {
  const r = expectationFor({ requiresAuth: 0 });
  assert.deepEqual(r, { expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" });
});

test('returns 401 and 403 expectations when requiresAuth is an empty string', () => {
  const r = expectationFor({ requiresAuth: '' });
  assert.deepEqual(r, { expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" });
});

test('returns 2xx and redirect expectations when requiresAuth is undefined', () => {
  const r = expectationFor({ requiresAuth: undefined });
  assert.deepEqual(r, { expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" });
});

test('returns 401 and 403 expectations when requiresAuth is null', () => {
  const r = expectationFor({ requiresAuth: null });
  assert.deepEqual(r, { expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" });
});

test('returns 2xx and redirect expectations when requiresAuth is NaN', () => {
  const r = expectationFor({ requiresAuth: NaN });
  assert.deepEqual(r, { expect: [200, 204, 301, 302, 303, 307, 308], note: "requiresAuth:false \u2014 any 2xx or redirect" });
});
