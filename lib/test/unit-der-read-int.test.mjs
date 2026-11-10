// readInt parses an ASN.1 INTEGER value (lib/der.mjs readInt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInt, TAG, DerError } from '../der.mjs';

function node(content, tag = TAG.INTEGER) {
  return { tag, content };
}

test('throws when node is missing', () => {
  assert.throws(() => readInt(undefined), {
    constructor: DerError,
    message: /missing/,
  });
});

test('throws when node has wrong tag', () => {
  const n = node(Buffer.from([0x00]), TAG.BOOLEAN);
  assert.throws(() => readInt(n), {
    constructor: DerError,
    message: /expected tag/,
  });
});

test('throws on empty content', () => {
  const n = node(Buffer.alloc(0));
  assert.throws(() => readInt(n), {
    constructor: DerError,
    message: /empty/,
  });
});

test('throws on non-minimal positive encoding (leading 0x00 with next byte < 0x80)', () => {
  const n = node(Buffer.from([0x00, 0x7f]));
  assert.throws(() => readInt(n), {
    constructor: DerError,
    message: /non-minimal encoding/,
  });
});

test('throws on non-minimal negative encoding (leading 0xff with next byte >= 0x80)', () => {
  const n = node(Buffer.from([0xff, 0x80]));
  assert.throws(() => readInt(n), {
    constructor: DerError,
    message: /non-minimal encoding/,
  });
});

test('accepts minimal positive encoding with leading 0x00 when next byte >= 0x80', () => {
  const n = node(Buffer.from([0x00, 0x80]));
  const v = readInt(n);
  assert.strictEqual(v, 128n);
});

test('accepts minimal negative encoding with leading 0xff when next byte < 0x80', () => {
  const n = node(Buffer.from([0xff, 0x7f]));
  const v = readInt(n);
  assert.strictEqual(v, -129n);
});

test('parses a single-byte positive integer', () => {
  const n = node(Buffer.from([0x2a]));
  const v = readInt(n);
  assert.strictEqual(v, 42n);
});

test('parses a multi-byte minimal positive integer', () => {
  const n = node(Buffer.from([0x01, 0x00]));
  const v = readInt(n);
  assert.strictEqual(v, 256n);
});

test('parses a single-byte negative integer', () => {
  const n = node(Buffer.from([0xff]));
  const v = readInt(n);
  assert.strictEqual(v, -1n);
});

test('parses a multi-byte minimal negative integer', () => {
  const n = node(Buffer.from([0xff, 0x00]));
  const v = readInt(n);
  assert.strictEqual(v, -256n);
});

test('parses a large positive integer using a generated buffer', () => {
  const buf = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(127, 0)]);
  const n = node(buf);
  const v = readInt(n);
  const expected = 1n << (8n * 127n);
  assert.strictEqual(v, expected);
});
