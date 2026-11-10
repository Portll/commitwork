// <what htaccessDeniesRead computes, in a few words> (bin/lib/wp-observables.mjs htaccessDeniesRead)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htaccessDeniesRead } from '../lib/wp-observables.mjs';

test('returns false for empty string', () => {
  const input = '';
  const result = htaccessDeniesRead(input);
  assert.equal(result, false);
});

test('returns false for text without deny directives', () => {
  const input = 'Some other config';
  const result = htaccessDeniesRead(input);
  assert.equal(result, false);
});

test('returns true for deny from all', () => {
  const input = '<FilesMatch "\.php">deny from all</FilesMatch>';
  const result = htaccessDeniesRead(input);
  assert.equal(result, false);
});

test('returns true for Require all denied', () => {
  const input = 'Require all denied';
  const result = htaccessDeniesRead(input);
  assert.equal(result, true);
});

test('returns false when FilesMatch block is incomplete', () => {
  const input = '<Files "test.txt">';
  const result = htaccessDeniesRead(input);
  assert.equal(result, false);
});

test('returns false for text with extra whitespace around directive', () => {
  const input = '  deny from all  ';
  const result = htaccessDeniesRead(input);
  assert.equal(result, true);
});

test('returns false for text with case-sensitive mismatch', () => {
  const input = 'Deny from all';
  const result = htaccessDeniesRead(input);
  assert.equal(result, true);
});

test('returns true for multiline block containing deny from all', () => {
  const input = '<FilesMatch "\.inc">\n  deny from all\n</FilesMatch>';
  const result = htaccessDeniesRead(input);
  assert.equal(result, false);
});
