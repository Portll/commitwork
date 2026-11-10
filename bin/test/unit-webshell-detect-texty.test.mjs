// Determines if a buffer is mostly printable text (bin/webshell-detect.mjs texty).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { texty } from '../webshell-detect.mjs';

test('returns false for an empty buffer', () => {
  assert.equal(texty(new Uint8Array(0)), false);
});

test('returns true for a buffer of only tab characters', () => {
  const buf = new Uint8Array(10).fill(9);
  assert.equal(texty(buf), true);
});

test('returns true for a buffer of only newline characters', () => {
  const buf = new Uint8Array(10).fill(10);
  assert.equal(texty(buf), true);
});

test('returns true for a buffer of only carriage return characters', () => {
  const buf = new Uint8Array(10).fill(13);
  assert.equal(texty(buf), true);
});

test('returns true for a buffer of only space characters', () => {
  const buf = new Uint8Array(10).fill(32);
  assert.equal(texty(buf), true);
});

test('returns true for a buffer of only tilde characters', () => {
  const buf = new Uint8Array(10).fill(126);
  assert.equal(texty(buf), true);
});

test('returns false for a buffer of only null bytes', () => {
  const buf = new Uint8Array(10).fill(0);
  assert.equal(texty(buf), false);
});

test('returns false for a buffer of only byte 31', () => {
  const buf = new Uint8Array(10).fill(31);
  assert.equal(texty(buf), false);
});

test('returns true for a buffer of only byte 160', () => {
  const buf = new Uint8Array(10).fill(160);
  assert.equal(texty(buf), true);
});

test('returns true for a buffer of only byte 255', () => {
  const buf = new Uint8Array(10).fill(255);
  assert.equal(texty(buf), true);
});
