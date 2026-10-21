// Parses a DER-encoded byte sequence into a node tree (lib/der.mjs decode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../der.mjs';

test('decodes a simple integer with a single-byte length', () => {
  const buf = Buffer.from([0x02, 0x01, 0x05]);
  const node = decode(buf);
  assert.equal(node.tag, 0x02);
  assert.equal(node.cls, 0);
  assert.equal(node.constructed, false);
  assert.equal(node.number, 2);
  assert.deepEqual(node.content, Buffer.from([0x05]));
  assert.equal(node.end, 3);
  assert.equal(node.raw.length, 3);
});

test('decodes a constructed sequence with two children', () => {
  const buf = Buffer.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
  const node = decode(buf);
  assert.equal(node.tag, 0x30);
  assert.equal(node.constructed, true);
  assert.equal(node.children.length, 2);
  assert.equal(node.children[0].tag, 0x02);
  assert.equal(node.children[0].content[0], 0x01);
  assert.equal(node.children[1].tag, 0x02);
  assert.equal(node.children[1].content[0], 0x02);
  assert.equal(node.end, 8);
});

test('decodes a length using two length bytes', () => {
  const buf = Buffer.from([0x04, 0x81, 0x80, ...Array(128).fill(0x00)]);
  const node = decode(buf);
  assert.equal(node.tag, 0x04);
  assert.equal(node.content.length, 128);
  assert.equal(node.end, 131);
});

test('throws on truncated header', () => {
  const buf = Buffer.from([0x02]);
  assert.throws(() => decode(buf), /truncated header at 0/);
});

test('throws on multi-byte tag', () => {
  const buf = Buffer.from([0x1f, 0x01, 0x00]);
  assert.throws(() => decode(buf), /multi-byte tag at 0 not supported/);
});

test('throws on indefinite length', () => {
  const buf = Buffer.from([0x02, 0x80]);
  assert.throws(() => decode(buf), /indefinite length at 0/);
});

test('throws on length field larger than four bytes', () => {
  const buf = Buffer.from([0x02, 0x85, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.throws(() => decode(buf), /length of 5 bytes at 0 too large/);
});

test('throws on non-minimal length encoding', () => {
  const buf = Buffer.from([0x02, 0x81, 0x00, 0x05]);
  assert.throws(() => decode(buf), /non-minimal length at 0/);
});

test('throws on element overrunning buffer', () => {
  const buf = Buffer.from([0x02, 0x05, 0x01, 0x02]);
  assert.throws(() => decode(buf), /element at 0 overruns its buffer/);
});

test('throws on trailing bytes after the element', () => {
  const buf = Buffer.from([0x02, 0x01, 0x05, 0x00]);
  assert.throws(() => decode(buf), /1 trailing byte\(s\) after the DER element/);
});
