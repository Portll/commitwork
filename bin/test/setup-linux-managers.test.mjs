// bin/setup.mjs on a Linux box with only a distribution package manager.
//
// Measured 2026-10-07 in clean node:22-bookworm and node:18-bookworm containers: with no brew, pipx,
// cargo, gem or go, setup installed 1 of 52 tools, and `apt-get install pipx` alone took the
// stranded count from 42 to 33. These cases drive setup against stub managers on PATH and a stub
// catalogue (CW_INSTALL_CATALOG), with CW_SETUP_PLATFORM standing in for Linux; nothing real is
// installed and no real sudo runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETUP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'setup.mjs');

// `<manager> install … <name>` copies this script to <name>, so an installed manager can install in turn.
const MANAGER = `#!/bin/sh
[ "$1" = install ] || exit 0
for a; do last="$a"; done
cp "$0" "$(dirname "$0")/$last"
`;
// Distribution package names differ from the binaries they provide.
const APT = `#!/bin/sh
d="$(dirname "$0")"
if [ "$1" = update ]; then echo x >> "$d/../apt-updates"; exit 0; fi
for a; do last="$a"; done
case "$last" in zz-ruby) name=zz-gem ;; bubblewrap) name=bwrap ;; *) name="$last" ;; esac
src="$d/.manager"; [ "$name" = pipx ] && [ -f "$d/.pipx" ] && src="$d/.pipx"
cp "$src" "$d/$name"
`;
// pipx as Debian ships it: binaries go to ~/.local/bin, which this process's PATH does not hold.
const PIPX_HOME_BIN = `#!/bin/sh
[ "$1" = install ] || exit 0
for a; do last="$a"; done
mkdir -p "$HOME/.local/bin"
cp "$0" "$HOME/.local/bin/$last"
`;
const SUDO_OK = '#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n';
const SUDO_NEEDS_PASSWORD = '#!/bin/sh\necho "sudo: a password is required" >&2\nexit 1\n';

const TOOLS = {
  pipx: { why: 'manager', apt: 'pipx', url: 'https://example.invalid/pipx' },
  'zz-py': { why: 'installable only by pipx', pipx: 'zz-py', url: 'https://example.invalid/zz-py' },
  bwrap: { why: 'linux sandbox', platforms: ['linux'], apt: 'bubblewrap', url: 'https://example.invalid/bwrap' },
  'zz-gem': { why: 'manager that arrives with its runtime', apt: 'zz-ruby', url: 'https://example.invalid/gem' },
};

function rig(t, { sudo, platform, pipx = null }) {
  const d = mkdtempSync(join(tmpdir(), 'cw-setup-linux-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const bin = join(d, 'bin');
  mkdirSync(bin);
  for (const [name, body] of [['.manager', MANAGER], ['apt-get', APT], ['sudo', sudo], ...(pipx ? [['.pipx', pipx]] : [])]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(d, 'catalog.json'), JSON.stringify({ tools: TOOLS }));
  const run = (args) => execFileSync(process.execPath, [SETUP, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: join(d, 'home'), CW_INSTALL_CATALOG: join(d, 'catalog.json'), CW_SETUP_PLATFORM: platform },
  });
  const updates = () => (existsSync(join(d, 'apt-updates')) ? readFileSync(join(d, 'apt-updates'), 'utf8').split('\n').filter(Boolean).length : 0);
  return { d, bin, run, updates };
}

test('apt installs the managers, and the tools they unlock follow in the same --yes run', { skip: process.platform === 'win32' && 'stub managers are sh scripts' }, (t) => {
  const { bin, run, updates } = rig(t, { sudo: SUDO_OK, platform: 'linux' });
  const out = run(['--yes']);
  for (const name of ['pipx', 'zz-gem', 'bwrap']) assert.ok(existsSync(join(bin, name)), `${name} not installed:\n${out}`);
  assert.ok(existsSync(join(bin, 'zz-py')), `zz-py waited for a second run:\n${out}`);
  assert.equal(updates(), 1, 'the package index is refreshed once per run, before the first install');
  assert.match(out, /sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends pipx/);
});

test('without root, apt is reported with the one command to run, and nothing is installed', { skip: process.platform === 'win32' && 'stub managers are sh scripts' }, (t) => {
  const { bin, run, updates } = rig(t, { sudo: SUDO_NEEDS_PASSWORD, platform: 'linux' });
  const out = run(['--yes']);
  assert.match(out, /sudo apt-get update && sudo apt-get install -y --no-install-recommends pipx bubblewrap zz-ruby/);
  assert.equal(existsSync(join(bin, 'pipx')), false);
  assert.equal(updates(), 0);
});

test('off Linux, apt is not a manager and the Linux-only sandbox is not reported missing', { skip: process.platform === 'win32' && 'stub managers are sh scripts' }, (t) => {
  const { bin, run } = rig(t, { sudo: SUDO_OK, platform: 'darwin' });
  const out = run(['--yes']);
  assert.match(out, /scanner toolchain: 0\/3 present/);
  assert.doesNotMatch(out, /bwrap/);
  assert.equal(existsSync(join(bin, 'pipx')), false);
});

test('a tool its manager put outside PATH is reported installed with the directory to add, never failed', { skip: process.platform === 'win32' && 'stub managers are sh scripts' }, (t) => {
  const { d, run } = rig(t, { sudo: SUDO_OK, platform: 'linux', pipx: PIPX_HOME_BIN });
  const out = run(['--yes', '--only', 'pipx,zz-py']);
  assert.ok(existsSync(join(d, 'home', '.local', 'bin', 'zz-py')), out);
  assert.doesNotMatch(out, /zz-py install failed/);
  assert.match(out, /installed: pipx, zz-py/);
  assert.match(out, /zz-py installed in \S+\/\.local\/bin, which is not on PATH/);
});
