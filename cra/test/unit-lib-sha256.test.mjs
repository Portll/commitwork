// Computes the SHA-256 hex digest of a string (cra/lib.mjs sha256).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../lib.mjs';

test('returns the hex digest of an empty string', () => {
  const r = sha256('');
  assert.equal(r, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test('returns the hex digest of the string abc', () => {
  const r = sha256('abc');
  assert.equal(r, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test('returns the hex digest of a single space', () => {
  const r = sha256(' ');
  assert.equal(r, "36a9e7f1c95b82ffb99743e0c5c4ce95d83c9a430aac59f84ef3cbfab6145068");
});

test('returns the hex digest of a repeated character string', () => {
  const r = sha256('x'.repeat(100));
  assert.equal(r, "09ecb6ebc8bcefc733f6f2ec44f791abeed6a99edf0cc31519637898aebd52d8");
});

test('returns the hex digest of a string with unicode characters', () => {
  const r = sha256('h\u00e9llo');
  assert.equal(r, "3c48591d8d098a4538f5e013dfcf406e948eac4d3277b10bf614e295d6068179");
});

test('returns the hex digest of a long buffer-like string', () => {
  const r = sha256('a'.repeat(1024));
  assert.equal(r, "2edc986847e209b4016e141a6dc8716d3207350f416969382d431539bf292e4a");
});

test('returns the hex digest of a string with newlines', () => {
  const r = sha256('line1\nline2');
  assert.equal(r, "683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83");
});

test('returns the hex digest of a string with special characters', () => {
  const r = sha256('!@#$%^&*()');
  assert.equal(r, "95ce789c5c9d18490972709838ca3a9719094bca3ac16332cfec0652b0236141");
});
