// Computes a truncated sha256 hex digest of a value (bin/measured.mjs digestOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestOf } from '../measured.mjs';

test('returns null when the input is null', () => {
  assert.equal(digestOf(null), null);
});

test('returns null when the input is undefined', () => {
  assert.equal(digestOf(undefined), null);
});

test('returns a sha256 prefix for a non-null string', () => {
  assert.equal(digestOf('hello'), "sha256:2cf24dba5fb0a30e");
});

test('returns a sha256 prefix for the empty string', () => {
  assert.equal(digestOf(''), "sha256:e3b0c44298fc1c14");
});

test('returns a sha256 prefix for a number', () => {
  assert.equal(digestOf(42), "sha256:73475cb40a568e8d");
});

test('returns a sha256 prefix for a boolean', () => {
  assert.equal(digestOf(true), "sha256:b5bea41b6c623f7c");
});

test('returns a sha256 prefix for a long repeated string', () => {
  assert.equal(digestOf('x'.repeat(100)), "sha256:09ecb6ebc8bcefc7");
});
