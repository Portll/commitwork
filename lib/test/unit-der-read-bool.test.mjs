// Reads a DER BOOLEAN value and returns true or false (lib/der.mjs readBool).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBool } from '../der.mjs';

test('returns true for a BOOLEAN node with content 0xff', () => {
  const node = { tag: 0x01, content: [0xff] };
  assert.equal(readBool(node), true);
});

test('returns false for a BOOLEAN node with content 0x00', () => {
  const node = { tag: 0x01, content: [0x00] };
  assert.equal(readBool(node), false);
});

test('throws DerError when node is null', () => {
  assert.throws(() => readBool(null), /BOOLEAN: missing/);
});

test('throws DerError when node tag is not BOOLEAN', () => {
  const node = { tag: 0x02, content: [0xff] };
  assert.throws(() => readBool(node), /BOOLEAN: expected tag 0x1, got 0x2/);
});

test('throws DerError when content length is 0', () => {
  const node = { tag: 0x01, content: [] };
  assert.throws(() => readBool(node), /BOOLEAN: not a DER BOOLEAN/);
});

test('throws DerError when content length is 2', () => {
  const node = { tag: 0x01, content: [0xff, 0x00] };
  assert.throws(() => readBool(node), /BOOLEAN: not a DER BOOLEAN/);
});

test('throws DerError when content byte is 0x01', () => {
  const node = { tag: 0x01, content: [0x01] };
  assert.throws(() => readBool(node), /BOOLEAN: not a DER BOOLEAN/);
});

test('throws DerError when content byte is 0xfe', () => {
  const node = { tag: 0x01, content: [0xfe] };
  assert.throws(() => readBool(node), /BOOLEAN: not a DER BOOLEAN/);
});

test('throws DerError when content byte is 0x02', () => {
  const node = { tag: 0x01, content: [0x02] };
  assert.throws(() => readBool(node), /BOOLEAN: not a DER BOOLEAN/);
});

test('uses custom what message in error when provided', () => {
  const node = { tag: 0x01, content: [0x01] };
  assert.throws(() => readBool(node, 'MY_BOOL'), /MY_BOOL: not a DER BOOLEAN/);
});
