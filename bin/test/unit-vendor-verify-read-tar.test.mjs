// Extracts wanted regular-file entries from a tar archive buffer (bin/vendor-verify.mjs readTar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTar } from '../vendor-verify.mjs';

function makeHeader(name, size, type = '0') {
  const h = Buffer.alloc(512);
  const nameBuf = Buffer.from(name, 'latin1');
  nameBuf.copy(h, 0);
  const sizeStr = size.toString(8).padStart(12, '0');
  Buffer.from(sizeStr, 'latin1').copy(h, 124);
  h[156] = type.charCodeAt(0);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  const sumStr = sum.toString(8).padStart(6, '0') + '\0 ';
  Buffer.from(sumStr, 'latin1').copy(h, 148);
  return h;
}

function makeEntry(name, data, type = '0') {
  const header = makeHeader(name, data.length, type);
  const dataBuf = Buffer.from(data);
  const padding = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length);
  return Buffer.concat([header, dataBuf, padding]);
}

function makeArchive(entries) {
  const end = Buffer.alloc(1024);
  return Buffer.concat([...entries, end]);
}

test('returns empty map when no entries match wanted', () => {
  const buf = makeArchive([makeEntry('a.txt', 'hello')]);
  const result = readTar(buf, new Set(['b.txt']));
  assert.equal(result.size, 0);
});

test('returns matching regular file entry', () => {
  const buf = makeArchive([makeEntry('a.txt', 'hello')]);
  const result = readTar(buf, new Set(['a.txt']));
  assert.equal(result.size, 1);
  assert.deepEqual(result.get('a.txt'), Buffer.from('hello'));
});

test('ignores directory entries even if name matches', () => {
  const buf = makeArchive([makeEntry('dir', '', '5')]);
  const result = readTar(buf, new Set(['dir']));
  assert.equal(result.size, 0);
});

test('throws on checksum mismatch', () => {
  const entry = makeEntry('a.txt', 'hello');
  entry[148] = 0x39;
  const buf = makeArchive([entry]);
  assert.throws(() => readTar(buf, new Set(['a.txt'])), /checksum mismatch/);
});

test('throws when entry runs past end of archive', () => {
  const header = makeHeader('a.txt', 1000);
  const data = Buffer.alloc(10);
  const buf = Buffer.concat([header, data]);
  assert.throws(() => readTar(buf, new Set(['a.txt'])), /runs past end/);
});

test('handles GNU long name type L', () => {
  const longName = 'x'.repeat(200);
  const lEntry = makeEntry('L', longName, 'L');
  const fEntry = makeEntry('short', 'data', '0');
  const buf = makeArchive([lEntry, fEntry]);
  const result = readTar(buf, new Set([longName]));
  assert.equal(result.size, 1);
  assert.deepEqual(result.get(longName), Buffer.from('data'));
});

test('handles pax path type x', () => {
  const paxPath = 'paxfile.txt';
  const paxRecord = `24 path=${paxPath}\n`;
  const paxEntry = makeEntry('x', paxRecord, 'x');
  const fEntry = makeEntry('ignored', 'content', '0');
  const buf = makeArchive([paxEntry, fEntry]);
  const result = readTar(buf, new Set([paxPath]));
  assert.equal(result.size, 1);
  assert.deepEqual(result.get(paxPath), Buffer.from('content'));
});

test('handles prefix field in header', () => {
  const header = Buffer.alloc(512);
  Buffer.from('file.txt', 'latin1').copy(header, 0);
  Buffer.from('dir', 'latin1').copy(header, 345);
  const sizeStr = '5'.padStart(12, '0');
  Buffer.from(sizeStr, 'latin1').copy(header, 124);
  header[156] = 0x30;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ', 'latin1').copy(header, 148);
  const data = Buffer.from('hello');
  const pad = Buffer.alloc(512 - 5);
  const buf = makeArchive([Buffer.concat([header, data, pad])]);
  const result = readTar(buf, new Set(['dir/file.txt']));
  assert.equal(result.size, 1);
  assert.deepEqual(result.get('dir/file.txt'), Buffer.from('hello'));
});

test('stops at end-of-archive marker', () => {
  const entry = makeEntry('a.txt', 'data');
  const buf = Buffer.concat([entry, Buffer.alloc(1024)]);
  const result = readTar(buf, new Set(['a.txt']));
  assert.equal(result.size, 1);
});
