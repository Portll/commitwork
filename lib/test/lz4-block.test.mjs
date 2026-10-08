import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBlock, decompress, CANDIDATE_OFFSETS } from '../lz4-block.mjs';

/**
 * Blocks are hand-built here rather than round-tripped through a compressor: this repo has zero
 * runtime dependencies, so there is nothing to compress WITH. Hand-building is also the stronger
 * test — it pins the wire format itself, not "our encoder agrees with our decoder".
 */

/** token(litLen, matchLen) with the extension bytes the format requires. */
function seq(literals, { offset = 0, matchLen = 0 } = {}) {
  const lit = Buffer.from(literals, 'utf8');
  const litTok = Math.min(15, lit.length);
  const mTok = matchLen ? Math.min(15, matchLen - 4) : 0;
  const parts = [Buffer.from([(litTok << 4) | mTok])];
  if (lit.length >= 15) {
    let rest = lit.length - 15;
    const ext = [];
    while (rest >= 255) { ext.push(255); rest -= 255; }
    ext.push(rest);
    parts.push(Buffer.from(ext));
  }
  parts.push(lit);
  if (matchLen) {
    parts.push(Buffer.from([offset & 0xff, (offset >> 8) & 0xff]));
    if (matchLen - 4 >= 15) {
      let rest = matchLen - 4 - 15;
      const ext = [];
      while (rest >= 255) { ext.push(255); rest -= 255; }
      ext.push(rest);
      parts.push(Buffer.from(ext));
    }
  }
  return Buffer.concat(parts);
}

test('a literals-only block decodes to exactly its literals', () => {
  const b = seq('hello world');
  assert.equal(decodeBlock(b).toString('utf8'), 'hello world');
});

test('a long literal run crosses the 15-byte extension boundary', () => {
  const long = 'x'.repeat(300);
  assert.equal(decodeBlock(seq(long)).toString('utf8'), long);
});

test('a match copies from earlier output', () => {
  // "abcd" then a 4-byte match at offset 4 => "abcdabcd"
  const b = Buffer.concat([seq('abcd', { offset: 4, matchLen: 4 }), seq('!')]);
  assert.equal(decodeBlock(b).toString('utf8'), 'abcdabcd!');
});

test('an OVERLAPPING match is run-length expansion, not a stale slice', () => {
  // offset 1, matchLen 6 after "a" => "aaaaaaa". A slice-based copy yields the wrong bytes here,
  // which is the single most common way a hand-rolled LZ4 decoder is subtly wrong.
  const b = Buffer.concat([seq('a', { offset: 1, matchLen: 6 }), seq('z')]);
  assert.equal(decodeBlock(b).toString('utf8'), 'aaaaaaaz');
});

// ── The direction that lies to you ──────────────────────────────────────────
// A truncated blob must THROW. If it returned the bytes it managed to decode, a partial
// document would read as a complete one — the exact defect this module exists to expose.

test('a truncated literal run throws rather than returning a short string', () => {
  const full = seq('the quick brown fox jumps');
  assert.throws(() => decodeBlock(full.subarray(0, full.length - 6)), /past end|truncated/);
});

test('a match offset preceding the output start throws', () => {
  const b = seq('ab', { offset: 99, matchLen: 4 });
  assert.throws(() => decodeBlock(b), /precedes start/);
});

test('a zero match offset throws', () => {
  const b = seq('ab', { offset: 0, matchLen: 4 });
  // offset 0 is encoded literally as 0x0000 and is invalid in the format
  assert.throws(() => decodeBlock(Buffer.concat([b, Buffer.from([0])])), /zero match offset/);
});

test('maxOutput bounds a decompression bomb', () => {
  const b = Buffer.concat([seq('a', { offset: 1, matchLen: 1000 }), seq('z')]);
  assert.throws(() => decodeBlock(b, 0, { maxOutput: 64 }), /exceeds maxOutput/);
});

// ── decompress(): framing discovery and the accept() gate ───────────────────

test('decompress finds a raw block at offset 0', () => {
  const r = decompress(seq('plain text payload'));
  assert.equal(r.ok, true);
  assert.equal(r.offset, 0);
  assert.equal(r.text, 'plain text payload');
});

test('decompress skips a 4-byte size header to find the block', () => {
  const body = seq('after a header');
  const framed = Buffer.concat([Buffer.from([0xde, 0xad, 0xbe, 0xef]), body]);
  const r = decompress(framed, { accept: (s) => s.includes('after a header') });
  assert.equal(r.ok, true);
  assert.equal(r.offset, 4);
});

test('accept() rejects an offset that decodes without throwing but yields garbage', () => {
  // Without accept(), a wrong offset can parse cleanly and return nonsense. This is not
  // hypothetical: it is how the memory-layer blob first appeared to contain the whole document.
  const r = decompress(seq('real payload'), { accept: (s) => s.includes('NOT PRESENT') });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no candidate offset/);
  assert.ok(r.attempts.some((a) => /rejected by accept/.test(a.reason || '')));
});

test('an empty payload is a reported state, never an empty success', () => {
  const r = decompress('');
  assert.equal(r.ok, false);
  assert.equal(r.text, null);
  assert.match(r.reason, /empty/);
});

test('every attempt is reported, so a failure says what was tried', () => {
  const r = decompress(Buffer.from([0xff, 0xff, 0xff]));
  assert.equal(r.ok, false);
  // EVERY candidate is reported, including those past the end of a short input — an offset
  // silently dropped from the report is an offset nobody knows went untried.
  assert.equal(r.attempts.length, CANDIDATE_OFFSETS.length);
  for (const a of r.attempts) assert.ok(a.reason, 'each attempt carries a reason');
  assert.ok(r.attempts.some((a) => /past end/.test(a.reason)));
});
