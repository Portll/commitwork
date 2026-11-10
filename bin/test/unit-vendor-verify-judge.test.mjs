// Decides whether a vendored file matches its published provenance (bin/vendor-verify.mjs judge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../vendor-verify.mjs';
import { createHash } from 'node:crypto';

const sha512 = (b) => createHash('sha512').update(b).digest('hex');

test('returns UNVERIFIABLE when local read fails', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'e' };
  const local = { ok: false, why: 'read error' };
  const r = judge(item, null, local);
  assert.deepEqual(r, { path: 'a', pkg: 'p', version: '1', entry: 'e', state: 'UNVERIFIABLE', why: 'read error' });
});

test('returns UNVERIFIABLE when package result is null', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'e' };
  const buf = Buffer.from('hello');
  const local = { ok: true, buf };
  const r = judge(item, null, local);
  assert.equal(r.state, 'UNVERIFIABLE');
  assert.equal(r.why, 'package never resolved');
  assert.equal(r.localSize, 5);
  assert.equal(r.localSha512, sha512(buf));
});

test('returns UNVERIFIABLE when package result ok is false', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'e' };
  const buf = Buffer.from('world');
  const local = { ok: true, buf };
  const pkgResult = { ok: false, why: 'fetch failed' };
  const r = judge(item, pkgResult, local);
  assert.equal(r.state, 'UNVERIFIABLE');
  assert.equal(r.why, 'fetch failed');
  assert.equal(r.localSize, 5);
  assert.equal(r.localSha512, sha512(buf));
});

test('returns mismatch when entry missing from published files', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'missing' };
  const buf = Buffer.from('data');
  const local = { ok: true, buf };
  const pkgResult = { ok: true, anchor: 'abc', files: new Map([['other', Buffer.from('x')]]) };
  const r = judge(item, pkgResult, local);
  assert.equal(r.state, 'mismatch');
  assert.equal(r.anchor, 'abc');
  assert.equal(r.why, "published tarball p@1 contains no 'missing' \u2014 the claimed provenance does not exist");
  assert.equal(r.localSize, 4);
  assert.equal(r.localSha512, sha512(buf));
});

test('returns verified when local bytes match published bytes', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'e' };
  const buf = Buffer.from('identical');
  const local = { ok: true, buf };
  const pkgResult = { ok: true, anchor: 'xyz', files: new Map([['e', Buffer.from('identical')]]) };
  const r = judge(item, pkgResult, local);
  assert.equal(r.state, 'verified');
  assert.equal(r.why, 'byte-identical to p@1 e');
  assert.equal(r.localSize, 9);
  assert.equal(r.publishedSize, 9);
  assert.equal(r.localSha512, sha512(buf));
  assert.equal(r.publishedSha512, sha512(buf));
  assert.equal(r.anchor, 'xyz');
});

test('returns mismatch when local bytes differ from published bytes', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'e' };
  const localBuf = Buffer.from('aaaaa');
  const pubBuf = Buffer.from('bbbbb');
  const local = { ok: true, buf: localBuf };
  const pkgResult = { ok: true, anchor: 'def', files: new Map([['e', pubBuf]]) };
  const r = judge(item, pkgResult, local);
  assert.equal(r.state, 'mismatch');
  assert.equal(r.why, 'vendored bytes differ from p@1 e (5 vs 5 bytes)');
  assert.equal(r.localSize, 5);
  assert.equal(r.publishedSize, 5);
  assert.equal(r.localSha512, sha512(localBuf));
  assert.equal(r.publishedSha512, sha512(pubBuf));
  assert.equal(r.anchor, 'def');
});

test('returns mismatch with different sizes when bytes differ', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'e' };
  const localBuf = Buffer.from('short');
  const pubBuf = Buffer.from('much longer content');
  const local = { ok: true, buf: localBuf };
  const pkgResult = { ok: true, anchor: 'ghi', files: new Map([['e', pubBuf]]) };
  const r = judge(item, pkgResult, local);
  assert.equal(r.state, 'mismatch');
  assert.equal(r.why, 'vendored bytes differ from p@1 e (5 vs 19 bytes)');
  assert.equal(r.localSize, 5);
  assert.equal(r.publishedSize, 19);
});

test('returns verified for empty buffers that match', () => {
  const item = { path: 'a', pkg: 'p', version: '1', entry: 'e' };
  const buf = Buffer.alloc(0);
  const local = { ok: true, buf };
  const pkgResult = { ok: true, anchor: 'jkl', files: new Map([['e', Buffer.alloc(0)]]) };
  const r = judge(item, pkgResult, local);
  assert.equal(r.state, 'verified');
  assert.equal(r.localSize, 0);
  assert.equal(r.publishedSize, 0);
  assert.equal(r.why, 'byte-identical to p@1 e');
});
