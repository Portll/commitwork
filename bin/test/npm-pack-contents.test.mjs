// The npm tarball carries every wire-layer file and the licence texts its licence statements cite.
//
// npm pack reads the WORKING TREE, so this packs a git archive of HEAD rather than the checkout.
// Measured 2026-10-07: the tarball omitted mcp/ (the server and the Apache-licensed mcp/tools.mjs)
// and LICENSE-APACHE-2.0, because npm's automatic inclusion takes LICENSE but not a suffixed name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- win32-only so npm.cmd resolves; argv is constant
const npm = spawnSync('npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
const tracked = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const skip = npm.status !== 0 ? 'npm is not on PATH' : tracked.status !== 0 ? 'not a git checkout' : false;

function packedFiles(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-npm-pack-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const archive = spawnSync('sh', ['-c', `git -C "${REPO}" archive HEAD | tar -x -C "${dir}"`], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true -- win32-only so npm.cmd resolves; argv is constant
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, files: new Set(JSON.parse(r.stdout)[0].files.map((f) => f.path)) };
}

test('the tarball carries every wire-layer path and the licence texts', { skip }, (t) => {
  const { dir, files } = packedFiles(t);
  const wire = JSON.parse(readFileSync(join(dir, 'manifests', 'wire-layer.json'), 'utf8'));
  const missing = [];
  for (const e of wire.entries) {
    if (e.kind === 'directory') {
      if (![...files].some((f) => f.startsWith(e.path))) missing.push(e.path);
      if (e.marker && !files.has(e.marker)) missing.push(e.marker);
    } else if (!files.has(e.path)) missing.push(e.path);
  }
  for (const p of ['LICENSE', wire.licenseText, 'LICENSING.md', 'mcp/server.mjs']) if (!files.has(p)) missing.push(p);
  assert.deepEqual(missing, [], `npm pack leaves out: ${missing.join(', ')}`);
});

test('every repository-relative link in LICENSING.md that the tarball needs resolves inside it', { skip }, (t) => {
  const { dir, files } = packedFiles(t);
  const links = [...readFileSync(join(dir, 'LICENSING.md'), 'utf8').matchAll(/\]\(((?!https?:|#|mailto:)[^)#\s]+)\)/g)].map((m) => m[1]);
  // docs/stack/ is the four-part distribution's draft, parked in this repository; it is not shipped.
  const needed = links.filter((l) => !l.startsWith('docs/stack/') && existsSync(join(dir, l)));
  const missing = needed.filter((l) => !files.has(l));
  assert.deepEqual(missing, [], `LICENSING.md links outside the tarball: ${missing.join(', ')}`);
});
