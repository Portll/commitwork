// admin/test/qrcode.test.mjs — proves the encoder in admin/static/qrcode.mjs actually decodes
// back to the original text. Encoding correctness cannot be trusted from "it ran without
// throwing" — a placement or masking bug produces a matrix that looks plausible and scans to
// garbage or nothing. This file is an independent decode path (reverse zigzag, reverse mask,
// Reed-Solomon error-correct, parse the byte-mode bit stream) written without reusing the
// encoder's own internals, so a bug in one path is not structurally hidden by the same bug in
// the other — the second-witness discipline this repo applies everywhere else, applied here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeQR } from '../static/qrcode.mjs';

// GF(256) tables, built independently of qrcode.mjs's own (same standard field, re-derived here
// on purpose rather than imported, so a bug in one build cannot silently agree with the other).
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function build() {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
const div = (a, b) => { if (b === 0) throw new Error('div by zero'); return a === 0 ? 0 : EXP[(LOG[a] - LOG[b] + 255) % 255]; };

function rsGenerator(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}

// Berlekamp-Massey + Chien search + Forney is a full RS decoder; this repo's QR use case never
// injects real transmission errors (it renders straight from the matrix it just built), so the
// decode side only needs syndrome verification (were the codewords ever mutated?) plus decoding
// of the systematic message — not full error correction. That is a legitimate, narrower check,
// and it is stated as such rather than passed off as a general-purpose decoder.
function verifySyndromeZero(codewords, ecCount) {
  const polyEval = (coeffsHighFirst, x) => { let y = 0; for (const c of coeffsHighFirst) y = mul(y, x) ^ c; return y; };
  for (let i = 0; i < ecCount; i++) {
    if (polyEval(codewords, EXP[i]) !== 0) return false;
  }
  return true;
}
void div; void rsGenerator;

// ISO/IEC 18004 Table 9, level M. THIS DECODER CARRIED THE ENCODER'S OWN TRANSCRIPTION ERRORS —
// v1 and v2 held their DATA codeword counts in the EC slot and v4 held 26 against a spec 18 — so it
// agreed with a symbol no camera could read, and every assertion below passed on broken output.
// A second witness that shares the first's table is not a second witness.
const VERSION_TABLE_M = {
  1: [26, 10, 1, 0], 2: [44, 16, 1, 0], 3: [70, 26, 1, 0], 4: [100, 18, 2, 0],
  5: [134, 24, 2, 0], 6: [172, 16, 4, 0], 7: [196, 18, 4, 0], 8: [242, 22, 2, 2],
  9: [292, 22, 3, 2], 10: [346, 26, 4, 1],
};
const ALIGNMENT_COORDS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const SIZE = (v) => 17 + v * 4;

function reservedMask(version) {
  const n = SIZE(version);
  const res = Array.from({ length: n }, () => new Array(n).fill(false));
  const mark = (r, c) => { if (r >= 0 && c >= 0 && r < n && c < n) res[r][c] = true; };
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) mark(r0 + dr, c0 + dc);
  for (let i = 8; i < n - 8; i++) { mark(6, i); mark(i, 6); }
  const coords = ALIGNMENT_COORDS[version] || [];
  for (const r0 of coords) for (const c0 of coords) {
    if ((r0 <= 8 && c0 <= 8) || (r0 <= 8 && c0 >= n - 9) || (r0 >= n - 9 && c0 <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r0 + dr, c0 + dc);
  }
  mark(n - 8, 8);
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, n - 1 - i); mark(n - 1 - i, 8); }
  if (version >= 7) for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) { mark(r, n - 11 + c); mark(n - 11 + c, r); }
  return res;
}

