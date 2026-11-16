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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { stripComments } from '../lib/tracked-imports.mjs';

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
// Node 22 also hangs processes that never call it under this stress, so a hung renderer alone says
// nothing about the renderer.
// The deadlock lives inside process.exit() and an uncaught throw, so the renderer must reach neither.
// Reading the source holds on every run, including the rounds the stress run below misses.
const EXIT_CALL = 'calls process.exit()';
const UNCAUGHT_RUN = 'run() is not called inside a try/catch that sets process.exitCode';
const exitHazards = (src) => {
  const code = stripComments(src);
  return [
    ...(/\bprocess\.exit\s*\(/.test(code) ? [EXIT_CALL] : []),
    ...(/\btry\s*\{[^}]*\bprocess\.exitCode\s*=\s*run\(\)[^}]*\}\s*catch\b/.test(code) ? [] : [UNCAUGHT_RUN]),
  ];
};

test('the renderer never calls process.exit() and catches every throw from run()', () => {
  assert.deepEqual(exitHazards(readFileSync(OG, 'utf8')), []);
  assert.deepEqual(exitHazards('process.exit(run());'), [EXIT_CALL, UNCAUGHT_RUN], 'the check must fire on a renderer that has both');
  assert.deepEqual(exitHazards('// never process.exit()\ntry { process.exitCode = run(); } catch { process.exitCode = 1; }'), [],
    'a comment naming process.exit() is not a call');
});

// Node can hang ANY process at shutdown under this stress (nodejs/node#54918, #64274, both open), at a
// rate that moves with the runner and the workload: on Linux Node 22 a hot-loop control living 5x longer
// hung 11 of 72 while the renderer hung 29 of 72. So each renderer is paired with its twin: the same
// file, arguments and work, with process.exit() made a natural exit by a preload. Only the exit path
// differs, and the renderer must out-hang its twins beyond chance. A child killed by a signal never
// reached its exit, so it is unmeasured: neither a pass nor the deadlock. 24 run at once because
// contention exposes the deadlock: reinstated, 24 at once hung 15 of 96 and one at a time hung none.
const STRESS_AT_ONCE = 24;
const STRESS_LOOKS = 4;
const STRESS_ALPHA = 0.01;
// Futility stops never raise the false-failure rate; a 16% regression stops on this 1.3% of the time.
const STRESS_FUTILE_P = 0.2;
const HANG_MS = 30_000;

const stressChild = (args, env) => new Promise((done) => {
  const t0 = performance.now();
  const c = spawn(process.execPath, ['--stress-concurrent-allocation', ...args], { env, stdio: 'ignore' });
  const timer = setTimeout(() => { c.kill('SIGKILL'); done({ end: 'hung' }); }, HANG_MS);
  c.on('exit', (code, signal) => { clearTimeout(timer); done({ end: code ?? signal, ms: performance.now() - t0 }); });
});
const tally = () => ({ codes: [], hung: 0, killed: [], ms: [] });
const record = (side) => (r) => {
  if (r.end === 'hung') side.hung++;
  else if (typeof r.end === 'string') side.killed.push(r.end);
  else { side.codes.push(r.end); side.ms.push(r.ms); }
};
const measured = (side) => side.codes.length + side.hung;
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? NaN;

const logChoose = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i); return s; };
/** One-sided Fisher exact p: the chance renderers take at least rHung of all hangs if both sides share one hang rate. */
function excessHangP(rHung, rN, cHung, cN) {
  const hung = rHung + cHung, all = rN + cN;
  let p = 0;
  for (let x = rHung; x <= Math.min(hung, rN); x++) p += Math.exp(logChoose(hung, x) + logChoose(all - hung, rN - x) - logChoose(all, rN));
  return Math.min(1, p);
}

