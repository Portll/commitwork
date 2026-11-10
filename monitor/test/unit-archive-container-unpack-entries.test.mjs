// unpacks a sequence of length-prefixed JSON header and payload entries (monitor/archive-container.mjs unpackEntries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpackEntries } from '../archive-container.mjs';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const mk = (path, data) => {
  const h = JSON.stringify({ path, size: data.length, sha256: sha(data) });
  const hb = Buffer.from(h, 'utf8');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(hb.length);
  return Buffer.concat([lb, hb, data]);
};

test('returns an empty array for an empty buffer', () => {
  assert.deepEqual(unpackEntries(Buffer.alloc(0)), []);
});

test('returns the entry path and payload for a single valid entry', () => {
  const data = Buffer.from('hello');
  assert.deepEqual(unpackEntries(mk('a.txt', data)), [{ path: "a.txt", data: Buffer.from("68656c6c6f", 'hex') }]);
});

test('returns both entries in order for a buffer with two valid entries', () => {
  const d1 = Buffer.from('one');
  const d2 = Buffer.from('two');
  assert.deepEqual(unpackEntries(Buffer.concat([mk('x', d1), mk('y', d2)])), [{ path: "x", data: Buffer.from("6f6e65", 'hex') }, { path: "y", data: Buffer.from("74776f", 'hex') }]);
});

test('throws when the buffer is too short to hold an entry length', () => {
  assert.throws(() => unpackEntries(Buffer.from([0, 0, 0])), { name: 'Error', message: 'container truncated in an entry length at byte 0' });
});

test('throws when the buffer ends exactly at the entry length boundary', () => {
  assert.throws(() => unpackEntries(Buffer.alloc(4)), { name: "Error", message: "container entry header is not JSON at byte 4: Unexpected end of JSON input" });
});

test('throws when the buffer is too short to hold the entry header', () => {
  const lb = Buffer.alloc(4); lb.writeUInt32BE(10);
  assert.throws(() => unpackEntries(Buffer.concat([lb, Buffer.from('abc')])), { name: 'Error', message: 'container truncated in an entry header at byte 4' });
});

test('throws when the buffer ends exactly at the entry header boundary', () => {
  const h = JSON.stringify({ path: 'p', size: 0, sha256: sha(Buffer.alloc(0)) });
  const lb = Buffer.alloc(4); lb.writeUInt32BE(h.length);
  assert.deepStrictEqual(unpackEntries(Buffer.concat([lb, Buffer.from(h, 'utf8')])), [{ path: "p", data: Buffer.from("", 'hex') }]);
});

test('throws when the buffer is too short to hold the entry payload', () => {
  const h = JSON.stringify({ path: 'p', size: 10, sha256: sha(Buffer.alloc(10)) });
  const lb = Buffer.alloc(4); lb.writeUInt32BE(h.length);
  assert.throws(() => unpackEntries(Buffer.concat([lb, Buffer.from(h, 'utf8'), Buffer.from('abc')])), { name: 'Error', message: 'container truncated in the payload of p' });
});

test('throws when the buffer ends exactly at the entry payload boundary', () => {
  const h = JSON.stringify({ path: 'p', size: 3, sha256: sha(Buffer.alloc(3)) });
  const lb = Buffer.alloc(4); lb.writeUInt32BE(h.length);
  assert.throws(() => unpackEntries(Buffer.concat([lb, Buffer.from(h, 'utf8'), Buffer.from('abc')])), { name: "Error", message: "entry p failed its own hash (declared 709e80c88487, got ba7816bf8f01)" });
});

test('throws when the entry payload does not match its declared hash', () => {
  const data = Buffer.from('hello');
  const h = JSON.stringify({ path: 'a.txt', size: data.length, sha256: '0'.repeat(64) });
  const lb = Buffer.alloc(4); lb.writeUInt32BE(h.length);
  const hb = Buffer.from(h, 'utf8');
  const got = sha(data);
  assert.throws(() => unpackEntries(Buffer.concat([lb, hb, data])), { name: 'Error', message: `entry a.txt failed its own hash (declared ${'0'.repeat(64).slice(0, 12)}, got ${got.slice(0, 12)})` });
});
