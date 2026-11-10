// Whether source contains a format === '<fmt>' comparison for the literal fmt (bin/lib/format-contract.mjs hasBranch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasBranch } from '../lib/format-contract.mjs';

test('finds a strict equality branch on the given format', () => {
  assert.equal(hasBranch("if (format === 'json') { return 1; }", 'json'), true);
});

test('does not count a strict inequality comparison as a branch', () => {
  assert.equal(hasBranch("if (format !== 'json') { return 1; }", 'json'), false);
});

test('does not count a plain assignment of the format as a branch', () => {
  assert.equal(hasBranch("const format = 'json';", 'json'), false);
});

test('does not match a branch on a different format', () => {
  assert.equal(hasBranch("if (format === 'xml') { return 1; }", 'json'), false);
});

test('requires the closing quote so a prefix format does not match', () => {
  assert.equal(hasBranch("if (format === 'json') { return 1; }", 'js'), false);
});

test('treats a dot in the format as a literal character', () => {
  assert.equal(hasBranch("if (format === 'aXb') {}", 'a.b'), false);
  assert.equal(hasBranch("if (format === 'a.b') {}", 'a.b'), true);
});

test('matches formats containing parentheses brackets and a dollar sign literally', () => {
  assert.equal(hasBranch("if (format === 'v(1)[2]$') {}", 'v(1)[2]$'), true);
  assert.equal(hasBranch("if (format === 'v1X2X') {}", 'v(1)[2]$'), false);
});

test('matches a format containing a backslash literally', () => {
  assert.equal(hasBranch("if (format === 'a\\b') {}", 'a\\b'), true);
  assert.equal(hasBranch("if (format === 'ab') {}", 'a\\b'), false);
});

test('requires the exact spacing around the equality operator', () => {
  assert.equal(hasBranch("if (format==='json') {}", 'json'), false);
});

test('matches an empty format against an empty string literal', () => {
  assert.equal(hasBranch("if (format === '') {}", ''), true);
});
