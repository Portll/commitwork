// admin/static/qrcode.mjs — a self-contained QR Code encoder (ISO/IEC 18004), zero dependencies.
//
// Scope is deliberately narrow: byte-mode data only, error-correction level M, versions 1-10
// (up to 213 bytes of payload) — enough for an otpauth:// enrollment URI with margin, and small
// enough that the one table this file cannot derive algorithmically (alignment-pattern centres)
// stays short and checkable by eye. Anything longer throws rather than silently picking a version
// this file has not verified — fail loud, never guess, on a security-enrollment surface.
//
// Every other constant is COMPUTED, not transcribed, specifically to avoid the failure mode a
// hand-copied magic-number table invites: the Galois-field tables come from the field's own
// primitive polynomial, the Reed-Solomon generator polynomial comes from multiplying out its own
// roots, and the format/version information strings come from running the actual BCH division
// the spec defines — so a mistake here is a mistake in one of a handful of well-defined
// procedures, not a mistranscribed constant among hundreds.

// ---------------------------------------------------------------------------------------------
// GF(256) arithmetic, generated from the QR standard's primitive polynomial x^8+x^4+x^3+x^2+1
// (0x11D). exp[i] = 2^i in this field, log[exp[i]] = i for i in 0..254; exp is tabulated to 510
// so exp[i] for any non-negative i (even >254) can be read without a modulo on every multiply.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function buildGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

// Reed-Solomon generator polynomial of degree `ecCount`, built as the product
// (x - 2^0)(x - 2^1)...(x - 2^(ecCount-1)) over GF(256) — the standard construction, not a
// looked-up coefficient list. Returned highest-degree-first, length ecCount+1, leading term 1.
function rsGeneratorPoly(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// Polynomial long division in GF(256): message (highest-degree-first) divided by generator,
// remainder is the ecCount error-correction codewords. This IS Reed-Solomon encoding — systematic
// form, message unchanged, remainder appended.
function rsRemainder(messageBytes, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const buf = messageBytes.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < messageBytes.length; i++) {
    const coef = buf[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], coef);
  }
  return buf.slice(messageBytes.length);
}

// Self-check, run once at load: a codeword this module just built must have zero syndrome at
// every root the generator polynomial was built from. This is real, referenceless verification
// of the GF/RS layer — it does not depend on trusting a memorised external test vector, only on
// the algebraic property that a valid RS codeword evaluates to zero at each generator root.
(function selfCheckRS() {
  const msg = [32, 65, 205, 69, 41, 220, 46, 128, 236];
  const ec = rsRemainder(msg, 10);
  const codeword = msg.concat(ec);
  const polyEval = (coeffsHighFirst, x) => {
    let y = 0;
    for (const c of coeffsHighFirst) y = gfMul(y, x) ^ c;
    return y;
  };
  for (let i = 0; i < 10; i++) {
    const s = polyEval(codeword, GF_EXP[i]);
    if (s !== 0) throw new Error(`qrcode.mjs: Reed-Solomon self-check failed at root ${i} (syndrome ${s}, expected 0) — encoder is not trustworthy, refusing to run`);
  }
})();

// ---------------------------------------------------------------------------------------------
// Version capacity (byte mode, EC level M) and per-version geometry. Byte counts computed from
// the spec's per-version/per-EC-level codeword totals; the EC codeword counts and block
// structure below are the standard level-M table for versions 1-10 (ISO/IEC 18004 table 9),
// transcribed once, short enough to read every value against the spec directly.
//                        v: [totalCodewords, ecCodewordsPerBlock, blockCount1, blockCount2]
const VERSION_TABLE_M = {
  // [total codewords, EC codewords PER BLOCK, group-1 blocks, group-2 blocks] — ISO/IEC 18004
  // Table 9, level M. v1, v2 and v4 were transcribed wrong: v1 and v2 carried the DATA codeword
  // count in the EC slot (16 and 28, which are their data figures) and v4 carried 26 against a
  // spec 18. Every one produced a self-consistent symbol that no conformant reader accepts, and
  // the co-designed decoder in the test suite read the same wrong table and agreed.
  1: [26, 10, 1, 0], 2: [44, 16, 1, 0], 3: [70, 26, 1, 0], 4: [100, 18, 2, 0],
  5: [134, 24, 2, 0], 6: [172, 16, 4, 0], 7: [196, 18, 4, 0], 8: [242, 22, 2, 2],
  9: [292, 22, 3, 2], 10: [346, 26, 4, 1],
};
// Alignment-pattern centre coordinates per version (versions 2-10 each have exactly one pair of
// values, combined into a small grid — the spec's own table, versions 1-10 only, matching this
// module's declared range). Version 1 has none.
const ALIGNMENT_COORDS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const SIZE = (v) => 17 + v * 4;


