// Normalised body for identity comparison (bin/bola-run.mjs normBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normBody } from '../bola-run.mjs';

test('returns null when res is null', () => {
  assert.equal(normBody(null), null);
});

test('returns null when res is undefined', () => {
  assert.equal(normBody(undefined), null);
});

test('returns null when res is an empty object', () => {
  assert.equal(normBody({}), null);
});

test('returns null when text is a number', () => {
  assert.equal(normBody({ text: 42 }), null);
});

test('returns null when text is an object', () => {
  assert.equal(normBody({ text: {} }), null);
});

test('returns null when text is null', () => {
  assert.equal(normBody({ text: null }), null);
});

test('returns null when text is boolean true', () => {
  assert.equal(normBody({ text: true }), null);
});

test('returns trimmed single space for whitespace-only string', () => {
  assert.equal(normBody({ text: '   ' }), '');
});

test('collapses multiple spaces and newlines into single spaces', () => {
  const input = '  hello   world  \n\n  foo  ';
  assert.equal(normBody({ text: input }), 'hello world foo');
});

test('returns empty string for empty string input', () => {
  assert.equal(normBody({ text: '' }), '');
});
