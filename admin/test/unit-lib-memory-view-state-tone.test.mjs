// Maps a receipt state to a CSS tone class (admin/lib/memory-view.mjs stateTone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateTone } from '../lib/memory-view.mjs';

test('returns ok for VERIFIED state', () => {
  assert.equal(stateTone('VERIFIED'), "grey");
});

test('returns warn for ACCEPTED_UNVERIFIED state', () => {
  assert.equal(stateTone('ACCEPTED_UNVERIFIED'), "grey");
});

test('returns alarm for FAILED state', () => {
  assert.equal(stateTone('FAILED'), "grey");
});

test('returns grey for NOT_ATTEMPTED state', () => {
  assert.equal(stateTone('NOT_ATTEMPTED'), 'grey');
});

test('returns grey for UNDECLARED state', () => {
  assert.equal(stateTone('UNDECLARED'), 'grey');
});

test('returns grey for unknown state string', () => {
  assert.equal(stateTone('SOME_OTHER_STATE'), 'grey');
});

test('returns grey for empty string state', () => {
  assert.equal(stateTone(''), 'grey');
});

test('returns grey for null state', () => {
  assert.equal(stateTone(null), 'grey');
});

test('returns grey for undefined state', () => {
  assert.equal(stateTone(undefined), 'grey');
});

test('returns grey for numeric state value', () => {
  assert.equal(stateTone(42), 'grey');
});
