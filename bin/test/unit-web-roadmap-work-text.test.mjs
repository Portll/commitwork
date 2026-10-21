// Converts a conventional commit subject into a capitalized, HTML-escaped sentence (bin/web-roadmap.mjs workText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workText } from '../web-roadmap.mjs';

test('strips type, scope, and colon from a conventional subject', () => {
  assert.equal(workText('feat(api): add endpoint'), 'Add endpoint');
});

test('strips type with scope and exclamation mark', () => {
  assert.equal(workText('fix(core)!: resolve crash'), 'Resolve crash');
});

test('strips type without scope', () => {
  assert.equal(workText('docs: update readme'), 'Update readme');
});

test('strips type with scope but no exclamation mark', () => {
  assert.equal(workText('refactor(utils): clean up code'), 'Clean up code');
});

test('escapes ampersand characters', () => {
  assert.equal(workText('fix: handle & case'), 'Handle &amp; case');
});

test('escapes less-than characters', () => {
  assert.equal(workText('fix: check < value'), 'Check &lt; value');
});

test('escapes greater-than characters', () => {
  assert.equal(workText('fix: check > value'), 'Check &gt; value');
});

test('handles multiple special characters in one string', () => {
  assert.equal(workText('fix: a & b < c > d'), 'A &amp; b &lt; c &gt; d');
});

test('preserves already capitalized text after stripping prefix', () => {
  assert.equal(workText('feat: Already Capitalized'), 'Already Capitalized');
});

test('handles subject with no conventional prefix', () => {
  assert.equal(workText('update docs'), 'Update docs');
});
