// Extracts text content from a message (bin/lib/turn-recorder-core.mjs textOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textOf } from '../lib/turn-recorder-core.mjs';

test('returns the string content directly when content is a string', () => {
  const input = { message: { content: 'hello' } };
  const r = textOf(input);
  assert.equal(r, "hello");
});

test('returns empty string when content is an array with no text blocks', () => {
  const input = { message: { content: [{ type: 'image' }] } };
  const r = textOf(input);
  assert.equal(r, "");
});

test('returns empty string when content is an array with a text block whose text is not a string', () => {
  const input = { message: { content: [{ type: 'text', text: 123 }] } };
  const r = textOf(input);
  assert.equal(r, "");
});

test('returns empty string when content is an array with a text block missing the text property', () => {
  const input = { message: { content: [{ type: 'text' }] } };
  const r = textOf(input);
  assert.equal(r, "");
});

test('joins multiple text blocks with newlines', () => {
  const input = { message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } };
  const r = textOf(input);
  assert.equal(r, "a\nb");
});

test('returns empty string when content is a number', () => {
  const input = { message: { content: 42 } };
  const r = textOf(input);
  assert.equal(r, "");
});

test('returns empty string when content is null', () => {
  const input = { message: { content: null } };
  const r = textOf(input);
  assert.equal(r, "");
});

test('returns empty string when message is undefined', () => {
  const input = {};
  const r = textOf(input);
  assert.equal(r, "");
});
