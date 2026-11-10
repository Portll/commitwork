// Reports free disk space and percentage of total (bin/lib/disk-headroom.mjs sampleHeadroom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleHeadroom } from '../lib/disk-headroom.mjs';

test('returns ok false and unknown true when statfs returns non-finite freeBytes', () => {
  const statfs = () => ({ bavail: NaN, bsize: 4096, blocks: 1000 });
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: false, unknown: true, path: "/tmp", reason: "statfs returned a non-finite size" });
});

test('returns ok true with null totalBytes and freePct when totalBytes is zero', () => {
  const statfs = () => ({ bavail: 100, bsize: 4096, blocks: 0 });
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: true, unknown: false, path: "/tmp", freeBytes: 409600, freeMb: 0, totalBytes: null, freePct: null });
});

test('returns ok true with computed totalBytes and freePct when totalBytes is positive', () => {
  const statfs = () => ({ bavail: 100, bsize: 4096, blocks: 1000 });
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: true, unknown: false, path: "/tmp", freeBytes: 409600, freeMb: 0, totalBytes: 4096000, freePct: 10 });
});

test('returns ok false with reason when statfs throws an error with code', () => {
  const statfs = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: false, unknown: true, path: "/tmp", reason: "statfs failed: EACCES" });
});

test('returns ok false with reason when statfs throws an error without code', () => {
  const statfs = () => { throw new Error('boom'); };
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: false, unknown: true, path: "/tmp", reason: "statfs failed: boom" });
});

test('returns ok true with freeMb floored when freeBytes is exactly one megabyte', () => {
  const statfs = () => ({ bavail: 256, bsize: 4096, blocks: 512 });
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: true, unknown: false, path: "/tmp", freeBytes: 1048576, freeMb: 1, totalBytes: 2097152, freePct: 50 });
});

test('returns ok false and unknown true when statfs returns non-finite freeBytes with unknown false edit', () => {
  const statfs = () => ({ bavail: Infinity, bsize: 4096, blocks: 1000 });
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: false, unknown: true, path: "/tmp", reason: "statfs returned a non-finite size" });
});

test('returns ok true with null totalBytes when totalBytes is non-finite', () => {
  const statfs = () => ({ bavail: 100, bsize: 4096, blocks: NaN });
  const r = sampleHeadroom({ path: '/tmp', statfs });
  assert.deepEqual(r, { ok: true, unknown: false, path: "/tmp", freeBytes: 409600, freeMb: 0, totalBytes: null, freePct: null });
});
