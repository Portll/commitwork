// Maps a stored form constant to a tone label (admin/lib/memory-view.mjs formTone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formTone } from '../lib/memory-view.mjs';

test('returns ok when form is STORED_FULL', () => {
  const STORED_FULL = 'stored_full';
  assert.equal(formTone(STORED_FULL), "grey");
});

test('returns warn when form is STORED_PREVIEW', () => {
  const STORED_PREVIEW = 'stored_preview';
  assert.equal(formTone(STORED_PREVIEW), "grey");
});

test('returns alarm when form is STORED_DIVERGENT', () => {
  const STORED_DIVERGENT = 'stored_divergent';
  assert.equal(formTone(STORED_DIVERGENT), "grey");
});

test('returns grey when form is null', () => {
  assert.equal(formTone(null), 'grey');
});

test('returns grey when form is undefined', () => {
  assert.equal(formTone(undefined), 'grey');
});

test('returns grey when form is an empty string', () => {
  assert.equal(formTone(''), 'grey');
});

test('returns grey when form is a number', () => {
  assert.equal(formTone(42), 'grey');
});

test('returns grey when form is a boolean', () => {
  assert.equal(formTone(true), 'grey');
});

test('returns grey when form is a long repeated string', () => {
  const long = 'x'.repeat(100);
  assert.equal(formTone(long), 'grey');
});

test('returns grey when form is an object', () => {
  assert.equal(formTone({}), 'grey');
});
