// Resolves zizmor rule severity with pinned overrides (monitor/extractors/posture.mjs zizmorSev).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zizmorSev } from '../extractors/posture.mjs';

test('returns high for self-hosted-runner', () => {
  assert.equal(zizmorSev('self-hosted-runner', 'low'), 'high');
});

test('returns high for dangerous-triggers', () => {
  assert.equal(zizmorSev('dangerous-triggers', 'low'), 'high');
});

test('returns med for excessive-permissions', () => {
  assert.equal(zizmorSev('excessive-permissions', 'low'), 'med');
});

test('returns fallback for unknown rule', () => {
  assert.equal(zizmorSev('unknown-rule', 'low'), 'low');
});

test('returns fallback for undefined rule', () => {
  assert.equal(zizmorSev(undefined, 'low'), 'low');
});

test('returns fallback for empty string rule', () => {
  assert.equal(zizmorSev('', 'low'), 'low');
});

test('returns fallback for null rule', () => {
  assert.equal(zizmorSev(null, 'low'), 'low');
});

test('returns fallback for numeric rule', () => {
  assert.equal(zizmorSev(123, 'low'), 'low');
});
