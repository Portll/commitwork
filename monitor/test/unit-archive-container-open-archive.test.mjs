// Decrypts, authenticates and decompresses a framed commitwork archive (monitor/archive-container.mjs openArchive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openArchive } from '../archive-container.mjs';
import { createCipheriv } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';

const MAGIC = Buffer.from('CWAR');
const HEADER_LEN = 21;
const key = Buffer.alloc(32, 1);
const archiveId = Buffer.alloc(16, 2);

function header(version = 1) {
  const h = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(h, 0);
  h.writeUInt8(version, 4);
  archiveId.copy(h, 5);
  return h;
}

function frame(index, isFinal, plain) {
  const iv = Buffer.alloc(12, index + 3);
  const aad = Buffer.concat([header(), Buffer.alloc(5)]);
  aad.writeUInt32BE(index, HEADER_LEN);
  aad.writeUInt8(isFinal ? 1 : 0, HEADER_LEN + 4);
  const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  c.setAAD(aad);
  const body = Buffer.concat([c.update(plain), c.final()]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  return Buffer.concat([iv, len, body, c.getAuthTag()]);
}

const archive = (...frames) => Buffer.concat([header(), ...frames]);
const packed = zstdCompressSync(Buffer.from('hello world'));
const twoFrames = () => archive(frame(0, false, packed.subarray(0, 5)), frame(1, true, packed.subarray(5)));

test('rejects a key that is not a 32-byte Buffer', () => {
  const buf = archive(frame(0, true, packed));
  const err = { name: 'Error', message: 'key must be 32 raw bytes' };
  assert.throws(() => openArchive(buf, 'k'.repeat(32)), err);
  assert.throws(() => openArchive(buf, Buffer.alloc(31, 1)), err);
  assert.throws(() => openArchive(buf, Buffer.alloc(33, 1)), err);
});

test('rejects a buffer one byte shorter than the header or with the wrong magic', () => {
  const err = { name: 'Error', message: 'not a commitwork archive (bad magic)' };
  assert.throws(() => openArchive(header().subarray(0, HEADER_LEN - 1), key), err);
  const bad = archive(frame(0, true, packed));
  bad[0] = 0x63;
  assert.throws(() => openArchive(bad, key), err);
});

test('reports a missing final frame for a bare header and for a single non-final frame', () => {
  const err = { name: 'Error', message: 'no final frame \u2014 the archive is TRUNCATED (this is the case a per-frame tag alone cannot catch)' };
  assert.throws(() => openArchive(header(), key), err);
  assert.throws(() => openArchive(archive(frame(0, false, packed)), key), err);
});

test('refuses an archive version other than 1', () => {
  assert.throws(() => openArchive(Buffer.concat([header(2), frame(0, true, packed)]), key), { name: 'Error', message: 'archive version 2 is not readable by this build (expects 1)' });
  assert.throws(() => openArchive(header(0), key), { name: 'Error', message: 'archive version 0 is not readable by this build (expects 1)' });
});

test('locates truncation in the frame header or in the frame body', () => {
  assert.throws(() => openArchive(Buffer.concat([header(), Buffer.alloc(15)]), key), { name: 'Error', message: 'archive truncated in a frame header at byte 21' });
  assert.throws(() => openArchive(Buffer.concat([header(), Buffer.alloc(16)]), key), { name: 'Error', message: 'archive truncated in frame 0 body' });
  const one = archive(frame(0, true, packed));
  assert.throws(() => openArchive(one.subarray(0, one.length - 1), key), { name: 'Error', message: 'archive truncated in frame 0 body' });
  const two = twoFrames();
  assert.throws(() => openArchive(two.subarray(0, two.length - 1), key), { name: 'Error', message: 'archive truncated in frame 1 body' });
});

test('rejects bytes appended after the final frame', () => {
  const err = { name: 'Error', message: 'data after the final frame \u2014 the archive was appended to' };
  assert.throws(() => openArchive(archive(frame(0, true, packed), Buffer.alloc(1)), key), err);
  assert.throws(() => openArchive(archive(frame(0, true, packed), frame(1, true, packed)), key), err);
});

test('fails authentication under a wrong key, a tampered body or a tampered archive id', () => {
  const err = { name: 'Error', message: 'frame 0 failed authentication \u2014 wrong key, or the archive was altered' };
  const buf = archive(frame(0, true, packed));
  assert.throws(() => openArchive(buf, Buffer.alloc(32, 9)), err);
  const body = Buffer.from(buf);
  body[HEADER_LEN + 16] ^= 1;
  assert.throws(() => openArchive(body, key), err);
  const id = Buffer.from(buf);
  id[5] ^= 1;
  assert.throws(() => openArchive(id, key), err);
});

test('rejects a frame count that differs from expectFrames', () => {
  assert.throws(() => openArchive(twoFrames(), key, { expectFrames: 3 }), { name: 'Error', message: 'frame count 2 does not match the 3 the manifest declares' });
  assert.throws(() => openArchive(twoFrames(), key, { expectFrames: 1 }), { name: 'Error', message: 'frame count 2 does not match the 1 the manifest declares' });
});

test('reassembles and decompresses a two-frame archive whose count matches expectFrames', () => {
  const r = openArchive(twoFrames(), key, { expectFrames: 2 });
  assert.deepEqual({ text: r.plaintext.toString('utf8'), frames: r.frames, version: r.version }, { text: 'hello world', frames: 2, version: 1 });
  assert.deepEqual(Object.keys(r), ['plaintext', 'frames', 'version']);
});

test('opens a single final frame when expectFrames is left at its default', () => {
  const big = 'x'.repeat(1000);
  const r = openArchive(archive(frame(0, true, zstdCompressSync(Buffer.from(big)))), key);
  assert.deepEqual({ text: r.plaintext.toString('utf8'), frames: r.frames, version: r.version }, { text: big, frames: 1, version: 1 });
});
