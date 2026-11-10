// Classifies git fetch stderr into absent, not-permitted, or offline (bin/offbox-watch-check.mjs classifyFetchFailure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFetchFailure } from '../offbox-watch-check.mjs';

test('returns absent when stderr contains could not find remote ref', () => {
  const r = classifyFetchFailure("fatal: couldn't find remote ref main");
  assert.equal(r, "absent");
});

test('returns absent when stderr contains not found', () => {
  const r = classifyFetchFailure('fatal: remote branch not found');
  assert.equal(r, "absent");
});

test('returns not-permitted when stderr contains authentication', () => {
  const r = classifyFetchFailure('fatal: authentication failed');
  assert.equal(r, "not-permitted");
});

test('returns not-permitted when stderr contains permission denied', () => {
  const r = classifyFetchFailure('fatal: permission denied');
  assert.equal(r, "not-permitted");
});

test('returns not-permitted when stderr contains 403', () => {
  const r = classifyFetchFailure('HTTP 403 Forbidden');
  assert.equal(r, "not-permitted");
});

test('returns not-permitted when stderr contains could not read Username', () => {
  const r = classifyFetchFailure('could not read Username for origin');
  assert.equal(r, "not-permitted");
});

test('returns offline when stderr is empty', () => {
  const r = classifyFetchFailure('');
  assert.equal(r, "offline");
});

test('returns offline when stderr is generic network error', () => {
  const r = classifyFetchFailure('fatal: unable to access origin: Connection refused');
  assert.equal(r, "offline");
});

test('returns offline when stderr is repeated noise without keywords', () => {
  const r = classifyFetchFailure('x'.repeat(100));
  assert.equal(r, "offline");
});
