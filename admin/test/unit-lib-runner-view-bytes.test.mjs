// converts a byte count to a human-readable string (admin/lib/runner-view.mjs bytes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytes } from '../lib/runner-view.mjs';

test('returns special string for "max"', () => {
  assert.equal(bytes('max'), "no limit");
});

test('returns bytes with unit B when value is less than 1024', () => {
  assert.equal(bytes(512), "512 B");
});

test('handles value exactly 1024 with original >= condition', () => {
  assert.equal(bytes(1024), "1.0 KiB");
});

test('handles value just below 1024 to take the false side of the loop condition', () => {
  assert.equal(bytes(1023), "1023 B");
});

test('returns KiB with one division when i starts at 0', () => {
  assert.equal(bytes(2048), "2.0 KiB");
});

test('returns KiB with one division when i would be 1 but return logic is altered', () => {
  assert.equal(bytes(1024), "1.0 KiB");
});

test('returns 0\u202fKiB when i is incorrectly initialized to 1', () => {
  assert.equal(bytes(0), "0 B");
});

test('stops looping after reaching the last unit (TiB) with original bounds', () => {
  assert.equal(bytes(1024 ** 4), "1.0 TiB");
});

test('continues looping one extra step when upper bound is increased', () => {
  assert.equal(bytes(1024 ** 5), "1024.0 TiB");
});

test('stops looping earlier when lower bound is decreased', () => {
  assert.equal(bytes(1024 ** 3), "1.0 GiB");
});
