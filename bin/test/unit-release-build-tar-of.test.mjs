// tar archive of given entries (bin/release-build.mjs tarOf)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tarOf } from '../release-build.mjs';
import { Buffer } from 'node:buffer';

function readString(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? len : nul).toString('utf8');
}
function readOctal(buf, off, len) {
  const str = readString(buf, off, len).trim();
  return str ? parseInt(str, 8) : 0;
}
function getHeader(buf, index) {
  const start = index * 512;
  const hdr = buf.subarray(start, start + 512);
  return {
    name: readString(hdr, 0, 100),
    mode: readOctal(hdr, 100, 8),
    size: readOctal(hdr, 124, 12),
    type: readString(hdr, 156, 1),
    linkname: readString(hdr, 157, 100),
  };
}

test('single short file creates directory then file entries in order', () => {
  const entries = [{ path: 'a.txt', mode: '100644', oid: '1' }];
  const blobs = new Map([['1', Buffer.from('hello')]]);
  const tar = tarOf(entries, blobs, { prefix: 'p', mtime: 0 });
  const hdr0 = getHeader(tar, 0);
  const hdr1 = getHeader(tar, 1);
  assert.equal(hdr0.name, 'p/');
  assert.equal(hdr0.type, '5');
  assert.equal(hdr1.name, 'p/a.txt');
  assert.equal(hdr1.type, '0');
  assert.equal(hdr1.size, 5);
});

test('file with long path creates a PaxHeader entry before the directory entry', () => {
  const longName = 'x'.repeat(101);
  const entries = [{ path: longName, mode: '100644', oid: '2' }];
  const blobs = new Map([['2', Buffer.alloc(0)]]);
  const tar = tarOf(entries, blobs, { prefix: 'pre', mtime: 0 });
  const hdr0 = getHeader(tar, 0);
  const hdr1 = getHeader(tar, 1);
  const hdr2 = getHeader(tar, 2);
  assert.equal(hdr0.name, 'pre/');
  assert.equal(hdr0.type, '5');
  assert.equal(hdr1.name, 'PaxHeader');
  assert.equal(hdr1.type, 'x');
  assert.equal(hdr2.name, "115 path=pre/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  assert.equal(hdr2.type, "");
});

test('symlink entry is encoded with type 2 and correct linkname without PaxHeader', () => {
  const entries = [{ path: 'link', mode: '120000', oid: '3' }];
  const target = 'target.txt';
  const blobs = new Map([['3', Buffer.from(target)]]);
  const tar = tarOf(entries, blobs, { prefix: 'pfx', mtime: 0 });
  const hdr0 = getHeader(tar, 0);
  const hdr1 = getHeader(tar, 1);
  assert.equal(hdr0.name, 'pfx/');
  assert.equal(hdr0.type, '5');
  assert.equal(hdr1.name, 'pfx/link');
  assert.equal(hdr1.type, '2');
  assert.equal(hdr1.linkname, target);
});

test('symlink with long target creates PaxHeader before the symlink entry', () => {
  const longTarget = 'y'.repeat(101);
  const entries = [{ path: 'ln', mode: '120000', oid: '4' }];
  const blobs = new Map([['4', Buffer.from(longTarget)]]);
  const tar = tarOf(entries, blobs, { prefix: 'pr', mtime: 0 });
  const hdr0 = getHeader(tar, 0);
  const hdr1 = getHeader(tar, 1);
  const hdr2 = getHeader(tar, 2);
  assert.equal(hdr0.name, 'pr/');
  assert.equal(hdr0.type, '5');
  assert.equal(hdr1.name, 'PaxHeader');
  assert.equal(hdr1.type, 'x');
  assert.equal(hdr2.name, "115 linkpath=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy");
  assert.equal(hdr2.type, "");
  assert.equal(hdr2.linkname, "");
});

test('file data is padded to the next 512\u2011byte block boundary', () => {
  const data = Buffer.from('abcde');
  const entries = [{ path: 'pad.txt', mode: '100644', oid: '5' }];
  const blobs = new Map([['5', data]]);
  const tar = tarOf(entries, blobs, { prefix: 'p', mtime: 0 });
  const hdrDir = getHeader(tar, 0);
  const hdrFile = getHeader(tar, 1);
  assert.equal(hdrDir.name, 'p/');
  assert.equal(hdrFile.name, 'p/pad.txt');
  const dataStart = 512 * 2;
  const fileData = tar.subarray(dataStart, dataStart + data.length);
  const padding = tar.subarray(dataStart + data.length, dataStart + 512);
  assert.deepEqual(fileData, data);
  assert.equal(padding.length, 512 - data.length);
  for (const b of padding) assert.equal(b, 0);
});

test('entries are sorted lexicographically by full path including directories', () => {
  const entries = [
    { path: 'b/file.txt', mode: '100644', oid: '6' },
    { path: 'a/file.txt', mode: '100644', oid: '7' },
  ];
  const blobs = new Map([
    ['6', Buffer.alloc(0)],
    ['7', Buffer.alloc(0)],
  ]);
  const tar = tarOf(entries, blobs, { prefix: 'root', mtime: 0 });
  const names = [];
  for (let i = 0; i < 5; i++) names.push(getHeader(tar, i).name);
  assert.deepEqual(names, [
    'root/',
    'root/a/',
    'root/a/file.txt',
    'root/b/',
    'root/b/file.txt',
  ]);
});
