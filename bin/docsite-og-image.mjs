#!/usr/bin/env node
// docsite-og-image.mjs — render docsite/public/og.png, the 1200x630 social card the docsite's
// og:image names. bin/docsite-publish.mjs passes docsite/public/** through to the bundle root, so
// the asset and the tag ship in one act.
//
// Usage:
//   node bin/docsite-og-image.mjs            # report what it would write; no write
//   node bin/docsite-og-image.mjs --write    # render it
//   node bin/docsite-og-image.mjs --check    # render to memory, compare to disk, exit 1 on drift
//
// 1200x630 is not a preference. X and LinkedIn crop anything with a different aspect ratio and
// Slack falls back to a small card, so an off-size image is a worse card than none.
//
// WHY THERE IS A PNG ENCODER IN HERE. The first version of this script drove headless Chrome. Two
// reasons it was replaced, in order of weight. It did not work: Chrome on this host hangs past 120s
// with a display-link error and writes nothing, and a renderer that sometimes produces no file is a
// generator whose output you cannot gate. And it could not be deterministic even when it did work,
// because the PNG bytes would be Chrome's encoder's — so `--check` would have been impossible and
// the house rule (same inputs, byte-identical outputs) unmeetable. node:zlib and arithmetic have
// neither problem: this file is reproducible from its source on any machine with Node, which is why
// `--check` exists at all.
//
// The cost, stated plainly: no font is available this way, so the card's type is a 5x8 bitmap face
// defined below and the card says only the two things that fit it well — the wordmark and the host.
// The sentence a reader needs is in og:description, which is text and needs no rasteriser.
//
// fact: an unknown character is a FAILURE naming it, never a blank cell / a silently dropped glyph
//   would ship a card with a hole in the wordmark and nothing would have failed (expiry: never)
// fact: shapes are drawn at 3x and box-downsampled, so edges are antialiased by averaging whole
//   subpixels — integer arithmetic, no float rounding to vary across platforms (expiry: never)
// fact: the exit status is set through process.exitCode, never process.exit() / Node 24 and 26 can
//   deadlock in process.exit() while a V8 background compile waits on a GC the exiting thread never
//   runs (nodejs/node#64274). This renderer's hot loops hit it in 5 of 6 Linux CI runs, each one a
//   20-minute timeout; a natural exit disposes the isolate and wakes the worker (expiry: when the
//   Node floor includes nodejs/node#66171)
// env, read at call time: CW_DOCSITE_ROOT (via lib)

import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { docsiteRoot } from '../lib/docsite-manifest.mjs';
import { MARK_COLOURS } from '../lib/brand-tokens.mjs';

const W = 1200;
const H = 630;
const SS = 3;                    // supersample factor; the only antialiasing in here
const SW = W * SS;
const SH = H * SS;

// Palette. `key` is the gold from lib/brand-tokens.mjs — imported, never a pasted hex, so a palette
// change reaches this card. The two darks are the card ground and the seal's own disc; they are
// local to this artefact (the page CSS has no dark ground) and are stated here once.
const GOLD = MARK_COLOURS.key;   // '#C9A227'
const GROUND = '#101011';
const SEAL_DISC = '#14161A';
const INK = '#F4F3EF';

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// ── the face ───────────────────────────────────────────────────────────────────────────────────
// 5 wide, 8 tall. Rows 0-1 are ascender/dot space, 2-6 the x-height, 7 the descender row (unused by
// the glyphs this card needs). Fixed advance: the result reads as the monospace the panel and the
// docsite footer already use, rather than as a proportional face rendered badly.
const GLYPHS = {
  c: ['.....', '.....', '.###.', '#...#', '#....', '#...#', '.###.', '.....'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.', '.....'],
  i: ['..#..', '.....', '..#..', '..#..', '..#..', '..#..', '..#..', '.....'],
  k: ['#....', '#....', '#...#', '#..#.', '###..', '#..#.', '#...#', '.....'],
  l: ['##...', '.#...', '.#...', '.#...', '.#...', '.#...', '.###.', '.....'],
  m: ['.....', '.....', '##.##', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '.....'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#', '.....'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....', '.....'],
  t: ['.#...', '.#...', '###..', '.#...', '.#...', '.#...', '..##.', '.....'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..', '.....'],
};

const GLYPH_W = 5;
const GLYPH_H = 8;

// ── the canvas ─────────────────────────────────────────────────────────────────────────────────
const buf = new Uint8Array(SW * SH * 3);

const put = (x, y, [r, g, b]) => {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
};

const fillRect = (x, y, w, h, colour) => {
  const c = rgb(colour);
  const x0 = Math.round(x * SS), y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS), y1 = Math.round((y + h) * SS);
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) put(px, py, c);
};

// Distance-field disc and ring. A ring is |d − r| <= width/2, not a disc punched out by a smaller
// one in the ground colour: punching would erase whatever the ring overlaps, which on this card is
// the seal's own disc and would leave a hairline of ground inside the gold.
const disc = (cx, cy, r, colour) => {
  const c = rgb(colour);
  const CX = cx * SS, CY = cy * SS, R = r * SS;
  for (let py = Math.floor(CY - R); py <= Math.ceil(CY + R); py++) {
    for (let px = Math.floor(CX - R); px <= Math.ceil(CX + R); px++) {
      const dx = px + 0.5 - CX, dy = py + 0.5 - CY;
      if (dx * dx + dy * dy <= R * R) put(px, py, c);
    }
  }
};

const ring = (cx, cy, r, width, colour) => {
  const c = rgb(colour);
  const CX = cx * SS, CY = cy * SS, R = r * SS, HW = (width * SS) / 2;
  for (let py = Math.floor(CY - R - HW); py <= Math.ceil(CY + R + HW); py++) {
    for (let px = Math.floor(CX - R - HW); px <= Math.ceil(CX + R + HW); px++) {
      const dx = px + 0.5 - CX, dy = py + 0.5 - CY;
      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - R) <= HW) put(px, py, c);
    }
  }
};

