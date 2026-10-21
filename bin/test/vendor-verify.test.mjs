// bin/vendor-verify.mjs — vendored blobs are checked against the PUBLISHER's bytes. Fixtures are
// built at test time and served from a file:// registry; tarballs come from the system `tar`.
// The load-bearing assertions are the negatives: severed / poisoned / absent are all UNVERIFIABLE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { withUnreadable, ignoresPermissions } from '../../lib/fs-unreadable.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor-verify.mjs');
const GOOD = 'export const answer = 42;\n';
const OTHER = 'export const other = 1;\n';

function tmp(tag) { return mkdtempSync(join(tmpdir(), `vendor-verify-${tag}-`)); }

// A file:// npm registry: <base>/<pkg>/<version> is the version document, and dist.tarball is a
// path relative to the base so the fixture stays portable across checkouts.
function makeRegistry(base, pkg, version, files, { corruptIntegrity = false, mangleTar = false } = {}) {
  const stage = join(base, `.stage-${pkg}-${version}`);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(stage, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  const tgzName = `${pkg}-${version}.tgz`;
  const tgz = join(base, tgzName);
  // EVERY TAR ARGUMENT IS RELATIVE, and the drive letter is what forced it. GNU tar treats an
  // argument containing a colon as a REMOTE spec — `host:path`, the rsh/rmt syntax — so
  // `-czf C:\...\fixt-1.0.0.tgz` was read as "connect to host C:", failing with
  //   tar (child): Cannot connect to C: resolve failed
  // and taking all 16 tests in this file down. `--force-local` fixes GNU tar and is rejected by the
  // bsdtar that ships in Windows 11's System32, so it would trade one platform for another; running
  // tar from `cwd` with relative operands is understood identically by both.
  execFileSync('tar', ['-czf', tgzName, '-C', `.stage-${pkg}-${version}`, 'package'], { cwd: base });
  let buf = readFileSync(tgz);
  if (mangleTar) { // flip a byte inside the gzip payload → gunzip/tar read fails
    const copy = Buffer.from(buf);
    copy[Math.floor(copy.length / 2)] ^= 0xff;
    writeFileSync(tgz, copy);
    buf = copy;
  }
  const digest = createHash('sha512').update(corruptIntegrity ? Buffer.concat([buf, Buffer.from('x')]) : buf).digest('base64');
  const doc = join(base, pkg, version);
  mkdirSync(dirname(doc), { recursive: true });
  writeFileSync(doc, JSON.stringify({ name: pkg, version, dist: { tarball: tgzName, integrity: `sha512-${digest}` } }));
  rmSync(stage, { recursive: true, force: true });
  return pathToFileURL(base + '/').href;
}

function makeRoster(dir, entries) {
  const p = join(dir, 'roster.json');
  writeFileSync(p, JSON.stringify(entries));
  return p;
}

// Runs the CLI and always returns {code, stdout, stderr} — a non-zero exit is a RESULT here
// (1 = mismatch findings, 2 = unverifiable), not a harness failure.
function runTool(env, args = ['--json']) {
  try {
    const stdout = execFileSync('node', [TOOL, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const parse = (r) => JSON.parse(r.stdout);

// One reusable world: a registry with fixt@1.0.0 carrying package/build/good.js, and a tree whose
// vendor/ holds one faithful copy and one drifted copy.
function world(tag, opts = {}) {
  const dir = tmp(tag);
  const registry = join(dir, 'registry');
  mkdirSync(registry, { recursive: true });
  const base = makeRegistry(registry, 'fixt', '1.0.0', { 'package/build/good.js': GOOD, 'package/build/other.js': OTHER }, opts);
  const root = join(dir, 'tree');
  mkdirSync(join(root, 'vendor'), { recursive: true });
  writeFileSync(join(root, 'vendor', 'good.js'), GOOD);
  writeFileSync(join(root, 'vendor', 'drifted.js'), GOOD.replace('42', '43'));
  const env = {
    CW_NPM_REGISTRY: base,
    CW_VENDOR_ROOT: root,
    CW_VENDOR_CACHE: join(dir, 'cache'),
    CW_VENDOR_OFFLINE: '',
  };
  return { dir, env, root, base };
}

const ITEM_GOOD = { path: 'vendor/good.js', pkg: 'fixt', version: '1.0.0', entry: 'package/build/good.js' };
const ITEM_DRIFT = { path: 'vendor/drifted.js', pkg: 'fixt', version: '1.0.0', entry: 'package/build/good.js' };

test('verified: vendored bytes identical to the published tarball entry', () => {
  const w = world('ok');
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_GOOD]) });
  const rep = parse(r);
  assert.equal(r.code, 0);
  assert.equal(rep.assets[0].state, 'verified');
  assert.equal(rep.summary.verified, 1);
  assert.match(rep.assets[0].anchor, /sha512 integrity/);
  assert.equal(rep.assets[0].localSha512, rep.assets[0].publishedSha512);
  rmSync(w.dir, { recursive: true, force: true });
});

test('mismatch: drifted bytes are a finding, exit 1, and no content is printed', () => {
  const w = world('drift');
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_DRIFT]) });
  const rep = parse(r);
  assert.equal(r.code, 1);
  assert.equal(rep.assets[0].state, 'mismatch');
  assert.equal(rep.summary.verified, 0);
  assert.notEqual(rep.assets[0].localSha512, rep.assets[0].publishedSha512);
  // vendored blobs are minified and may contain anything — digests and sizes only
  assert.ok(!r.stdout.includes('answer = 4'), 'file content must never reach the report');
  rmSync(w.dir, { recursive: true, force: true });
});

