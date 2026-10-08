// commitwork monitor — the archive CONTAINER: framing, compression, encryption, and their inverses.
// Split from archive-batches.mjs so the format is testable without touching reports/ or the keychain.
//
// WHY FRAMES. Single-shot AES-256-GCM over a 500 MB archive authenticates only at the very end, and
// a naive chunked variant is TRUNCATABLE: drop the trailing frames and every remaining frame still
// verifies on its own. So each frame's AAD binds version || archiveId || frameIndex || isFinal, and
// the manifest — which carries the total frame count — is sealed INSIDE the ciphertext. Dropping a
// frame now fails three ways: the final flag never arrives, the index sequence has a hole, and the
// count disagrees.
//
// DETERMINISM CONTRACT, stated because this repo has one and it invites the opposite mistake:
// the PLAINTEXT container and the manifest are byte-deterministic (entries sorted, no clock).
// The CIPHERTEXT is NOT, and must never be — a deterministic or counter-derived IV under one key
// is catastrophic for GCM. CW_NOW must never reach IV derivation.

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { zstdCompressSync, zstdDecompressSync, constants as zc } from 'node:zlib';

export const MAGIC = Buffer.from('CWAR');
export const VERSION = 1;
export const IV_LEN = 12;
export const TAG_LEN = 16;
export const KEY_LEN = 32;
export const HEADER_LEN = MAGIC.length + 1 + 16; // magic || version || archiveId
export const DEFAULT_FRAME_BYTES = 8 * 1024 * 1024;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- plaintext container ---------------------------------------------------
// [4-byte header length][JSON header][payload]... repeated. The manifest is the LAST entry, so a
// reader that reaches it has necessarily read everything it describes.
export function packEntries(entries) {
  const out = [];
  for (const e of entries) {
    const head = Buffer.from(JSON.stringify({ path: e.path, size: e.data.length, sha256: sha256(e.data) }), 'utf8');
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(head.length, 0);
    out.push(len, head, e.data);
  }
  return Buffer.concat(out);
}

export function unpackEntries(buf) {
  const entries = [];
  let off = 0;
  while (off < buf.length) {
    if (off + 4 > buf.length) throw new Error(`container truncated in an entry length at byte ${off}`);
    const hl = buf.readUInt32BE(off); off += 4;
    if (off + hl > buf.length) throw new Error(`container truncated in an entry header at byte ${off}`);
    let head;
    try { head = JSON.parse(buf.subarray(off, off + hl).toString('utf8')); }
    catch (e) { throw new Error(`container entry header is not JSON at byte ${off}: ${e.message}`); }
    off += hl;
    if (off + head.size > buf.length) throw new Error(`container truncated in the payload of ${head.path}`);
    const data = buf.subarray(off, off + head.size); off += head.size;
    // Verify per entry, not just at the end — a wrong answer that looks right is the failure mode.
    const got = sha256(data);
    if (got !== head.sha256) throw new Error(`entry ${head.path} failed its own hash (declared ${head.sha256.slice(0, 12)}, got ${got.slice(0, 12)})`);
    entries.push({ path: head.path, data });
  }
  return entries;
}

const aad = (archiveId, frameIndex, isFinal) => {
  const b = Buffer.allocUnsafe(HEADER_LEN + 4 + 1);
  MAGIC.copy(b, 0);
  b.writeUInt8(VERSION, MAGIC.length);
  archiveId.copy(b, MAGIC.length + 1);
  b.writeUInt32BE(frameIndex, HEADER_LEN);
  b.writeUInt8(isFinal ? 1 : 0, HEADER_LEN + 4);
  return b;
};

/** Compress then frame-encrypt. Returns { buf, frames, archiveId }. */
export function sealArchive(plaintext, key, { frameBytes = DEFAULT_FRAME_BYTES, level = 3, archiveId = randomBytes(16) } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) throw new Error(`key must be ${KEY_LEN} raw bytes`);
  const packed = zstdCompressSync(plaintext, { params: { [zc.ZSTD_c_compressionLevel]: level } });
  const parts = [Buffer.concat([MAGIC, Buffer.from([VERSION]), archiveId])];
  let frames = 0;
  for (let off = 0; off < packed.length || frames === 0; off += frameBytes) {
    const chunk = packed.subarray(off, Math.min(off + frameBytes, packed.length));
    const isFinal = off + frameBytes >= packed.length;
    const iv = randomBytes(IV_LEN); // NEVER derived — see the determinism contract above
    const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
    c.setAAD(aad(archiveId, frames, isFinal));
    const body = Buffer.concat([c.update(chunk), c.final()]);
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(body.length, 0);
    parts.push(iv, len, body, c.getAuthTag());
    frames++;
    if (isFinal) break;
  }
  return { buf: Buffer.concat(parts), frames, archiveId };
}

/** Frame-decrypt then decompress. Throws — never returns partial plaintext. */
export function openArchive(buf, key, { expectFrames = null } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LEN) throw new Error(`key must be ${KEY_LEN} raw bytes`);
  if (buf.length < HEADER_LEN || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a commitwork archive (bad magic)');
  const version = buf.readUInt8(MAGIC.length);
  // Refuse an unknown version rather than guessing at its layout.
  if (version !== VERSION) throw new Error(`archive version ${version} is not readable by this build (expects ${VERSION})`);
  const archiveId = buf.subarray(MAGIC.length + 1, HEADER_LEN);
  const chunks = [];
  let off = HEADER_LEN, frames = 0, sawFinal = false;
  while (off < buf.length) {
    if (sawFinal) throw new Error('data after the final frame — the archive was appended to');
    if (off + IV_LEN + 4 > buf.length) throw new Error(`archive truncated in a frame header at byte ${off}`);
    const iv = buf.subarray(off, off + IV_LEN); off += IV_LEN;
    const len = buf.readUInt32BE(off); off += 4;
    if (off + len + TAG_LEN > buf.length) throw new Error(`archive truncated in frame ${frames} body`);
    const body = buf.subarray(off, off + len); off += len;
    const tag = buf.subarray(off, off + TAG_LEN); off += TAG_LEN;
    // isFinal is authenticated, so it cannot be flipped: try non-final, then final.
    let plain = null;
    for (const fin of [false, true]) {
      // Without authTagLength, setAuthTag would accept a truncated tag; the frame parse is the only bound.
      const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
      d.setAAD(aad(archiveId, frames, fin));
      d.setAuthTag(tag);
      try { plain = Buffer.concat([d.update(body), d.final()]); sawFinal = fin; break; } catch { /* try the other flag */ }
    }
    if (plain === null) throw new Error(`frame ${frames} failed authentication — wrong key, or the archive was altered`);
    chunks.push(plain);
    frames++;
  }
  if (!sawFinal) throw new Error('no final frame — the archive is TRUNCATED (this is the case a per-frame tag alone cannot catch)');
  if (expectFrames !== null && frames !== expectFrames) throw new Error(`frame count ${frames} does not match the ${expectFrames} the manifest declares`);
  return { plaintext: zstdDecompressSync(Buffer.concat(chunks)), frames, version };
}
