// Validates that a DER node exists and has the expected tag (lib/der.mjs expect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expect, DerError } from '../der.mjs';

test('returns the node when tag matches', () => {
  const node = { tag: 0x02 };
  const result = expect(node, 0x02, 'integer');
  assert.strictEqual(result, node);
});

test('throws DerError when node is null', () => {
  assert.throws(() => expect(null, 0x02, 'integer'), DerError);
});

test('throws DerError when node is undefined', () => {
  assert.throws(() => expect(undefined, 0x02, 'integer'), DerError);
});

test('throws DerError when tag does not match', () => {
  const node = { tag: 0x03 };
  assert.throws(() => expect(node, 0x02, 'integer'), DerError);
});

test('throws DerError when a node with tag 0x10 does not match', () => {
  const node = { tag: 0x10 };
  assert.throws(() => expect(node, 0x02, 'integer'), DerError);
});

test('returns node when tag is zero and expected tag is zero', () => {
  const node = { tag: 0x00 };
  const result = expect(node, 0x00, 'custom');
  assert.strictEqual(result, node);
});

test('throws DerError when expected tag is zero but node has non-zero tag', () => {
  const node = { tag: 0x01 };
  assert.throws(() => expect(node, 0x00, 'custom'), DerError);
});