test('mismatch: the claimed published path does not exist in the tarball', () => {
  const w = world('nopath');
  const roster = makeRoster(w.dir, [{ ...ITEM_GOOD, entry: 'package/build/imaginary.js' }]);
  const rep = parse(runTool({ ...w.env, CW_VENDOR_ROSTER: roster }));
  assert.equal(rep.assets[0].state, 'mismatch');
  assert.match(rep.assets[0].why, /claimed provenance does not exist/);
  rmSync(w.dir, { recursive: true, force: true });
});

test('UNVERIFIABLE: severed network — an unreachable registry is never clean', () => {
  const w = world('severed');
  const r = runTool({ ...w.env, CW_NPM_REGISTRY: 'http://127.0.0.1:1', CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_GOOD]) });
  const rep = parse(r);
  assert.equal(r.code, 2);
  assert.equal(rep.assets[0].state, 'UNVERIFIABLE');
  assert.equal(rep.summary.verified, 0, 'a network failure must never count as verified');
  assert.equal(rep.summary.mismatch, 0);
  assert.match(rep.assets[0].why, /registry lookup failed/);
  // the local read still happened, so the report says WHAT it could not verify
  assert.equal(rep.assets[0].localSize, GOOD.length);
  rmSync(w.dir, { recursive: true, force: true });
});

test('UNVERIFIABLE: absent registry document (unknown package) is not clean', () => {
  const w = world('unknownpkg');
  const roster = makeRoster(w.dir, [{ ...ITEM_GOOD, pkg: 'no-such-pkg' }]);
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: roster });
  assert.equal(r.code, 2);
  assert.equal(parse(r).assets[0].state, 'UNVERIFIABLE');
  rmSync(w.dir, { recursive: true, force: true });
});

test('UNVERIFIABLE: tarball that fails the registry integrity is never unpacked', () => {
  const w = world('poison', { corruptIntegrity: true });
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_GOOD]) });
  const rep = parse(r);
  assert.equal(r.code, 2);
  assert.equal(rep.assets[0].state, 'UNVERIFIABLE');
  assert.equal(rep.summary.verified, 0, 'bytes that match an unanchored tarball prove nothing');
  assert.match(rep.assets[0].why, /does not match the registry integrity/);
  rmSync(w.dir, { recursive: true, force: true });
});

test('UNVERIFIABLE: an unreadable tarball is a state, not an empty file list', () => {
  const w = world('mangled', { mangleTar: true });
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_GOOD]) });
  const rep = parse(r);
  assert.equal(r.code, 2);
  assert.equal(rep.assets[0].state, 'UNVERIFIABLE');
  // it fails at the integrity gate or the tar reader — either way it must not read as mismatch,
  // which would blame the vendored file for the registry's problem
  assert.equal(rep.summary.mismatch, 0);
  rmSync(w.dir, { recursive: true, force: true });
});

