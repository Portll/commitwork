// Removes HTML comment markers and their content from a string (lib/render-markdown.mjs stripComments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripComments } from '../render-markdown.mjs';

test('returns empty string for a complete comment', () => {
  assert.equal(stripComments('<!-- hello -->'), '');
});

test('returns empty string for a comment with newlines', () => {
  assert.equal(stripComments('<!--\nline1\nline2\n-->'), '');
});

test('returns empty string for a comment ending with --!>', () => {
  assert.equal(stripComments('<!-- bad --!>'), '');
});

test('returns empty string for a comment with overlapping dashes', () => {
  assert.equal(stripComments('<!-- --!>'), '');
});

test('returns empty string for multiple consecutive comments', () => {
  assert.equal(stripComments('<!-- a --><!-- b -->'), '');
});

test('preserves text before and after a comment', () => {
  assert.equal(stripComments('before <!-- comment --> after'), 'before  after');
});

test('returns unclosed comment start with trailing text', () => {
  assert.equal(stripComments('<!-- unclosed'), ' unclosed');
});

test('returns unclosed comment end with trailing space', () => {
  assert.equal(stripComments('text -->'), 'text ');
});

test('returns unclosed --!> with trailing space', () => {
  assert.equal(stripComments('text --!>'), 'text ');
});

test('returns input unchanged when no comment markers present', () => {
  assert.equal(stripComments('no comments here'), 'no comments here');
});
