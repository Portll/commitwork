// Detects whether a string is a plausible repository path (flow/static.mjs looksLikePath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePath } from '../static.mjs';

test('rejects non-string inputs', () => {
  assert.equal(looksLikePath(42), false);
});

test('rejects empty strings', () => {
  assert.equal(looksLikePath(''), false);
});

test('rejects strings longer than 200 characters', () => {
  assert.equal(looksLikePath('a'.repeat(201)), false);
});

test('accepts strings of exactly 200 characters with valid extension', () => {
  const s = 'a'.repeat(197) + '.md';
  assert.equal(looksLikePath(s), true);
});

test('rejects strings containing whitespace', () => {
  assert.equal(looksLikePath('foo bar.md'), false);
});

test('rejects strings containing glob characters', () => {
  assert.equal(looksLikePath('foo*.md'), false);
});

test('rejects strings containing question marks', () => {
  assert.equal(looksLikePath('foo?.md'), false);
});

test('rejects strings containing newlines', () => {
  assert.equal(looksLikePath('foo\nbar.md'), false);
});

test('rejects strings with URI schemes', () => {
  assert.equal(looksLikePath('node:fs'), false);
});

test('rejects strings with template literals', () => {
  assert.equal(looksLikePath('${foo}.md'), false);
});

test('rejects bare file extensions', () => {
  assert.equal(looksLikePath('.md'), false);
});

test('accepts file paths with known extensions', () => {
  assert.equal(looksLikePath('foo.md'), true);
});

test('accepts file paths with JavaScript extensions', () => {
  assert.equal(looksLikePath('foo.mjs'), true);
});

test('accepts paths in known repository directories', () => {
  assert.equal(looksLikePath('lib/foo'), true);
});

test('accepts paths with parent directory references', () => {
  assert.equal(looksLikePath('../lib/foo'), true);
});

test('rejects paths in unknown directories', () => {
  assert.equal(looksLikePath('unknown/foo'), false);
});

test('rejects paths without slashes or extensions', () => {
  assert.equal(looksLikePath('foo'), false);
});