test('UNVERIFIABLE: a rostered file the tree does not have', () => {
  const w = world('absent');
  const roster = makeRoster(w.dir, [{ ...ITEM_GOOD, path: 'vendor/never-existed.js' }]);
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: roster });
  const rep = parse(r);
  assert.equal(r.code, 2);
  assert.equal(rep.assets[0].state, 'UNVERIFIABLE');
  assert.match(rep.assets[0].why, /absent/);
  rmSync(w.dir, { recursive: true, force: true });
});

test('UNVERIFIABLE: a vendored file that cannot be read is not treated as absent', (t) => {
  const w = world('perm');
  const target = join(w.root, 'vendor', 'good.js');
  // `chmod 000` is a no-op on NTFS, so the file stayed readable, the asset verified, and the
  // fallback branch asserted `process.getuid?.() === 0` — undefined on Windows, so this failed with
  // "a 000-mode file was read by a non-root user" while nothing of the sort had happened. The
  // condition the test asserts on simply never existed. withUnreadable() denies the read the way
  // each platform actually can (chmod on POSIX, `icacls /deny` here) and reports when it cannot,
  // rather than proceeding against a fixture that was never hostile.
  const out = withUnreadable(target, () => parse(runTool({ ...w.env, CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_GOOD]) })));
  if (!out.ran) {
    rmSync(w.dir, { recursive: true, force: true });
    t.skip(`cannot make a file unreadable to its own owner here: ${out.why}`);
    return;
  }
  const rep = out.value;
  if (rep.assets[0].state === 'verified') {
    // A principal that bypasses the ACL (root, or an elevated Windows account) defeats the fixture;
    // the assertion is not meaningful there and must say so rather than fail.
    assert.ok(ignoresPermissions(),
      'the file was refused to nobody, yet the asset verified — the denial did not take effect and '
      + 'this run proves nothing about the unreadable path');
  } else {
    assert.equal(rep.assets[0].state, 'UNVERIFIABLE');
    assert.match(rep.assets[0].why, /unreadable/);
    assert.equal(rep.summary.verified, 0);
  }
  rmSync(w.dir, { recursive: true, force: true });
});

test('UNVERIFIABLE: offline with no cached tarball, and the cache alone cannot mint a pass', () => {
  const w = world('offline');
  const roster = makeRoster(w.dir, [ITEM_GOOD]);
  const cold = runTool({ ...w.env, CW_VENDOR_OFFLINE: '1', CW_NPM_REGISTRY: 'https://registry.invalid', CW_VENDOR_ROSTER: roster });
  assert.equal(cold.code, 2);
  assert.equal(parse(cold).assets[0].state, 'UNVERIFIABLE');
  rmSync(w.dir, { recursive: true, force: true });
});

test('a cached tarball that no longer matches the integrity is not evidence', () => {
  const w = world('badcache');
  const roster = makeRoster(w.dir, [ITEM_GOOD]);
  assert.equal(runTool({ ...w.env, CW_VENDOR_ROSTER: roster }).code, 0); // warms the cache
  const cached = join(w.env.CW_VENDOR_CACHE, 'fixt-1.0.0.tgz');
  writeFileSync(cached, Buffer.concat([readFileSync(cached), Buffer.from('tampered')]));
  // offline, so the poisoned cache is the only tarball available: it must be rejected, not used
  const r = runTool({ ...w.env, CW_VENDOR_OFFLINE: '1', CW_NPM_REGISTRY: 'https://registry.invalid', CW_VENDOR_ROSTER: roster });
  assert.equal(r.code, 2);
  assert.equal(parse(r).assets[0].state, 'UNVERIFIABLE');
  rmSync(w.dir, { recursive: true, force: true });
});

test('fail closed: an unparseable roster is an error, not an empty clean run', () => {
  const w = world('badroster');
  const p = join(w.dir, 'broken.json');
  writeFileSync(p, '{ not json');
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: p });
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), '', 'no report is emitted for a roster that never loaded');
  assert.match(r.stderr, /vendor-verify:/);
  rmSync(w.dir, { recursive: true, force: true });
});