// Re-read the format info this module's own placement pattern used (top-left copy, the
// unambiguous one) to recover which of the 8 masks was applied — decoded independently of
// qrcode.mjs's own formatBits()/placeFormatInfo(), by directly reading the matrix bits back.
function readMask(mat, n) {
  const bits = [];
  for (let k = 0; k < 6; k++) bits.push(mat[8][k]);
  bits.push(mat[8][7]); bits.push(mat[8][8]); bits.push(mat[7][8]);
  for (let k = 9; k < 15; k++) bits.push(mat[14 - k][8]);
  // bits[0..14] = format bits, low-to-high per the encoder's own bit order; mask is bits 2-4
  // of the 5-bit (EC||mask) payload before BCH — but simplest robust readback: the encoder
  // wrote the same 15 bits at the bottom-left/top-right copy too; use the top-left copy as
  // written and undo the fixed XOR mask, then take the low 3 bits as the mask pattern index.
  // MSB-FIRST along the placement sequence: bit 14 sits at (8,0), bit 0 at (0,8). This read
  // LSB-first, matching the encoder's own reversed convention, so the two agreed with each
  // other and disagreed with every conformant reader. Verified against qrencode: its v1-M
  // output reads 0x5412 (mask 0) MSB-first and 0x2415 — in no format table — LSB-first.
  let raw = 0;
  for (let i = 0; i < 15; i++) raw |= bits[i] << (14 - i);
  const unmasked = raw ^ 0b101010000010010;
  // the 5-bit (EC-level<<3 | mask) payload occupies the HIGH bits of the 15-bit format
  // codeword (bits 14-10) — the low 10 bits are the BCH remainder, not part of the payload.
  return (unmasked >> 10) & 0b111;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function decode(qr, version) {
  const { size: n, modules } = qr;
  const res = reservedMask(version);
  const maskIdx = readMask(modules, n);
  const maskFn = MASKS[maskIdx];
  const unmasked = modules.map((row) => row.slice());
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!res[r][c] && maskFn(r, c)) unmasked[r][c] ^= 1;

  // reverse the exact zigzag walk the encoder used, reading bits in the same order they were written
  const bits = [];
  let col = n - 1, dir = -1;
  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const row = dir === -1 ? n - 1 - i : i;
      for (const c of [col, col - 1]) { if (res[row][c]) continue; bits.push(unmasked[row][c]); }
    }
    dir = -dir;
    col -= 2;
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }
  const [total, ecPerBlock, b1, b2] = VERSION_TABLE_M[version];
  const dataTotal = total - ecPerBlock * (b1 + b2);
  const blockCount = b1 + b2;
  const shortLen = Math.floor(dataTotal / blockCount);
  const longBlocks = dataTotal - shortLen * blockCount;
  const dataBlocks = [];
  for (let i = 0; i < blockCount; i++) dataBlocks.push(shortLen + (i >= blockCount - longBlocks ? 1 : 0));

  // de-interleave data codewords (column-major across blocks), then EC codewords per block
  const maxDataLen = Math.max(...dataBlocks);
  let p = 0;
  const dataOf = dataBlocks.map(() => []);
  for (let i = 0; i < maxDataLen; i++) for (let b = 0; b < blockCount; b++) if (i < dataBlocks[b]) dataOf[b].push(bytes[p++]);
  const ecOf = dataBlocks.map(() => []);
  for (let i = 0; i < ecPerBlock; i++) for (let b = 0; b < blockCount; b++) ecOf[b].push(bytes[p++]);

  for (let b = 0; b < blockCount; b++) {
    const codeword = dataOf[b].concat(ecOf[b]);
    assert.equal(verifySyndromeZero(codeword, ecPerBlock), true, `block ${b} failed its Reed-Solomon syndrome check — codewords do not form a valid RS block`);
  }

  const allData = dataOf.flat();
  const mode = allData[0] >> 4;
  assert.equal(mode, 0b0100, 'mode indicator must be byte mode (0100)');
  // Byte-mode count is 8 bits for versions 1-9 and SIXTEEN for 10+ (Table 3). Reading 8 everywhere
  // made every v10 symbol unreadable here while zbar read it fine — the decoder, not the encoder.
  // Bit-level rather than nibble-shuffling, so the two widths share one path.
  const bitsOf = [];
  for (const byte of allData) for (let k = 7; k >= 0; k--) bitsOf.push((byte >> k) & 1);
  let bp = 4; // mode indicator already consumed
  const take = (nBits) => { let v = 0; for (let i = 0; i < nBits; i++) v = (v << 1) | bitsOf[bp++]; return v; };
  const len = take(version >= 10 ? 16 : 8);
  const payload = [];
  for (let i = 0; i < len; i++) payload.push(take(8));
  return new TextDecoder().decode(new Uint8Array(payload));
}

test('encodeQR round-trips a short string through an independent decoder', () => {
  const text = 'HELLO';
  const qr = encodeQR(text);
  const back = decode(qr, pickVersionFor(text));
  assert.equal(back, text);
});

test('encodeQR round-trips a realistic otpauth:// URI', () => {
  // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- synthetic test value, not a credential
  const text = 'otpauth://totp/Commitwork:john%40portll.net?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Commitwork&algorithm=SHA1&digits=6&period=30';
  const qr = encodeQR(text);
  const back = decode(qr, pickVersionFor(text));
  assert.equal(back, text);
});

test('encodeQR throws rather than guessing when payload exceeds the supported version range', () => {
  const huge = 'x'.repeat(500);
  assert.throws(() => encodeQR(huge));
});

