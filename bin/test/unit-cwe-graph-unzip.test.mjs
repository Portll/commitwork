// Lists the name and decompressed data of each zip entry via the central directory (bin/cwe-graph.mjs unzip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzip } from '../cwe-graph.mjs';
import { deflateRawSync } from 'node:zlib';

function endRecord(count, cdOffset) {
  const b = Buffer.alloc(22, 0);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(count, 8);
  b.writeUInt16LE(count, 10);
  b.writeUInt32LE(cdOffset, 16);
  return b;
}

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let lOff = 0;
  for (const { name, method, data } of entries) {
    const nameB = Buffer.from(name, 'utf8');
    const body = method === 8 ? deflateRawSync(data) : data;
    const l = Buffer.alloc(30 + nameB.length, 0);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(method, 8);
    l.writeUInt16LE(nameB.length, 26);
    nameB.copy(l, 30);
    const c = Buffer.alloc(46 + nameB.length, 0);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameB.length, 28);
    c.writeUInt32LE(lOff, 42);
    nameB.copy(c, 46);
    locals.push(l, body);
    centrals.push(c);
    lOff += l.length + body.length;
  }
  return Buffer.concat([...locals, ...centrals, endRecord(entries.length, lOff)]);
}

const asText = (r) => r.map((e) => ({ name: e.name, data: e.data.toString('utf8') }));

test('throws when a buffer of zeros has no end-of-central-directory record', () => {
  assert.throws(() => unzip(Buffer.alloc(100, 0)), {
    name: 'Error',
    message: 'not a zip: no end-of-central-directory record',
  });
});

test('throws when the buffer is one byte shorter than an end record', () => {
  assert.throws(() => unzip(Buffer.alloc(21, 0)), {
    name: 'Error',
    message: 'not a zip: no end-of-central-directory record',
  });
});

test('returns no entries for an empty archive that is exactly one end record', () => {
  assert.deepEqual(unzip(endRecord(0, 0)), []);
});

test('finds an end record followed by one trailing byte', () => {
  const buf = Buffer.concat([endRecord(0, 0), Buffer.alloc(1, 0)]);
  assert.deepEqual(unzip(buf), []);
});

test('finds an end record that starts 65999 bytes before the end of the buffer', () => {
  const buf = Buffer.concat([endRecord(0, 0), Buffer.alloc(65999 - 22, 0)]);
  assert.deepEqual(unzip(buf), []);
});

test('gives up on an end record that starts 66000 bytes before the end of the buffer', () => {
  const buf = Buffer.concat([endRecord(0, 0), Buffer.alloc(66000 - 22, 0)]);
  assert.throws(() => unzip(buf), {
    name: 'Error',
    message: 'not a zip: no end-of-central-directory record',
  });
});

test('extracts a stored and a deflated entry in order using central directory sizes when local sizes are zero', () => {
  const buf = buildZip([
    { name: 'a.txt', method: 0, data: Buffer.from('hello') },
    { name: 'b.txt', method: 8, data: Buffer.from('world world world') },
  ]);
  assert.deepEqual(asText(unzip(buf)), [
    { name: 'a.txt', data: 'hello' },
    { name: 'b.txt', data: 'world world world' },
  ]);
});

test('throws when the end record points at a local header instead of a central directory entry', () => {
  const buf = buildZip([{ name: 'n', method: 0, data: Buffer.from('v') }]);
  buf.writeUInt32LE(0, buf.length - 6);
  assert.throws(() => unzip(buf), {
    name: 'Error',
    message: 'bad central directory entry at 0',
  });
});