test('mixed roster: one verified, one mismatch — mismatch decides the exit code', () => {
  const w = world('mixed');
  const r = runTool({ ...w.env, CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_GOOD, ITEM_DRIFT]) });
  const rep = parse(r);
  assert.equal(r.code, 1);
  assert.deepEqual(rep.summary, { total: 2, verified: 1, mismatch: 1, unverifiable: 0 });
  rmSync(w.dir, { recursive: true, force: true });
});

test('determinism: same inputs produce byte-identical output', () => {
  const w = world('det');
  const roster = makeRoster(w.dir, [ITEM_DRIFT, ITEM_GOOD]); // deliberately unsorted
  const a = runTool({ ...w.env, CW_VENDOR_ROSTER: roster }).stdout;
  const b = runTool({ ...w.env, CW_VENDOR_ROSTER: roster }).stdout;
  assert.equal(a, b);
  assert.deepEqual(JSON.parse(a).assets.map((x) => x.path), ['vendor/drifted.js', 'vendor/good.js']);
  rmSync(w.dir, { recursive: true, force: true });
});

test('env is read at call time: CW_VENDOR_ROOT set after import still takes effect', async () => {
  const w = world('calltime');
  const mod = await import(pathToFileURL(TOOL).href);
  const saved = { ...process.env };
  Object.assign(process.env, w.env, { CW_VENDOR_ROSTER: makeRoster(w.dir, [ITEM_GOOD]) });
  const first = await mod.run();
  assert.equal(first.assets[0].state, 'verified');
  // repoint the root at a tree that has no such file — a module-load-time capture would ignore this
  const empty = tmp('calltime-empty');
  process.env.CW_VENDOR_ROOT = empty;
  const second = await mod.run();
  assert.equal(second.assets[0].state, 'UNVERIFIABLE');
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(empty, { recursive: true, force: true });
  rmSync(w.dir, { recursive: true, force: true });
});

test('readTar rejects a corrupted header rather than returning no entries', async () => {
  const mod = await import(pathToFileURL(TOOL).href);
  const dir = tmp('tarhdr');
  mkdirSync(join(dir, 'package'), { recursive: true });
  writeFileSync(join(dir, 'package', 'a.js'), GOOD);
  // relative operands for the same reason as makeRegistry above — a drive letter reads as a
  // remote host spec to GNU tar
  execFileSync('tar', ['-cf', 'p.tar', '-C', '.', 'package'], { cwd: dir });
  const buf = readFileSync(join(dir, 'p.tar'));
  assert.ok(mod.readTar(buf, new Set(['package/a.js'])).has('package/a.js'), 'baseline: the reader finds the entry');
  const broken = Buffer.from(buf);
  broken[150] = 0x39; // corrupt the stored header checksum
  assert.throws(() => mod.readTar(broken, new Set(['package/a.js'])), /checksum mismatch/);
  rmSync(dir, { recursive: true, force: true });
});

test('checkIntegrity refuses metadata with no anchor at all', async () => {
  const mod = await import(pathToFileURL(TOOL).href);
  const buf = Buffer.from('bytes');
  assert.equal(mod.checkIntegrity({}, buf).ok, false);
  assert.match(mod.checkIntegrity({}, buf).why, /nothing anchors/);
  assert.equal(mod.checkIntegrity({ integrity: `sha512-${createHash('sha512').update(buf).digest('base64')}` }, buf).ok, true);
  // cw-hazards-ignore: builds the registry's legacy sha1 shasum fixture
  assert.equal(mod.checkIntegrity({ shasum: createHash('sha1').update(buf).digest('hex') }, buf).ok, true);
});

test('the shipped roster names paths that exist in this repo', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return import(pathToFileURL(TOOL).href).then((mod) => {
    assert.ok(mod.ROSTER.length > 0, 'the roster is not empty');
    for (const item of mod.ROSTER) {
      assert.doesNotThrow(() => readFileSync(join(repoRoot, item.path)), `rostered asset ${item.path} exists`);
      assert.match(item.entry, /^package\//, 'npm tarball entries are rooted at package/');
    }
  });
});
