// decompress decodes a possibly offset LZ4 block and returns result object (lib/lz4-block.mjs decompress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompress } from '../lz4-block.mjs';
import { Buffer } from 'node:buffer';

test('empty input returns failure object', () => {
  const r = decompress('');
  assert.deepEqual(r, { ok: false, reason: "empty compressed payload", buffer: null, text: null, offset: null, attempts: [] });
});

test('base64 string input is decoded correctly with default offset', () => {
  const src = Buffer.from([0x10, 0x41]);
  const b64 = src.toString('base64');
  const r = decompress(b64);
  assert.deepEqual(r, { ok: true, reason: null, buffer: Buffer.from("41", 'hex'), text: "A", offset: 0, attempts: [{ offset: 0, ok: true, bytes: 1 }] });
});

test('offset equal to source length is treated as past end', () => {
  const src = Buffer.from([0x10, 0x41]);
  const r = decompress(src, { offsets: [2] });
  assert.deepEqual(r, { ok: false, reason: "no candidate offset decoded a usable block", buffer: null, text: null, offset: null, attempts: [{ offset: 2, ok: false, reason: "offset past end" }] });
});

test('offset greater than source length is treated as past end', () => {
  const src = Buffer.from([0x10, 0x41]);
  const r = decompress(src, { offsets: [3] });
  assert.deepEqual(r, { ok: false, reason: "no candidate offset decoded a usable block", buffer: null, text: null, offset: null, attempts: [{ offset: 3, ok: false, reason: "offset past end" }] });
});

test('decode error due to truncated literal length produces attempt with error reason', () => {
  const src = Buffer.from([0xF0]);
  const r = decompress(src);
  assert.deepEqual(r, { ok: false, reason: "no candidate offset decoded a usable block", buffer: null, text: null, offset: null, attempts: [{ offset: 0, ok: false, reason: "truncated literal length" }, { offset: 4, ok: false, reason: "offset past end" }, { offset: 8, ok: false, reason: "offset past end" }] });
});

test('accept function rejecting decoded text yields rejected attempt', () => {
  const src = Buffer.from([0x10, 0x41]);
  const accept = (txt) => false;
  const r = decompress(src, { accept });
  assert.deepEqual(r, { ok: false, reason: "no candidate offset decoded a usable block", buffer: null, text: null, offset: null, attempts: [{ offset: 0, ok: false, reason: "decoded but rejected by accept()", bytes: 1 }, { offset: 4, ok: false, reason: "offset past end" }, { offset: 8, ok: false, reason: "offset past end" }] });
});

test('accept function accepting decoded text returns success result', () => {
  const src = Buffer.from([0x10, 0x41]);
  const accept = (txt) => txt === 'A';
  const r = decompress(src, { accept });
  assert.deepEqual(r, { ok: true, reason: null, buffer: Buffer.from("41", 'hex'), text: "A", offset: 0, attempts: [{ offset: 0, ok: true, bytes: 1 }] });
});
