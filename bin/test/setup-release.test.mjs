// bin/setup.mjs's release installer: a pinned upstream asset, refused unless its SHA-256 is the
// catalogued one. gitleaks and trufflehog had no Linux installer but brew, so the two secrets lanes
// stayed blocked on a Linux box without Homebrew. A local HTTP server stands in for the release
// host (CW_SETUP_RELEASE_BASE); no network is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETUP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'setup.mjs');
const POSIX = process.platform !== 'win32';

// signing: undefined (no block) | 'none' | { cosign: 'ok' | 'fail' | 'absent', signedSha?: string }
// platform: the CW_SETUP_PLATFORM the catalogue pins for; win32 ships a zip holding zz-leaks.exe
async function rig(t, { tamper = false, signing, platform = 'linux', brew = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'cw-setup-release-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const pkg = join(d, 'pkg');
  mkdirSync(pkg);
  const bin = platform === 'win32' ? 'zz-leaks.exe' : 'zz-leaks';
  writeFileSync(join(pkg, bin), '#!/bin/sh\necho zz-leaks 1.0.0\n', { mode: 0o755 });
  writeFileSync(join(pkg, 'README.md'), 'not installed');
  const ASSET = platform === 'win32' ? 'zz-leaks_1.0.0_windows.zip' : `zz-leaks_1.0.0_${platform}.tar.gz`;
  if (platform === 'win32') execFileSync('zip', ['-qj', join(d, ASSET), join(pkg, bin), join(pkg, 'README.md')]);
  else execFileSync('tar', ['-czf', join(d, ASSET), '-C', pkg, bin, 'README.md']);
  const body = readFileSync(join(d, ASSET));
  const sha256 = createHash('sha256').update(tamper ? Buffer.concat([body, Buffer.from('x')]) : body).digest('hex');
  const files = { [ASSET]: body };
  if (typeof signing === 'object') {
    files['zz-leaks_1.0.0_checksums.txt'] = Buffer.from(`${signing.signedSha || sha256}  ${ASSET}\n`);
    files['zz-leaks_1.0.0_checksums.txt.sig'] = Buffer.from('sig');
    files['zz-leaks_1.0.0_checksums.txt.pem'] = Buffer.from('pem');
  }
  const server = createServer((req, res) => {
    const name = req.url.startsWith('/o/zz/releases/download/v1.0.0/') ? req.url.slice('/o/zz/releases/download/v1.0.0/'.length) : null;
    if (name && files[name]) { res.writeHead(200); res.end(files[name]); } else { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  const release = { repo: 'o/zz', tag: 'v1.0.0', [platform]: { [process.arch]: { asset: ASSET, sha256 } } };
  if (signing === 'none') release.signing = { kind: 'none', checkedAt: '2026-10-08' };
  if (typeof signing === 'object') release.signing = { kind: 'cosign-checksums', checksums: 'zz-leaks_1.0.0_checksums.txt', identity: '^https://github\\.com/o/zz/', issuer: 'https://token.actions.githubusercontent.com' };
  const tools = { 'zz-leaks': { why: 'secrets', url: 'https://example.invalid/zz', ...(brew ? { brew: 'zz-leaks' } : {}), release } };
  writeFileSync(join(d, 'catalog.json'), JSON.stringify({ tools }));
  const stubs = join(d, 'stubs');
  mkdirSync(stubs);
  if (typeof signing === 'object' && signing.cosign !== 'absent') {
    writeFileSync(join(stubs, 'cosign'), `#!/bin/sh\n[ "$1" = version ] && exit 0\n${signing.cosign === 'ok' ? 'echo "Verified OK"; exit 0' : 'echo "no matching signatures" >&2; exit 1'}\n`, { mode: 0o755 });
  }
  if (brew) writeFileSync(join(stubs, 'brew'), `#!/bin/sh\necho "brew ran: $*" >> '${join(d, 'brew.log')}'\nexit 0\n`, { mode: 0o755 });
  const binDir = join(d, 'release-bin');
  const run = (args) => new Promise((ok) => {
    const child = spawn(process.execPath, [SETUP, ...args], { env: {
      PATH: `${stubs}:/usr/bin:/bin`, HOME: join(d, 'home'), CW_INSTALL_CATALOG: join(d, 'catalog.json'), CW_SETUP_PLATFORM: platform,
      CW_SETUP_RELEASE_BASE: `http://127.0.0.1:${server.address().port}`, CW_SETUP_BIN_DIR: binDir, CW_COSIGN_BIN: 'cosign', CW_TOOL_PROVENANCE: join(d, 'provenance.json'),
    } });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('close', (code) => ok({ code, out }));
  });
  const provenance = () => (existsSync(join(d, 'provenance.json')) ? JSON.parse(readFileSync(join(d, 'provenance.json'), 'utf8')).tools : null);
  return { binDir, run, provenance, brewLog: () => (existsSync(join(d, 'brew.log')) ? readFileSync(join(d, 'brew.log'), 'utf8') : '') };
}

test('a successful release install records its channel and signature tier for doctor to read', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { run, provenance } = await rig(t, { signing: { cosign: 'ok' } });
  const { out } = await run(['--yes']);
  assert.match(out, /installed: zz-leaks/);
  const rec = provenance()?.['zz-leaks'];
  assert.ok(rec, 'record written');
  assert.equal(rec.channel, 'release/cosign');
  assert.equal(rec.signatureTier, 'cosign');
  assert.match(rec.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('an unsigned pin records release/sha256, and a refused install records nothing', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const a = await rig(t, { signing: 'none' });
  await a.run(['--yes']);
  assert.equal(a.provenance()?.['zz-leaks']?.channel, 'release/sha256');
  const b = await rig(t, { signing: { cosign: 'fail' } });
  await b.run(['--yes']);
  assert.equal(b.provenance(), null, 'a refused install leaves no record');
});

test('a pinned release outranks brew on macOS: the publisher bytes install and brew never runs', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run, brewLog } = await rig(t, { platform: 'darwin', signing: 'none', brew: true });
  const { out } = await run(['--yes']);
  assert.ok(existsSync(join(binDir, 'zz-leaks')), out);
  assert.match(out, /download http:\/\/127\.0\.0\.1:\d+\/o\/zz\/releases\/download\/v1\.0\.0\/zz-leaks_1\.0\.0_darwin\.tar\.gz/);
  assert.equal(brewLog(), '', 'brew was on PATH and catalogued, and was not asked');
});

test('a Windows pin is a zip holding the .exe, read by the same tar verb and installed under its own name', { skip: !POSIX && 'sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t, { platform: 'win32', signing: 'none' });
  const { out } = await run(['--yes']);
  assert.ok(existsSync(join(binDir, 'zz-leaks.exe')), out);
  assert.equal(existsSync(join(binDir, 'README.md')), false);
  assert.match(out, /installed: zz-leaks/);
});

test('a pinned release asset is verified, its binary alone installed, and the off-PATH directory named', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t);
  const { out } = await run(['--yes']);
  assert.ok(existsSync(join(binDir, 'zz-leaks')), out);
  assert.ok(statSync(join(binDir, 'zz-leaks')).mode & 0o100, 'installed executable');
  assert.equal(existsSync(join(binDir, 'README.md')), false, 'only the tool binary leaves the archive');
  assert.match(out, /installed: zz-leaks/);
  assert.match(out, /zz-leaks installed in \S+release-bin, which is not on PATH/);
});

test('an asset whose SHA-256 is not the pinned one is refused and nothing is installed', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t, { tamper: true });
  const { out } = await run(['--yes']);
  assert.match(out, /zz-leaks REFUSED — sha256 [0-9a-f]{64} is not the pinned/);
  assert.equal(existsSync(join(binDir, 'zz-leaks')), false);
  assert.doesNotMatch(out, /installed: zz-leaks/);
});