function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const [total, ecPerBlock, b1, b2] = VERSION_TABLE_M[v];
    const dataCodewords = total - ecPerBlock * (b1 + b2);
    // 2 bytes mode+length overhead (both fit in one byte each for these versions), data must fit
    if (dataCodewords - 2 >= byteLen) return v;
  }
  throw new Error(`qrcode.mjs: payload too long for the versions this module supports (1-10, EC level M) — ${byteLen} bytes`);
}

function buildDataCodewords(text, version) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const [total, ecPerBlock, b1, b2] = VERSION_TABLE_M[version];
  const dataCodewords = total - ecPerBlock * (b1 + b2);
  // Byte-mode character-count indicator is 8 bits for versions 1-9 and SIXTEEN for 10 and up
  // (ISO/IEC 18004 Table 3). Writing 8 everywhere produced a v10 symbol whose length field
  // every conformant reader parses as 16 bits, so the count and all following data shifted.
  // v1-v9 were unaffected, which is why the defect looked version-specific and structural.
  const countBits = version >= 10 ? 16 : 8;
  const headerBytes = Math.ceil((4 + countBits) / 8);
  if (bytes.length + headerBytes > dataCodewords) throw new Error('qrcode.mjs: payload exceeds capacity for the selected version');

  // bit stream: mode (0100 = byte), 8-bit count, data bytes, terminator, pad to byte boundary,
  // then alternate pad bytes 0xEC/0x11 until dataCodewords is reached.
  const bits = [];
  const pushBits = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  pushBits(0b0100, 4);
  pushBits(bytes.length, countBits);
  for (const b of bytes) pushBits(b, 8);
  const terminatorLen = Math.min(4, dataCodewords * 8 - bits.length);
  pushBits(0, terminatorLen);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  let padToggle = true;
  while (codewords.length < dataCodewords) { codewords.push(padToggle ? 0xec : 0x11); padToggle = !padToggle; }
  return codewords;
}

// Interleave data blocks and their EC blocks per the spec's block-splitting rule, then append
// all EC codewords after all data codewords, reading column-major across blocks of uneven size
// (the shorter blocks are read from position 0, matching every block's own length).
function interleave(dataCodewords, version) {
  const [total, ecPerBlock, b1, b2] = VERSION_TABLE_M[version];
  const dataTotal = total - ecPerBlock * (b1 + b2);
  const blockCount = b1 + b2;
  const shortLen = Math.floor(dataTotal / blockCount);
  const longBlocks = dataTotal - shortLen * blockCount; // number of blocks that get one extra data byte
  const blocks = [];
  let pos = 0;
  for (let i = 0; i < blockCount; i++) {
    const len = shortLen + (i >= blockCount - longBlocks ? 1 : 0);
    const data = dataCodewords.slice(pos, pos + len);
    pos += len;
    blocks.push({ data, ec: rsRemainder(data, ecPerBlock) });
  }
  const out = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxDataLen; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Matrix construction. `reserved` tracks every module this function has already placed a
// function pattern into, so the zigzag data pass (which runs last) can never overwrite one —
// structurally, not by careful ordering alone.
function buildMatrix(version, finalCodewords) {
  const n = SIZE(version);
  const mat = Array.from({ length: n }, () => new Array(n).fill(0));
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, v, res = true) => { if (r < 0 || c < 0 || r >= n || c >= n) return; mat[r][c] = v; if (res) reserved[r][c] = true; };

  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= n || c >= n) continue;
      const onRing0 = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inCore = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark = inCore && (onRing0 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(r, c, dark ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);

  // timing patterns
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }

  // alignment patterns — skip any centre that would overlap a finder pattern's 8x8 reserved zone
  const coords = ALIGNMENT_COORDS[version] || [];
  for (const r0 of coords) for (const c0 of coords) {
    if ((r0 <= 8 && c0 <= 8) || (r0 <= 8 && c0 >= n - 9) || (r0 >= n - 9 && c0 <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const ring = Math.max(Math.abs(dr), Math.abs(dc));
      set(r0 + dr, c0 + dc, ring !== 1 ? 1 : 0);
    }
  }

  // dark module, fixed position, present at every version
  set(n - 8, 8, 1);

  // Reserve format-info areas (filled after mask selection) and version-info areas. Two
  // exclusions this loop used to trample:
  //   i === 6 is the TIMING row/column, which crosses the format band and is not part of it.
  //     Reserving it rewrote (6,8) and (8,6) to light, so the alternating run a scanner uses
  //     to establish the module grid began with two lights and no camera would lock on.
  //   the column-8 lower copy is SEVEN modules (rows n-1..n-7), not eight: row n-8 is the
  //     dark module, so running to eight cleared it immediately after it was placed.
  for (let i = 0; i < 9; i++) { if (i === 6) continue; set(8, i, 0); set(i, 8, 0); }
  for (let i = 0; i < 8; i++) set(8, n - 1 - i, 0);
  for (let i = 0; i < 7; i++) set(n - 1 - i, 8, 0);
  if (version >= 7) {
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) { set(r, n - 11 + c, 0); set(n - 11 + c, r, 0); }
  }

  // zigzag data placement: two-column strips right to left, skipping the vertical timing column,
  // alternating strip direction (up, then down, ...), each strip visiting its right column then
  // left column per row so the standard boustrophedon order is preserved.
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  const nextBit = () => {
    if (bitIdx >= totalBits) return 0; // padding beyond data is written as 0 into remainder capacity, if any
    const byte = finalCodewords[bitIdx >> 3];
    const bit = (byte >> (7 - (bitIdx & 7))) & 1;
    bitIdx++;
    return bit;
  };
  let col = n - 1;
  let dir = -1; // -1 = moving up, 1 = moving down
  while (col > 0) {
    if (col === 6) col--; // timing column has no data
    for (let i = 0; i < n; i++) {
      const row = dir === -1 ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        set(row, c, nextBit(), false);
      }
    }
    dir = -dir;
    col -= 2;
  }
  return { mat, reserved, n };
}

