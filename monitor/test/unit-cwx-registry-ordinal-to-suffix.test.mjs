// Converts a non-negative integer ordinal into a fixed-width base-10/16/36 suffix (monitor/cwx-registry.mjs ordinalToSuffix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordinalToSuffix } from '../cwx-registry.mjs';

test('rejects negative integers with a specific error', () => {
  assert.throws(() => ordinalToSuffix(-1), { name: 'Error', message: 'CWX ordinal must be a non-negative integer' });
});

test('rejects non-integer inputs with a specific error', () => {
  assert.throws(() => ordinalToSuffix(1.5), { name: 'Error', message: 'CWX ordinal must be a non-negative integer' });
});

test('returns zero-padded decimal for zero', () => {
  assert.equal(ordinalToSuffix(0), "000000");
});

test('returns zero-padded decimal for one', () => {
  assert.equal(ordinalToSuffix(1), "000001");
});

test('returns zero-padded decimal for the largest decimal value', () => {
  assert.equal(ordinalToSuffix(999999), "999999");
});

test('returns zero-padded hex for the first hex value', () => {
  assert.equal(ordinalToSuffix(1000000), "000000");
});

test('returns zero-padded hex for the largest hex value', () => {
  assert.equal(ordinalToSuffix(1000000 + 16 ** 6 - 1), "FFFFFF");
});

test('returns zero-padded base36 for the first base36 value', () => {
  assert.equal(ordinalToSuffix(1000000 + 16 ** 6), "000000");
});

test('returns zero-padded base36 for the largest base36 value', () => {
  assert.equal(ordinalToSuffix(1000000 + 16 ** 6 + 36 ** 6 - 1), "ZZZZZZ");
});

test('throws when the ordinal exceeds the supported space', () => {
  assert.throws(() => ordinalToSuffix(1000000 + 16 ** 6 + 36 ** 6), { name: 'Error', message: 'CWX space exhausted (>2.18e9) \u2014 extend the ladder' });
});