const segment = (x0, y0, x1, y1, width, colour) => {
  const c = rgb(colour);
  const ax = x0 * SS, ay = y0 * SS, bx = x1 * SS, by = y1 * SS, HW = (width * SS) / 2;
  const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
  for (let py = Math.floor(Math.min(ay, by) - HW); py <= Math.ceil(Math.max(ay, by) + HW); py++) {
    for (let px = Math.floor(Math.min(ax, bx) - HW); px <= Math.ceil(Math.max(ax, bx) + HW); px++) {
      const wx = px + 0.5 - ax, wy = py + 0.5 - ay;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
      const dx = wx - t * vx, dy = wy - t * vy;
      if (dx * dx + dy * dy <= HW * HW) put(px, py, c);
    }
  }
};

class MissingGlyph extends Error {}

const text = (s, x, y, scale, colour) => {
  let cx = x;
  for (const ch of s) {
    const g = GLYPHS[ch];
    // Fail closed. A card with a hole where a letter should be is the artefact nobody checks.
    if (!g) throw new MissingGlyph(`docsite-og-image: no glyph for ${JSON.stringify(ch)} — add it to GLYPHS or change the string`);
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if (g[row][col] === '#') fillRect(cx + col * scale, y + row * scale, scale, scale, colour);
      }
    }
    cx += (GLYPH_W + 1) * scale;
  }
  return cx - scale;   // right edge, minus the trailing inter-glyph gap
};

// ── the card ───────────────────────────────────────────────────────────────────────────────────
const drawCard = () => {
  fillRect(0, 0, W, H, GROUND);

  // The seal, from lib/brand-tokens.mjs's SEAL_SVG geometry (viewBox 0 0 32 32) at scale 4 placed at
  // (86,180): disc, gold rule ring, filled key, hollow key, the stroke between them. Transcribed
  // rather than imported because nothing here parses SVG — if the seal's geometry changes, this
  // block changes with it, and lib/test/brand-marks.test.mjs is where that pairing is held.
  const SEAL_X = 86, SEAL_Y = 180, SEAL = 4;      // 32 * 4 = 128px
  const sx = (u) => SEAL_X + u * SEAL;
  const sy = (u) => SEAL_Y + u * SEAL;
  disc(sx(16), sy(16), 16 * SEAL, SEAL_DISC);
  ring(sx(16), sy(16), 14.5 * SEAL, 1 * SEAL, GOLD);
  disc(sx(12), sy(20), 2.4 * SEAL, GOLD);
  ring(sx(21), sy(11), 2.4 * SEAL, 1.3 * SEAL, GOLD);
  segment(sx(13.7), sy(18.3), sx(19.3), sy(12.7), 1.3 * SEAL, GOLD);

  text('commitwork', 250, 196, 12, INK);          // 8 rows * 12 = 96px, centred on the seal
  fillRect(86, 372, 220, 5, GOLD);
  text('i.commitwork.online', 86, 420, 5, GOLD);
  fillRect(0, H - 10, W, 10, GOLD);
};

// ── downsample and encode ──────────────────────────────────────────────────────────────────────
const downsample = () => {
  const out = new Uint8Array(W * H * 3);
  const n = SS * SS;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * SW + (x * SS + dx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      // Integer division, deliberately: Math.round on a float mean is the one step here that could
      // differ between engines at a .5 boundary.
      out[o] = (r / n) | 0; out[o + 1] = (g / n) | 0; out[o + 2] = (b / n) | 0;
    }
  }
  return out;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};

const encodePng = (pixels) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // colour type 2 = truecolour RGB, no alpha (a card has no transparency)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // deflate, adaptive filtering, no interlace
  // Filter type 0 (None) on every scanline. A smarter filter would compress better; this file is
  // a one-off asset and a predictable encoder is worth more here than a smaller one.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    Buffer.from(pixels.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const run = () => {
  drawCard();
  const png = encodePng(downsample());
  const outPath = join(docsiteRoot(), 'public', 'og.png');

  if (process.argv.includes('--check')) {
    let have = null;
    try { have = readFileSync(outPath); } catch (e) {
      if (e.code !== 'ENOENT') { console.error(`docsite-og-image --check: ${outPath} unreadable: ${e.message}`); return 2; }
    }
    if (have === null) { console.error(`docsite-og-image --check: ${outPath} is MISSING — og:image names an asset that is not there`); return 1; }
    if (!have.equals(png)) { console.error(`docsite-og-image --check: ${outPath} differs from its render (${have.length} on disk, ${png.length} rendered)`); return 1; }
    console.log(`docsite-og-image --check: clean (${W}x${H}, ${png.length} bytes)`);
    return 0;
  }

  if (!process.argv.includes('--write')) {
    console.log(`would write ${outPath} — ${W}x${H}, ${png.length} bytes`);
    console.log(existsSync(outPath) ? `  exists: ${statSync(outPath).size} bytes` : '  does not exist yet');
    return 0;
  }

  mkdirSync(join(docsiteRoot(), 'public'), { recursive: true });
  writeAtomic(outPath, png);
  console.log(`wrote ${outPath} — ${W}x${H}, ${png.length} bytes`);
  return 0;
};

// Every failure is caught: an uncaught throw hangs at exit as well (3 of 48 under stress).
try {
  process.exitCode = run();
} catch (e) {
  console.error(e instanceof MissingGlyph ? e.message : e);
  process.exitCode = e instanceof MissingGlyph ? 2 : 1;
}
