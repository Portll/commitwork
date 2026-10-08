// bin/docsite-og-image.mjs end to end against a fixture docsite root (CW_DOCSITE_ROOT, read at call
// time). Pins the three modes: the default run reports and writes NOTHING; --write renders a real
// 1200x630 RGB PNG; --check exits 0 only on a byte-identical file and 1 on a missing or drifted one.
// Two renders must be byte-identical — the determinism that makes --check possible at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OG = join(CW, 'bin', 'docsite-og-image.mjs');

function site(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-og-image-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, png: join(root, 'public', 'og.png') };
}

// CW_DOCSITE_PRIVATE is unset on purpose: with a fixture root set there is no private root at all.
const og = (root, args = []) => {
  const env = { ...process.env, CW_DOCSITE_ROOT: root };
  delete env.CW_DOCSITE_PRIVATE;
  const r = spawnSync(process.execPath, [OG, ...args], { encoding: 'utf8', env, timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.error ? `${r.error.message}\n${r.stderr}` : r.stderr };
};

/** IHDR fields and the decoded scanlines of a PNG, read independently of the encoder under test. */
function readPng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  let off = 8; const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('latin1', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  const ihdr = chunks[0].data;
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  return {
    types: chunks.map((c) => c.type),
    width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), depth: ihdr[8], colourType: ihdr[9],
    raw: inflateSync(idat),
  };
}

test('the default run reports what it would write and writes nothing', (t) => {
  const { root, png } = site(t);
  const r = og(root);
  assert.equal(r.code, 0, r.err);
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal or escaped value defined in the test
  assert.match(r.out, new RegExp(`would write ${png.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — 1200x630, \\d+ bytes`));
  assert.match(r.out, /does not exist yet/);
  assert.equal(existsSync(join(root, 'public')), false, 'a dry run created the public dir');
});

test('--check on a root with no og.png is a failure naming the missing asset', (t) => {
  const { root } = site(t);
  const r = og(root, ['--check']);
  assert.equal(r.code, 1);
  assert.match(r.err, /og\.png is MISSING — og:image names an asset that is not there/);
});

test('--write renders a 1200x630 8-bit RGB PNG whose ground and bottom rule are the declared colours', (t) => {
  const { root, png } = site(t);
  const r = og(root, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^wrote .*og\.png — 1200x630, \d+ bytes/);
  const img = readPng(readFileSync(png));
  assert.deepEqual(img.types, ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual([img.width, img.height, img.depth, img.colourType], [1200, 630, 8, 2]);
  const stride = 1 + 1200 * 3;
  assert.equal(img.raw.length, 630 * stride, 'one filter byte plus 1200 RGB pixels per row');
  const px = (x, y) => [...img.raw.subarray(y * stride + 1 + x * 3, y * stride + 1 + x * 3 + 3)];
  assert.deepEqual(px(1190, 10), [0x10, 0x10, 0x11], 'top-right corner is the ground #101011');
  assert.deepEqual(px(600, 625), [0xc9, 0xa2, 0x27], 'the 10px bottom rule is the brand gold #C9A227');
});

test('--check is clean on its own render and two renders are byte-identical', (t) => {
  const a = site(t); const b = site(t);
  assert.equal(og(a.root, ['--write']).code, 0);
  assert.equal(og(b.root, ['--write']).code, 0);
  assert.ok(readFileSync(a.png).equals(readFileSync(b.png)), 'same source, different bytes');
  const r = og(a.root, ['--check']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /--check: clean \(1200x630, \d+ bytes\)/);
});

test('--check fails on a drifted file and reports both sizes', (t) => {
  const { root, png } = site(t);
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(png, Buffer.from('not the card'));
  const r = og(root, ['--check']);
  assert.equal(r.code, 1);
  assert.match(r.err, /differs from its render \(12 on disk, \d+ rendered\)/);
  assert.equal(readFileSync(png, 'utf8'), 'not the card', '--check must not repair what it reports');
});

// Node 24 and 26 can deadlock inside process.exit() while a V8 background compile waits on a GC
// (nodejs/node#64274). While the renderer called it, this file hung 5 of 6 Linux CI runs, and 17 of 48
// --check runs hung under V8's concurrent-allocation stress, so 24 clean exits make a regression show.
// The control is a script that only allocates and never exits explicitly. Node 22 hangs it 9 of 24
// times under this stress, so on such a runtime a hung renderer says nothing about the renderer.
const stressExits = (args, env = process.env) => Promise.all(Array.from({ length: 24 }, () => new Promise((done) => {
  const c = spawn(process.execPath, ['--stress-concurrent-allocation', ...args], { env, stdio: 'ignore' });
  const timer = setTimeout(() => { c.kill('SIGKILL'); done('hung'); }, 30_000);
  c.on('exit', (code) => { clearTimeout(timer); done(code); });
})));

test('the renderer exits under concurrent-allocation stress', async (t) => {
  const control = await stressExits(['-e', 'const a = []; for (let i = 0; i < 2e5; i++) a.push({ i });']);
  const controlHung = control.filter((c) => c === 'hung').length;
  if (controlHung) {
    t.skip(`Node ${process.version} hung ${controlHung}/24 allocation-only controls under the same stress`);
    return;
  }
  const { root, png } = site(t);
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(png, Buffer.from('not the card'));
  const env = { ...process.env, CW_DOCSITE_ROOT: root };
  delete env.CW_DOCSITE_PRIVATE;
  const exits = await stressExits([OG, '--check'], env);
  assert.deepEqual(exits, Array(24).fill(1), '1 is --check reporting the drift; "hung" is the deadlock');
});
