// bin/setup.mjs re-plans when an install brings a package manager with it.
//
// Measured on a Linux container 2026-10-07: brew installed cargo and composer, and cargo-audit,
// psalm and phpcs-security-audit stayed missing until a second `setup --yes`, because managers were
// detected once before any install. These cases run setup as a child process against a stub PATH
// and a stub catalogue (CW_INSTALL_CATALOG): nothing real is installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETUP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'setup.mjs');

// `<manager> install <name>` (or `cargo install <name> --locked`) writes another copy of this
// script as <name>, so an installed manager can install in turn.
const STUB = `#!/bin/sh
[ "$1" = install ] || exit 0
cp "$0" "$(dirname "$0")/$2"
`;

function rig(t, tools) {
  const d = mkdtempSync(join(tmpdir(), 'cw-setup-replan-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const bin = join(d, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'brew'), STUB);
  chmodSync(join(bin, 'brew'), 0o755);
  writeFileSync(join(d, 'catalog.json'), JSON.stringify({ tools }));
  const run = (args) => execFileSync(process.execPath, [SETUP, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: join(d, 'home'), CW_INSTALL_CATALOG: join(d, 'catalog.json') },
  });
  return { bin, run };
}

// `cargo` must be a manager setup knows; the stub PATH holds no real one.
const TOOLS = {
  cargo: { why: 'a manager brew installs', brew: 'cargo', url: 'https://example.invalid/cargo' },
  'zz-audit': { why: 'installable only by cargo', cargo: 'cargo install zz-audit --locked', url: 'https://example.invalid/zz-audit' },
};

test('a tool whose manager arrives during the run is installed in the same --yes run', (t) => {
  const { bin, run } = rig(t, TOOLS);
  const out = run(['--yes']);
  assert.ok(existsSync(join(bin, 'cargo')), out);
  assert.ok(existsSync(join(bin, 'zz-audit')), `zz-audit waited for a second run:\n${out}`);
  assert.match(out, /installed: cargo, zz-audit/);
});

test('the catalogue is read from CW_INSTALL_CATALOG at call time', (t) => {
  const { run } = rig(t, { zzonly: { why: 'stub', brew: 'zzonly', url: 'https://example.invalid' } });
  const out = run([]);
  assert.match(out, /scanner toolchain: 0\/1 present/);
  assert.match(out, /zzonly/);
});
