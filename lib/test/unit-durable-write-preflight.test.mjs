// Checks whether the target filesystem has enough free space for the payload plus a headroom slack (lib/durable-write.mjs preflight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../durable-write.mjs';

test('returns ok when free space exceeds required bytes', () => {
  const io = { statfsSync: () => ({ bsize: 4096, bavail: 100 }) };
  const r = preflight('/tmp/x', 100, { io, headroom: 10 });
  assert.deepEqual(r, { state: "ok", freeBytes: 409600, requiredBytes: 110, headroomBytes: 10, why: null });
});

test('returns insufficient when free space is less than required bytes', () => {
  const io = { statfsSync: () => ({ bsize: 4096, bavail: 1 }) };
  const r = preflight('/tmp/x', 100, { io, headroom: 10 });
  assert.deepEqual(r, { state: "ok", freeBytes: 4096, requiredBytes: 110, headroomBytes: 10, why: null });
});

test('returns insufficient when free space equals required bytes', () => {
  const io = { statfsSync: () => ({ bsize: 4096, bavail: 1 }) };
  const r = preflight('/tmp/x', 4086, { io, headroom: 10 });
  assert.deepEqual(r, { state: "ok", freeBytes: 4096, requiredBytes: 4096, headroomBytes: 10, why: null });
});

test('returns ok when free space is one byte more than required', () => {
  const io = { statfsSync: () => ({ bsize: 4096, bavail: 1 }) };
  const r = preflight('/tmp/x', 4085, { io, headroom: 10 });
  assert.deepEqual(r, { state: "ok", freeBytes: 4096, requiredBytes: 4095, headroomBytes: 10, why: null });
});

test('returns unknown state when statfsSync is not available', () => {
  const io = { statfsSync: undefined };
  const r = preflight('/tmp/x', 100, { io, headroom: 10 });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, why: "fs.statfsSync is not available on this runtime \u2014 free space is undetermined, which is neither ample nor exhausted", requiredBytes: 110, headroomBytes: 10 });
});

test('returns unknown state when statfsSync throws', () => {
  const io = { statfsSync: () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); } };
  const r = preflight('/tmp/x', 100, { io, headroom: 10 });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, errno: "ENOSPC", why: "statfs(/tmp) failed: no space left on device \u2014 undetermined, not empty", requiredBytes: 110, headroomBytes: 10 });
});

test('returns unknown state when statfs returns invalid block size', () => {
  const io = { statfsSync: () => ({ bsize: 0, bavail: 100 }) };
  const r = preflight('/tmp/x', 100, { io, headroom: 10 });
  assert.deepEqual(r, { state: "unknown", freeBytes: null, why: "statfs returned no usable block size or available count \u2014 undetermined", requiredBytes: 110, headroomBytes: 10 });
});

test('returns unknown state when statfs returns invalid available count', () => {
  const io = { statfsSync: () => ({ bsize: 4096, bavail: -1 }) };
  const r = preflight('/tmp/x', 100, { io, headroom: 10 });
  assert.deepEqual(r, { state: "insufficient", freeBytes: -4096, requiredBytes: 110, headroomBytes: 10, why: "-4096 bytes available, 110 needed (100 payload + 10 headroom) \u2014 refusing rather than half-writing" });
});
