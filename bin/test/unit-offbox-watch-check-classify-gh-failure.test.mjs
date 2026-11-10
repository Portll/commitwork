// Classifies GitHub CLI failure stderr into a verdict (bin/offbox-watch-check.mjs classifyGhFailure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyGhFailure } from '../offbox-watch-check.mjs';

test('returns not-permitted when stderr contains 401', () => {
  assert.equal(classifyGhFailure('HTTP 401 Unauthorized'), "not-permitted");
});

test('returns not-permitted when stderr contains 403', () => {
  assert.equal(classifyGhFailure('HTTP 403 Forbidden'), "not-permitted");
});

test('returns not-permitted when stderr contains authentication', () => {
  assert.equal(classifyGhFailure('authentication failed'), "not-permitted");
});

test('returns not-permitted when stderr contains not logged', () => {
  assert.equal(classifyGhFailure('not logged in'), "not-permitted");
});

test('returns not-permitted when stderr contains gh auth', () => {
  assert.equal(classifyGhFailure('run gh auth login'), "not-permitted");
});

test('returns not-permitted when stderr contains resource not accessible', () => {
  assert.equal(classifyGhFailure('resource not accessible'), "not-permitted");
});

test('returns offline when stderr contains could not resolve', () => {
  assert.equal(classifyGhFailure('could not resolve host'), "offline");
});

test('returns offline when stderr contains timed out', () => {
  assert.equal(classifyGhFailure('request timed out'), "offline");
});

test('returns offline when stderr contains network', () => {
  assert.equal(classifyGhFailure('network error'), "offline");
});

test('returns offline when stderr contains connection refused', () => {
  assert.equal(classifyGhFailure('connection refused'), "offline");
});

test('returns offline when stderr contains connection reset', () => {
  assert.equal(classifyGhFailure('connection reset by peer'), "offline");
});

test('returns offline when stderr contains dial tcp', () => {
  assert.equal(classifyGhFailure('dial tcp 127.0.0.1:443'), "offline");
});

test('returns failed when stderr is empty', () => {
  assert.equal(classifyGhFailure(''), "failed");
});

test('returns failed when stderr contains unrelated text', () => {
  assert.equal(classifyGhFailure('some other error'), "failed");
});
