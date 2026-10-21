// Detects HDF5 signature at valid offsets (bin/model-artefacts.mjs isHdf5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHdf5 } from '../model-artefacts.mjs';

const SIG = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

test('returns true when signature is at offset 0', () => {
  const buf = Buffer.concat([SIG, Buffer.alloc(10, 0)]);
  assert.equal(isHdf5(buf), true);
});

test('returns false when buffer is shorter than 8 bytes', () => {
  const buf = Buffer.alloc(7, 0x89);
  assert.equal(isHdf5(buf), false);
});

test('returns false when buffer is exactly 8 bytes but not signature', () => {
  const buf = Buffer.alloc(8, 0x00);
  assert.equal(isHdf5(buf), false);
});

test('returns true when signature is at offset 512', () => {
  const buf = Buffer.alloc(520, 0x00);
  buf.set(SIG, 512);
  assert.equal(isHdf5(buf), true);
});

test('returns true when signature is at offset 1024', () => {
  const buf = Buffer.alloc(1032, 0x00);
  buf.set(SIG, 1024);
  assert.equal(isHdf5(buf), true);
});

test('returns false when signature is at invalid offset 1', () => {
  const buf = Buffer.alloc(10, 0x00);
  buf.set(SIG, 1);
  assert.equal(isHdf5(buf), false);
});

test('returns false when buffer is empty', () => {
  const buf = Buffer.alloc(0);
  assert.equal(isHdf5(buf), false);
});

test('returns true when signature is at offset 2048', () => {
  const buf = Buffer.alloc(2056, 0x00);
  buf.set(SIG, 2048);
  assert.equal(isHdf5(buf), true);
});