test('a pin with no signing block installs and is reported as undetermined, never as signed', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t);
  const { out } = await run(['--yes']);
  assert.ok(existsSync(join(binDir, 'zz-leaks')), out);
  assert.match(out, /zz-leaks: sha256 pinned; publisher signature: undeclared in the catalogue \(undetermined\)/);
  assert.doesNotMatch(out, /signature verified/);
});

test('a measured absence of a publisher signature installs at the sha256 tier with its check date', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t, { signing: 'none' });
  const { out } = await run(['--yes']);
  assert.ok(existsSync(join(binDir, 'zz-leaks')), out);
  assert.match(out, /zz-leaks: sha256 pinned; publisher signature: none published \(checked 2026-10-08\)/);
});

test('a cosign-signed release installs only after cosign verifies the checksums file', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t, { signing: { cosign: 'ok' } });
  const { out } = await run(['--yes']);
  assert.ok(existsSync(join(binDir, 'zz-leaks')), out);
  assert.match(out, /zz-leaks: sha256 pinned; publisher signature verified: cosign keyless, identity \^https/);
  assert.match(out, /installed: zz-leaks/);
});

test('a cosign-signed release whose signature does not verify is refused and nothing is installed', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t, { signing: { cosign: 'fail' } });
  const { out } = await run(['--yes']);
  assert.match(out, /zz-leaks REFUSED — cosign verify-blob exit 1 — no matching signatures/);
  assert.equal(existsSync(join(binDir, 'zz-leaks')), false);
  assert.doesNotMatch(out, /installed: zz-leaks/);
});

test('a cosign-signed release whose signed digest differs from the pin is refused even though cosign said OK', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t, { signing: { cosign: 'ok', signedSha: 'c'.repeat(64) } });
  const { out } = await run(['--yes']);
  assert.match(out, /zz-leaks REFUSED — signed checksum c{64} disagrees with the pinned [0-9a-f]{64}/);
  assert.equal(existsSync(join(binDir, 'zz-leaks')), false);
});

test('a cosign-signed release on a box without cosign is refused, not installed unsigned', { skip: !POSIX && 'tar archives and sh stubs' }, async (t) => {
  const { binDir, run } = await rig(t, { signing: { cosign: 'absent' } });
  const { out } = await run(['--yes']);
  assert.match(out, /zz-leaks REFUSED — release is cosign-signed and cosign is not installed \(brew install cosign/);
  assert.equal(existsSync(join(binDir, 'zz-leaks')), false);
});