// Mask formulas 0-7, per the spec, applied only to non-reserved (data) modules.
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

function applyMask(base, maskFn) {
  const { mat, reserved, n } = base;
  const out = mat.map((row) => row.slice());
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!reserved[r][c] && maskFn(r, c)) out[r][c] ^= 1;
  return out;
}

// Penalty scoring, the four standard rules (N1 runs, N2 2x2 blocks, N3 finder-like patterns,
// N4 dark-module balance) — used only to pick the least-noisy of the 8 masks, exactly as the
// spec intends; a wrong pick here degrades scan reliability, it does not break correctness.
function penalty(mat, n) {
  let score = 0;
  const lineRuns = (get) => {
    for (let i = 0; i < n; i++) {
      let runVal = get(i, 0), runLen = 1;
      for (let j = 1; j < n; j++) {
        const v = get(i, j);
        if (v === runVal) { runLen++; continue; }
        if (runLen >= 5) score += 3 + (runLen - 5);
        runVal = v; runLen = 1;
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
  };
  lineRuns((i, j) => mat[i][j]);
  lineRuns((i, j) => mat[j][i]);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const v = mat[r][c];
    if (mat[r][c + 1] === v && mat[r + 1][c] === v && mat[r + 1][c + 1] === v) score += 3;
  }
  const finderLike = [1, 0, 1, 1, 1, 0, 1];
  const matchesAt = (get, i, start) => {
    for (let k = 0; k < 7; k++) if (get(i, start + k) !== finderLike[k]) return false;
    return true;
  };
  const runFinderCheck = (get) => {
    for (let i = 0; i < n; i++) for (let j = 0; j <= n - 7; j++) {
      if (!matchesAt(get, i, j)) continue;
      const before4 = j >= 4 && [0, 0, 0, 0].every((_, k) => get(i, j - 4 + k) === 0);
      const after4 = j + 7 + 4 <= n && [0, 0, 0, 0].every((_, k) => get(i, j + 7 + k) === 0);
      if (before4 || after4) score += 40;
    }
  };
  runFinderCheck((i, j) => mat[i][j]);
  runFinderCheck((i, j) => mat[j][i]);
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += mat[r][c];
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

// BCH(15,5) format-info encoding, generator polynomial 0x537 (the spec's own), XORed with the
// fixed mask 0x5412 — computed by polynomial division, not looked up.
function formatBits(ecLevelBits, maskPattern) {
  const data = (ecLevelBits << 3) | maskPattern; // 5 bits: 2 EC-level + 3 mask
  let d = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= gen << (i - 10);
  const bits = (data << 10) | d;
  return bits ^ 0b101010000010010;
}

// BCH(18,6) version information, mandatory for versions 7 and up: six data bits (the version
// number) followed by twelve check bits, generator 0x1F25. Divided out here rather than looked up,
// for the same reason formatBits is — a transcribed table is a mistake nobody can see.
// Its ABSENCE was the last defect. The two 3x6 areas were reserved and never written, so v7-v10
// shipped 36 blank modules where the version block belongs. Every conformant reader refused the
// symbol; this file's own decoder is TOLD the version, so it never looked and never noticed.
function versionBits(version) {
  let d = version << 12;
  const gen = 0b1111100100101;
  for (let i = 17; i >= 12; i--) if ((d >> i) & 1) d ^= gen << (i - 12);
  return (version << 12) | d;
}

// Two copies. Top-right: rows 0-5, columns n-11..n-9. Bottom-left: rows n-11..n-9, columns 0-5.
// Bit i is the i-th least significant; the two copies are transposes of one another.
function placeVersionInfo(mat, n, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const b = (bits >> i) & 1;
    const r = Math.floor(i / 3), c = i % 3;
    mat[n - 11 + c][r] = b;
    mat[r][n - 11 + c] = b;
  }
}

function placeFormatInfo(mat, n, bits) {
  // Bit order is MSB-FIRST along the spec's placement sequence: bit 14 sits at (8,0) and bit 0
  // at (0,8). This read LSB-first, which self-round-trips — the encoder and the test's decoder
  // both used the same reversed convention and agreed — while every conformant reader saw an
  // unrecognised format string and refused the symbol. Verified against qrencode's own output:
  // read MSB-first its v1-M 'HELLO' gives 0x5412 (mask 0), read LSB-first it gives 0x2415,
  // which is in no format table.
  const b = (i) => (bits >> (14 - i)) & 1;
  // around the top-left finder
  const topLeftSeq = [0, 1, 2, 3, 4, 5, 7, 8]; // column positions 0-8 skip row 6 (timing)
  for (let k = 0; k < 6; k++) mat[8][k] = b(k);
  mat[8][7] = b(6); mat[8][8] = b(7); mat[7][8] = b(8);
  for (let k = 9; k < 15; k++) mat[14 - k][8] = b(k);
  // Bottom-left + top-right copies. The split is 7 | 8, not 8 | 7: bits 0-6 run up column 8
  // from the bottom edge and stop ABOVE the dark module at row n-8; bits 7-14 run along row 8
  // from column n-8 to the right edge. Writing eight down the column overwrote the dark module
  // a second time, after buildMatrix had already had it cleared once.
  for (let k = 0; k < 7; k++) mat[n - 1 - k][8] = b(k);
  for (let k = 7; k < 15; k++) mat[8][n - 15 + k] = b(k);
  void topLeftSeq;
}

export function encodeQR(text, opts = {}) {
  const version = opts.version || pickVersion(new TextEncoder().encode(text).length);
  const dataCodewords = buildDataCodewords(text, version);
  const finalCodewords = interleave(dataCodewords, version);
  const base = buildMatrix(version, finalCodewords);
  let best = null;
  for (let m = 0; m < 8; m++) {
    const masked = applyMask(base, MASKS[m]);
    const bits = formatBits(0b00, m); // EC level M = bits 00 per the spec's level encoding
    placeFormatInfo(masked, base.n, bits);
    placeVersionInfo(masked, base.n, version);
    const p = penalty(masked, base.n);
    if (!best || p < best.p) best = { p, masked, mask: m };
  }
  return { size: base.n, modules: best.masked };
}

// Render as a standalone <svg> string — vector, so it stays crisp at any display size and needs
// no canvas/image pipeline. `quiet` is the required 4-module quiet-zone border (spec minimum).
export function qrToSvg(qr, { moduleSize = 6, quiet = 4, dark = '#000', light = '#fff' } = {}) {
  const n = qr.size;
  const total = n + quiet * 2;
  const px = total * moduleSize;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.modules[r][c]) continue;
    const x = (c + quiet) * moduleSize, y = (r + quiet) * moduleSize;
    path += `M${x} ${y}h${moduleSize}v${moduleSize}h${-moduleSize}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" role="img" aria-label="QR code">`
    + `<rect width="${px}" height="${px}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