function pickVersionFor(text) {
  const byteLen = new TextEncoder().encode(text).length;
  for (let v = 1; v <= 10; v++) {
    const [total, ecPerBlock, b1, b2] = VERSION_TABLE_M[v];
    if (total - ecPerBlock * (b1 + b2) - 2 >= byteLen) return v;
  }
  throw new Error('no version fits');
}

// ── Known answers from the standard, not from this codebase ────────────────────────────────────
// The round-trip tests above cannot catch a convention this file and qrcode.mjs share: for months
// both used an LSB-first format order and a version table with three wrong EC counts, agreed
// perfectly, and produced symbols no camera would read. These assert against ISO/IEC 18004's own
// published tables — values neither module can influence — so a shared assumption fails loudly.

test('the version table matches ISO/IEC 18004 Table 9 for level M', () => {
  const SPEC = { 1:[26,10,1,0], 2:[44,16,1,0], 3:[70,26,1,0], 4:[100,18,2,0], 5:[134,24,2,0],
                 6:[172,16,4,0], 7:[196,18,4,0], 8:[242,22,2,2], 9:[292,22,3,2], 10:[346,26,4,1] };
  // Read the table out of qrcode.mjs itself. Asserting THIS file's copy proved nothing: the first
  // version of this test passed against the unfixed encoder, because both files' constants had
  // already been corrected here while the encoder's had not.
  const src = readFileSync(new URL('../static/qrcode.mjs', import.meta.url), 'utf8');
  const raw = /const VERSION_TABLE_M = \{([\s\S]*?)\};/.exec(src);
  assert.ok(raw, 'VERSION_TABLE_M not found in qrcode.mjs');
  const ENC = new Function('return {' + raw[1] + '}')();
  for (const [v, want] of Object.entries(SPEC)) {
    assert.deepEqual(ENC[v], want,
      `version ${v}: [total, EC-per-block, group1 blocks, group2 blocks] must match the spec — ` +
      'v1/v2 once carried their DATA counts in the EC slot and nothing noticed');
  }
});

test('format strings match the spec table, read MSB-first off a real symbol', () => {
  // Annex C, level M. The value is what a conformant reader must see.
  const M = { 0:0x5412, 1:0x5125, 2:0x5E7C, 3:0x5B4B, 4:0x45F9, 5:0x40CE, 6:0x4F97, 7:0x4AA0 };
  const qr = encodeQR('HELLO');
  const pos = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  const read = pos.reduce((acc, [r, c], i) => acc | ((qr.modules[r][c] ? 1 : 0) << (14 - i)), 0);
  assert.ok(Object.keys(M).some((k) => M[k] === read),
    `format string 0x${read.toString(16).toUpperCase()} is in no spec table — read MSB-first, ` +
    'bit 14 at (8,0). An LSB-first symbol yields 0x2415, which no reader accepts.');
});

test('the mandatory dark module and timing parity survive format reservation', () => {
  const qr = encodeQR('HELLO');
  const n = qr.size, v = (n - 17) / 4;
  assert.equal(qr.modules[4 * v + 9][8] ? 1 : 0, 1,
    'the dark module at (4*version+9, 8) is always set; format reservation used to clear it');
  for (let c = 8; c < n - 8; c++) {
    assert.equal(qr.modules[6][c] ? 1 : 0, c % 2 === 0 ? 1 : 0,
      `timing row 6 must alternate dark at even columns; (6,${c}) is wrong`);
  }
});

test('versions 7+ carry version information, matching Table D.1', () => {
  const SPEC = { 7:0x07C94, 8:0x085BC, 9:0x09A99, 10:0x0A4D3 };
  for (const v of [7, 8, 9, 10]) {
    const qr = encodeQR('Z'.repeat(30), { version: v });
    const n = qr.size;
    let bits = 0;
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3), c = i % 3;
      bits |= (qr.modules[r][n - 11 + c] ? 1 : 0) << i;
    }
    assert.equal(bits, SPEC[v],
      `version ${v}: the 18-bit version block was reserved and left BLANK until 2026-08-28, so ` +
      'v7-v10 shipped 36 empty modules and no conformant reader accepted them');
  }
});

test('the byte-mode count indicator widens to 16 bits at version 10', () => {
  // v10 failed at every payload length while v1-v9 passed: the count field is 8 bits for
  // versions 1-9 and 16 for 10+, and writing 8 everywhere shifts everything after it.
  const text = 'C'.repeat(40);
  const qr = encodeQR(text, { version: 10 });
  assert.equal(decode(qr, 10), text, 'a version 10 symbol must round-trip');
});
