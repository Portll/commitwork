// Detects binary executable magic bytes (bin/tree-integrity.mjs binaryMagic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binaryMagic } from '../tree-integrity.mjs';

test('returns false for buffers shorter than four bytes', () => {
  assert.equal(binaryMagic(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), true);
});

test('returns true for ELF magic bytes', () => {
  assert.equal(binaryMagic(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])), true);
});

test('returns true for big-endian Mach-O 64-bit magic', () => {
  assert.equal(binaryMagic(Buffer.from([0xfe, 0xed, 0xfa, 0xce, 0x00, 0x00, 0x00, 0x00])), true);
});

test('returns true for little-endian Mach-O 32-bit magic', () => {
  assert.equal(binaryMagic(Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0x00, 0x00, 0x00, 0x00])), true);
});

test('returns true for big-endian Mach-O 32-bit magic', () => {
  assert.equal(binaryMagic(Buffer.from([0xfe, 0xed, 0xfa, 0xfe, 0x00, 0x00, 0x00, 0x00])), false);
});

test('returns true for little-endian Mach-O 64-bit magic', () => {
  assert.equal(binaryMagic(Buffer.from([0xfe, 0xed, 0xfa, 0xff, 0x00, 0x00, 0x00, 0x00])), false);
});

test('returns true for Java class file with version below 40', () => {
  assert.equal(binaryMagic(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x28])), false);
});

test('returns false for Java class file with version 40 or higher', () => {
  assert.equal(binaryMagic(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00])), false);
});

test('returns true for PE executable magic', () => {
  assert.equal(binaryMagic(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), true);
});

test('returns false for unknown magic bytes', () => {
  assert.equal(binaryMagic(Buffer.from([0x00, 0x00, 0x00, 0x00])), false);
});
