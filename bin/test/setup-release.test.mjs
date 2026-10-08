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

async function rig(t, { tamper = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'cw-setup-release-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const pkg = join(d, 'pkg');
  mkdirSync(pkg);
  writeFileSync(join(pkg, 'zz-leaks'), '#!/bin/sh\necho zz-leaks 1.0.0\n', { mode: 0o755 });
  writeFileSync(join(pkg, 'README.md'), 'not installed');
  execFileSync('tar', ['-czf', join(d, 'asset.tar.gz'), '-C', pkg, 'zz-leaks', 'README.md']);
  const body = readFileSync(join(d, 'asset.tar.gz'));
  const sha256 = createHash('sha256').update(tamper ? Buffer.concat([body, Buffer.from('x')]) : body).digest('hex');
  const server = createServer((req, res) => {
    if (req.url === '/o/zz/releases/download/v1.0.0/zz-leaks_1.0.0_linux.tar.gz') { res.writeHead(200); res.end(body); } else { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  const tools = { 'zz-leaks': { why: 'secrets', url: 'https://example.invalid/zz',
    release: { repo: 'o/zz', tag: 'v1.0.0', linux: { [process.arch]: { asset: 'zz-leaks_1.0.0_linux.tar.gz', sha256 } } } } };
  writeFileSync(join(d, 'catalog.json'), JSON.stringify({ tools }));
  const binDir = join(d, 'release-bin');
  const run = (args) => new Promise((ok) => {
    const child = spawn(process.execPath, [SETUP, ...args], { env: {
      PATH: '/usr/bin:/bin', HOME: join(d, 'home'), CW_INSTALL_CATALOG: join(d, 'catalog.json'), CW_SETUP_PLATFORM: 'linux',
      CW_SETUP_RELEASE_BASE: `http://127.0.0.1:${server.address().port}`, CW_SETUP_BIN_DIR: binDir,
    } });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('close', (code) => ok({ code, out }));
  });
  return { binDir, run };
}

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
