// Tests for lib/is-main.mjs — the guard must hold when the script is reached through a symlink.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../is-main.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const withTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-is-main-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Asserted from a spawned runner, not inline: under `node --test` this file IS argv[1], so a module
// asking about itself here is legitimately main and would prove nothing.
test('a module that is imported rather than run is not main', () => withTmp((dir) => {
  const mod = join(dir, 'lib-mod.mjs');
  writeFileSync(mod, `import { isMainModule } from '${join(REPO, 'lib', 'is-main.mjs')}';\n`
    + 'export const wasMain = isMainModule(import.meta.url);\n');
  const runner = join(dir, 'runner.mjs');
  writeFileSync(runner, `import { wasMain } from '${mod}';\nconsole.log(String(wasMain));\n`);
  assert.equal(execFileSync(process.execPath, [runner], { encoding: 'utf8' }).trim(), 'false');
}));

test('a module run directly IS main', () => withTmp((dir) => {
  const f = join(dir, 'direct.mjs');
  writeFileSync(f, `import { isMainModule } from '${join(REPO, 'lib', 'is-main.mjs')}';\n`
    + "if (isMainModule(import.meta.url)) console.log('RAN');\n");
  assert.equal(execFileSync(process.execPath, [f], { encoding: 'utf8' }).trim(), 'RAN');
}));

// The regression. `import.meta.url` is realpath-resolved, `process.argv[1]` is the path as typed,
// so comparing them is false through any link: the CLI block never runs and the process exits 0
// having printed nothing — a silent success indistinguishable from real work.
test('a module reached through a SYMLINK is still main', () => withTmp((dir) => {
  const real = join(dir, 'real.mjs');
  const link = join(dir, 'aliased.mjs');
  writeFileSync(real, `import { isMainModule } from '${join(REPO, 'lib', 'is-main.mjs')}';\n`
    + "if (isMainModule(import.meta.url)) console.log('RAN');\n");
  symlinkSync(real, link);
  const out = execFileSync(process.execPath, [link], { encoding: 'utf8' });
  assert.equal(out.trim(), 'RAN', 'empty stdout with exit 0 — the guard did not match through the link');
}));

test('a module reached through a symlinked DIRECTORY is still main', () => withTmp((dir) => {
  const realDir = join(dir, 'pkg');
  mkdirSync(realDir);
  writeFileSync(join(realDir, 'x.mjs'), `import { isMainModule } from '${join(REPO, 'lib', 'is-main.mjs')}';\n`
    + "if (isMainModule(import.meta.url)) console.log('RAN');\n");
  symlinkSync(realDir, join(dir, 'pkg-link'));
  assert.equal(execFileSync(process.execPath, [join(dir, 'pkg-link', 'x.mjs')], { encoding: 'utf8' }).trim(), 'RAN');
}));

test('no argv[1] (node -e) is not main', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { isMainModule } from '${join(REPO, 'lib', 'is-main.mjs')}';`
    + "console.log(String(isMainModule('file:///nowhere.mjs')));"], { encoding: 'utf8' });
  assert.equal(out.trim(), 'false');
});

// End-to-end on the real CLI: this is the reported bug. `cw list` through a symlink printed nothing
// and exited 0, which for a security runner reads as a clean run over zero checks.
test('the commitwork CLI lists checks through a symlinked repo, not silence-and-exit-0', () => withTmp((dir) => {
  const link = join(dir, 'repo-link');
  symlinkSync(REPO, link);
  const out = execFileSync(process.execPath, [join(link, 'bin', 'commitwork.mjs'), 'list', '--manifest', 'security-baseline'],
    { encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: join(dir, 'reports') }, timeout: 60000 });
  assert.ok(out.trim().length > 0, 'empty stdout with exit 0 — the main-module guard did not match');
  assert.match(out, /security-baseline/);
}));

// npm links a global bin as a symlink to the package file, so `npm i -g` and `npm link` reach the
// CLI by exactly this route, under whatever name package.json declares.
test('every declared package bin runs through a symlink under a different name', () => withTmp((dir) => {
  const pkg = JSON.parse(execFileSync('git', ['-C', REPO, 'show', 'HEAD:package.json'], { encoding: 'utf8' }));
  const bins = Object.values(pkg.bin ?? {});
  assert.ok(bins.length, 'package.json declares no bin — this test would assert nothing');
  for (const rel of bins) {
    const link = join(dir, 'cw');
    symlinkSync(join(REPO, rel), link);
    const out = execFileSync(process.execPath, [link, 'list', '--manifest', 'security-baseline'],
      { encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: join(dir, 'reports') }, timeout: 60000 });
    assert.ok(out.trim().length > 0, `${rel} through a symlink printed nothing and exited 0`);
  }
}));

// The wrapper form, which is what an alias in a shell profile expands to.
test('the CLI runs from a wrapper script that execs it under another name', () => withTmp((dir) => {
  const cw = join(dir, 'cw');
  writeFileSync(cw, `#!/bin/sh\nexec "${process.execPath}" "${join(REPO, 'bin', 'commitwork.mjs')}" "$@"\n`, { mode: 0o755 });
  const out = execFileSync(cw, ['list', '--manifest', 'security-baseline'],
    { encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: join(dir, 'reports') }, timeout: 60000 });
  assert.ok(out.trim().length > 0, 'a wrapper alias must run, not exit 0 in silence');
}));