test('the excess-hang p-value is the hypergeometric upper tail', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  close(excessHangP(4, 24, 0, 24), 10626 / 194580);
  close(excessHangP(6, 24, 0, 24), 134596 / 12271512);
  close(excessHangP(7, 24, 0, 24), 346104 / 73629072);
  close(excessHangP(2, 2, 0, 2), 1 / 6);
  close(excessHangP(0, 24, 5, 24), 1);
  assert.ok(excessHangP(3, 24, 3, 24) > 0.5);
  assert.ok(excessHangP(4, 24, 0, 24) >= STRESS_ALPHA / STRESS_LOOKS, 'CI 2026-11-15: 4 of 24 renderers and 0 of 24 controls hung on Node 22, which is chance');
  assert.ok(excessHangP(17, 48, 0, 48) < STRESS_ALPHA / STRESS_LOOKS, 'the process.exit() renderer hung 17 of 48');
});

test('the renderer exits under concurrent-allocation stress', async (t) => {
  // Arrange
  const { root, png } = site(t);
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(png, Buffer.from('not the card'));
  const env = { ...process.env, CW_DOCSITE_ROOT: root };
  delete env.CW_DOCSITE_PRIVATE;
  const asIs = join(root, 'as-is.mjs'), natural = join(root, 'natural-exit.mjs');
  writeFileSync(asIs, '');
  writeFileSync(natural, 'process.exit = (code) => { if (code !== undefined) process.exitCode = code; };\n');
  const via = (preload) => ['--import', pathToFileURL(preload).href, OG, '--check'];
  const renderer = tally(), twin = tally();
  // Act
  let looks = 0, p = 1;
  // Bonferroni over the looks keeps the false-failure rate at STRESS_ALPHA however early it stops.
  while (looks < STRESS_LOOKS) {
    for (let batch = 0; batch < 2; batch++) {
      await Promise.all(Array.from({ length: STRESS_AT_ONCE }, (_, i) => (i % 2
        ? stressChild(via(natural), env).then(record(twin))
        : stressChild(via(asIs), env).then(record(renderer)))));
    }
    looks++;
    p = excessHangP(renderer.hung, measured(renderer), twin.hung, measured(twin));
    if (!renderer.hung || twin.hung >= renderer.hung || p < STRESS_ALPHA / STRESS_LOOKS || (looks > 1 && p > STRESS_FUTILE_P)) break;
  }
  // Assert
  assert.deepEqual(renderer.codes, Array(renderer.codes.length).fill(1), '1 is --check reporting the drift');
  assert.deepEqual(twin.codes, Array(twin.codes.length).fill(1), 'the twin renders the same drift');
  const renderersSpawned = looks * STRESS_AT_ONCE;
  const counts = `Node ${process.version}: renderers hung ${renderer.hung}/${measured(renderer)}, twins ${twin.hung}/${measured(twin)}, `
    + `p=${p.toPrecision(3)} after ${looks} of ${STRESS_LOOKS} looks; median exit ${Math.round(median(renderer.ms))} vs ${Math.round(median(twin.ms))} ms`;
  t.diagnostic(counts);
  if (renderer.killed.length) {
    const killedBy = [...new Set(renderer.killed)].join(', ');
    if (measured(renderer) * 3 < renderersSpawned * 2) {
      t.skip(`${renderer.killed.length}/${renderersSpawned} renderers were killed by ${killedBy} before exiting -- the exit path was NOT measured`);
      return;
    }
    t.diagnostic(`${renderer.killed.length}/${renderersSpawned} renderers were killed by ${killedBy}, unmeasured`);
  }
  if (!renderer.hung) return;
  if (p >= STRESS_ALPHA / STRESS_LOOKS) {
    t.skip(`${counts}: within chance of its twins (it fails below p=${STRESS_ALPHA / STRESS_LOOKS}), so the exit path is undetermined`);
    return;
  }
  assert.fail(`"hung" is the deadlock: the renderer hangs at exit more often than its twin with a natural exit. ${counts}`);
});
