// Reads a single zip member's payload from a buffer, enforcing a size cap (bin/model-artefacts.mjs zipRead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipRead } from '../model-artefacts.mjs';
import { deflateRawSync } from 'node:zlib';

function makeZip(name, data, method, csize, usize, offset = 0) {
  const nameBuf = Buffer.from(name, 'utf8');
  const extraLen = 0;
  const header = Buffer.alloc(30 + nameBuf.length + extraLen);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(usize, 14);
  header.writeUInt32LE(csize, 18);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(extraLen, 28);
  nameBuf.copy(header, 30);
  const body = Buffer.from(data);
  const buf = Buffer.concat([header, body]);
  const m = { name, method, csize, usize, offset };
  return { buf, m };
}

test('returns stored data unchanged when method is 0', () => {
  const data = Buffer.from('hello world');
  const { buf, m } = makeZip('a.txt', data, 0, data.length, data.length);
  const out = zipRead(buf, m, 1024);
  assert.equal(out.toString(), 'hello world');
  assert.equal(out.length, 11);
});

test('inflates deflate-raw data when method is 8', () => {
  const original = Buffer.from('The quick brown fox jumps over the lazy dog');
  const compressed = deflateRawSync(original);
  const { buf, m } = makeZip('b.txt', compressed, 8, compressed.length, original.length);
  const out = zipRead(buf, m, 1024);
  assert.equal(out.toString(), original.toString());
});

test('throws when declared usize exceeds the cap', () => {
  const data = Buffer.alloc(10, 0);
  const { buf, m } = makeZip('big.bin', data, 0, 10, 100);
  assert.throws(() => zipRead(buf, m, 50), /declares 100 inflated bytes, over the 50-byte cap/);
});

test('throws when local header magic is wrong', () => {
  const data = Buffer.from('x');
  const { buf, m } = makeZip('c.txt', data, 0, 1, 1);
  buf.writeUInt32LE(0xdeadbeef, m.offset);
  assert.throws(() => zipRead(buf, m, 1024), /local header for c.txt unreadable/);
});

test('throws when offset plus 30 exceeds buffer length', () => {
  const buf = Buffer.alloc(10, 0);
  const m = { name: 'd.txt', method: 0, csize: 0, usize: 0, offset: 5 };
  assert.throws(() => zipRead(buf, m, 1024), /local header for d.txt unreadable/);
});

test('throws when compressed data runs past end of file', () => {
  const data = Buffer.from('abc');
  const { buf, m } = makeZip('e.txt', data, 0, 100, 3);
  assert.throws(() => zipRead(buf, m, 1024), /e.txt data runs past end of file/);
});

test('throws for unsupported compression method 1', () => {
  const data = Buffer.from('z');
  const { buf, m } = makeZip('f.txt', data, 1, 1, 1);
  assert.throws(() => zipRead(buf, m, 1024), /f.txt uses compression method 1/);
});

test('accepts usize exactly equal to cap', () => {
  const data = Buffer.alloc(50, 0);
  const { buf, m } = makeZip('g.bin', data, 0, 50, 50);
  const out = zipRead(buf, m, 50);
  assert.equal(out.length, 50);
});

test('throws when usize is one byte over cap', () => {
  const data = Buffer.alloc(51, 0);
  const { buf, m } = makeZip('h.bin', data, 0, 51, 51);
  assert.throws(() => zipRead(buf, m, 50), /declares 51 inflated bytes, over the 50-byte cap/);
});
