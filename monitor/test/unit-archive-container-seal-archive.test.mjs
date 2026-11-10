// An AES-256-GCM framed archive of the level-3 zstd-compressed plaintext (monitor/archive-container.mjs sealArchive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealArchive } from '../archive-container.mjs';
import { createDecipheriv } from 'node:crypto';
import { zstdCompressSync, constants as zc } from 'node:zlib';

const KEY = Buffer.alloc(32, 7);
const ID = Buffer.alloc(16, 9);
const HEADER = Buffer.concat([Buffer.from('CWAR'), Buffer.from([1]), ID]);
const pack = (p) => zstdCompressSync(p, { params: { [zc.ZSTD_c_compressionLevel]: 3 } });

const aadOf = (i, fin) => {
  const b = Buffer.alloc(26);
  b.write('CWAR', 0, 'latin1');
  b[4] = 1;
  ID.copy(b, 5);
  b.writeUInt32BE(i, 21);
  b[25] = fin ? 1 : 0;
  return b;
};

const unseal = (buf, finals) => {
  const lens = [];
  const out = [];
  let off = 21;
  for (let i = 0; off < buf.length; i++) {
    const n = buf.readUInt32BE(off + 12);
    const d = createDecipheriv('aes-256-gcm', KEY, buf.subarray(off, off + 12), { authTagLength: 16 });
    d.setAAD(aadOf(i, finals[i]));
    d.setAuthTag(buf.subarray(off + 16 + n, off + 32 + n));
    out.push(d.update(buf.subarray(off + 16, off + 16 + n)), d.final());
    lens.push(n);
    off += 32 + n;
  }
  return { lens, packed: Buffer.concat(out) };
};

test('a 32-byte key seals a short buffer into one final frame holding the level-3 zstd stream', () => {
  const p = Buffer.from('hello commitwork');
  const z = pack(p);
  const r = sealArchive(p, KEY, { archiveId: ID });
  assert.equal(r.frames, 1);
  assert.equal(r.archiveId, ID);
  assert.equal(r.buf.length, 21 + 32 + z.length);
  assert.deepEqual(r.buf.subarray(0, 21), HEADER);
  assert.deepEqual(unseal(r.buf, [true]), { lens: [z.length], packed: z });
});

test('a frameBytes equal to or one above the packed length gives a single frame flagged final', () => {
  const p = Buffer.from('abcabcabc'.repeat(20));
  const z = pack(p);
  for (const frameBytes of [z.length, z.length + 1]) {
    const r = sealArchive(p, KEY, { archiveId: ID, frameBytes });
    assert.equal(r.frames, 1);
    assert.equal(r.buf.length, 53 + z.length);
    assert.deepEqual(r.buf.subarray(0, 21), HEADER);
    assert.deepEqual(unseal(r.buf, [true]), { lens: [z.length], packed: z });
  }
});

test('a frameBytes one below the packed length splits it into a non-final frame and a one-byte final frame', () => {
  const p = Buffer.from('abcabcabc'.repeat(20));
  const z = pack(p);
  const r = sealArchive(p, KEY, { archiveId: ID, frameBytes: z.length - 1 });
  assert.equal(r.frames, 2);
  assert.equal(r.buf.length, 21 + 64 + z.length);
  assert.deepEqual(unseal(r.buf, [false, true]), { lens: [z.length - 1, 1], packed: z });
});

test('a long text sealed with 1000-byte frames yields one frame per started kilobyte with only the last final', () => {
  const p = Buffer.from(Array.from({ length: 2000 }, (_, i) => `row ${i % 37} v${(i * 7919) % 1000}\n`).join(''));
  const z = pack(p);
  const count = Math.ceil(z.length / 1000);
  const lens = Array.from({ length: count }, (_, i) => Math.min(1000, z.length - i * 1000));
  const finals = lens.map((_, i) => i === count - 1);
  const r = sealArchive(p, KEY, { archiveId: ID, frameBytes: 1000 });
  assert.equal(r.frames, count);
  assert.equal(r.buf.length, 21 + 32 * count + z.length);
  assert.deepEqual(r.buf.subarray(0, 21), HEADER);
  assert.deepEqual(unseal(r.buf, finals), { lens, packed: z });
});

test('a frameBytes whose first step lands exactly on the packed end leaves the only frame non-final', () => {
  const p = Buffer.from('step');
  const z = pack(p);
  let calls = 0;
  const frameBytes = { valueOf: () => (calls++ === 1 ? 0 : z.length) };
  const r = sealArchive(p, KEY, { archiveId: ID, frameBytes });
  assert.equal(r.frames, 1);
  assert.equal(calls, 3);
  assert.equal(r.buf.length, 53 + z.length);
  assert.deepEqual(unseal(r.buf, [false]), { lens: [z.length], packed: z });
});

test('buffer keys of 16, 31 or 33 bytes are rejected with the key length message', () => {
  for (const n of [16, 31, 33]) {
    assert.throws(() => sealArchive(Buffer.from('x'), Buffer.alloc(n, 1), { archiveId: ID }), { name: 'Error', message: 'key must be 32 raw bytes' });
  }
});

test('a 32-character string key or a 32-byte Uint8Array key is rejected because it is not a Buffer', () => {
  for (const k of ['k'.repeat(32), new Uint8Array(32)]) {
    assert.throws(() => sealArchive(Buffer.from('x'), k, { archiveId: ID }), { name: 'Error', message: 'key must be 32 raw bytes' });
  }
});
