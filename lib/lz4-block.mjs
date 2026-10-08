/**
 * LZ4 block-format decompressor — zero dependencies, pure JS.
 *
 * The overwatch layer stores a record's full text as an lz4 blob in
 * `metadata.compressed_data` and returns only a ~400-byte preview in `content`.
 * Nothing on the wire decompresses it, so this is the only way back to the document.
 *
 * BLOCK format only (no frame magic, no checksums). Framing is not declared by the
 * producer, so `decompress` TRIES a set of leading-header offsets rather than
 * assuming one, and reports which worked.
 */

const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * Decode one raw LZ4 block starting at `start`.
 * Throws on any malformed sequence — a truncated blob must not yield a short string
 * that reads like a complete document.
 */
export function decodeBlock(src, start = 0, { maxOutput = MAX_OUTPUT } = {}) {
  const end = src.length;
  let ip = start;
  const out = [];
  let outLen = 0;

  const push = (buf) => {
    outLen += buf.length;
    if (outLen > maxOutput) throw new Error(`output exceeds maxOutput (${maxOutput})`);
    out.push(buf);
  };

  // Literals and matches are emitted into `out` as chunks; matches may reference bytes
  // emitted moments ago, so a flat buffer is kept alongside for back-references.
  let flat = Buffer.alloc(0);
  const sync = () => { if (out.length > 1 || flat.length !== outLen) { flat = Buffer.concat([flat, ...out.splice(0)]); } };

  while (ip < end) {
    const token = src[ip++];

    let litLen = token >> 4;
    if (litLen === 15) {
      let b;
      do {
        if (ip >= end) throw new Error('truncated literal length');
        b = src[ip++];
        litLen += b;
      } while (b === 255);
    }

    if (ip + litLen > end) throw new Error('literal run runs past end of block');
    if (litLen) push(src.subarray(ip, ip + litLen));
    ip += litLen;

    // A block legally ends on a literal run — no match follows the last one.
    if (ip >= end) break;
    if (ip + 2 > end) throw new Error('truncated match offset');

    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0) throw new Error('zero match offset');

    let matchLen = token & 0x0f;
    if (matchLen === 15) {
      let b;
      do {
        if (ip >= end) throw new Error('truncated match length');
        b = src[ip++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4;

    sync();
    if (offset > flat.length) throw new Error(`match offset ${offset} precedes start of output`);

    // Overlapping copy is legal and common (run-length encoding), so copy byte-wise
    // rather than slicing — a slice would read stale bytes when offset < matchLen.
    const m = Buffer.alloc(matchLen);
    let from = flat.length - offset;
    for (let i = 0; i < matchLen; i++) m[i] = from + i < flat.length ? flat[from + i] : m[from + i - flat.length];
    push(m);
    sync();
  }

  sync();
  return flat;
}

/** Header offsets seen in the wild: raw block, u32 size prefix, u64 size prefix. */
export const CANDIDATE_OFFSETS = Object.freeze([0, 4, 8]);

/**
 * Try each candidate framing and return the first that decodes cleanly AND passes
 * `accept`. Returns a result object rather than throwing: an undecodable blob is a
 * reportable state, not an exception the caller must guess the meaning of.
 *
 * @param {(s: string) => boolean} [accept] second gate beyond "did not throw" — a
 *   wrong offset can still decode without error and produce garbage.
 */
export function decompress(input, { offsets = CANDIDATE_OFFSETS, accept = null, maxOutput = MAX_OUTPUT } = {}) {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'base64');
  if (!src.length) return { ok: false, reason: 'empty compressed payload', buffer: null, text: null, offset: null, attempts: [] };

  const attempts = [];
  for (const off of offsets) {
    if (off >= src.length) { attempts.push({ offset: off, ok: false, reason: 'offset past end' }); continue; }
    let buf;
    try {
      buf = decodeBlock(src, off, { maxOutput });
    } catch (e) {
      attempts.push({ offset: off, ok: false, reason: e.message });
      continue;
    }
    const text = buf.toString('utf8');
    if (accept && !accept(text)) {
      attempts.push({ offset: off, ok: false, reason: 'decoded but rejected by accept()', bytes: buf.length });
      continue;
    }
    attempts.push({ offset: off, ok: true, bytes: buf.length });
    return { ok: true, reason: null, buffer: buf, text, offset: off, attempts };
  }
  return { ok: false, reason: 'no candidate offset decoded a usable block', buffer: null, text: null, offset: null, attempts };
}
