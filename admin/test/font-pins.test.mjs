// Every font this repository ships is an upstream IBM Plex file, byte for byte. The OFL reserves the
// name "Plex": a subset or edit made here would be a Modified Version that may not carry it, so an
// altered file is a licence breach even though it still renders. Pins are in
// admin/static/fonts/SHA256SUMS, taken from the @ibm/plex-* tarballs SOURCE.txt names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONTS = join(ROOT, 'admin', 'static', 'fonts');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const pins = new Map(readFileSync(join(FONTS, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => {
  const [hash, name] = l.trim().split(/\s+/);
  return [name, hash];
}));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

test('the pin list is non-empty and every pin is a sha256', () => {
  assert.ok(pins.size >= 8, `only ${pins.size} pins read; SHA256SUMS no longer parses`);
  for (const [name, hash] of pins) assert.match(hash, /^[0-9a-f]{64}$/, name);
});

test('every tracked font file is a pinned upstream file, unaltered', () => {
  const fonts = tracked.filter((p) => /\.(woff2?|ttf|otf|eot)$/i.test(p));
  assert.ok(fonts.length >= pins.size, 'fewer font files than pins');
  const bad = [];
  for (const p of fonts) {
    const want = pins.get(basename(p));
    const got = sha256(readFileSync(join(ROOT, p)));
    if (!want) bad.push(`${p}: not pinned; add it to SHA256SUMS from its upstream source, with that source in SOURCE.txt`);
    else if (got !== want) bad.push(`${p}: ${got} is not the upstream bytes ${want}`);
  }
  assert.deepEqual(bad, []);
});

test('every font inlined as base64 in a tracked file decodes to a pinned upstream file', () => {
  const known = new Set(pins.values());
  const inlined = /data:font\/woff2;base64,([A-Za-z0-9+/=]{100,})/g;
  const text = tracked.filter((p) => /\.(html|css|mjs|js|svg|md)$/i.test(p));
  const bad = [];
  for (const p of text) {
    const body = readFileSync(join(ROOT, p), 'utf8');
    if (!body.includes('data:font/woff2;base64,')) continue;
    for (const m of body.matchAll(inlined)) {
      const h = sha256(Buffer.from(m[1], 'base64'));
      if (!known.has(h)) bad.push(`${p}: an inlined font (${h.slice(0, 16)}) is not an upstream file`);
    }
  }
  assert.deepEqual(bad, []);
});
