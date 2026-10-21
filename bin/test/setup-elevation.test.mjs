// bin/setup.mjs on Linux as a user who is not root: apt is on PATH, sudo is absent or asks for a
// password, and npm's global prefix refuses the user.
//
// Under --user 1000:1000 with no sudo, setup must not read an installed apt as "none installed",
// must say what to run as root, must name npm's EACCES rather than a plain "install failed", and
// must not exit 0 with failures. These cases drive setup
// against stub managers on a PATH holding nothing else, so no real package manager or sudo is
// reachable. CW_SETUP_UID pins the uid setup plans for, so a suite running as root still reaches the
// non-root path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmFailureReason, setupExitCode, elevatedCommand, SETUP_EXIT } from '../setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETUP = resolve(HERE, '..', 'setup.mjs');
const CLI = resolve(HERE, '..', 'commitwork.mjs');
const posix = { skip: process.platform === 'win32' && 'stub managers are sh scripts' };

// Leaves a mark when it runs, then installs what it was asked for under the binary's name.
const APT = `#!/bin/sh
d="\${0%/*}"
echo "$*" >> "$d/../apt-ran"
[ "$1" = update ] && exit 0
for a; do last="$a"; done
case "$last" in bubblewrap) name=bwrap ;; passt) name=pasta ;; *) name="$last" ;; esac
cp "$0" "$d/$name"
`;
// What npm prints when the global prefix is root-owned.
const NPM_EACCES = `#!/bin/sh
[ "$1" = install ] || exit 0
echo "npm error code EACCES" >&2
echo "npm error syscall mkdir" >&2
echo "npm error path /usr/local/lib/node_modules/@socketsecurity" >&2
echo "npm error errno -13" >&2
exit 243
`;
const SUDO_NEEDS_PASSWORD = '#!/bin/sh\necho "sudo: a password is required" >&2\nexit 1\n';
const PRESENT = '#!/bin/sh\nexit 0\n';

const TOOLS = {
  pipx: { why: 'manager', apt: 'pipx', brew: 'pipx', url: 'https://example.invalid/pipx' },
  bwrap: { why: 'linux sandbox', platforms: ['linux'], apt: 'bubblewrap', url: 'https://example.invalid/bwrap' },
  pasta: { why: 'linux lane network', platforms: ['linux'], apt: 'passt', url: 'https://example.invalid/pasta' },
  socket: { why: 'npm-only cli', npm: '@socketsecurity/cli', url: 'https://example.invalid/socket' },
  'zz-here': { why: 'already installed', brew: 'zz-here', url: 'https://example.invalid/zz-here' },
};

function rig(t, { sudo = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'cw-setup-elev-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const bin = join(d, 'bin');
  mkdirSync(bin);
  // Only these resolve: no real apt-get, npm, sudo or tar can be reached through PATH.
  for (const p of ['/bin/sh', '/bin/cp', '/usr/bin/env']) symlinkSync(p, join(bin, p.slice(p.lastIndexOf('/') + 1)));
  for (const [name, body] of [['apt-get', APT], ['npm', NPM_EACCES], ['zz-here', PRESENT], ...(sudo ? [['sudo', sudo]] : [])]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(d, 'catalog.json'), JSON.stringify({ tools: TOOLS }));
  const env = { PATH: bin, HOME: join(d, 'home'), CW_INSTALL_CATALOG: join(d, 'catalog.json'), CW_SETUP_PLATFORM: 'linux', CW_SETUP_UID: '1000' };
  const run = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [SETUP, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { d, bin, env, run, aptRan: () => existsSync(join(d, 'apt-ran')) };
}

test('not root and no sudo: apt reads as needing root, never as absent, and the run names what to run as root', posix, (t) => {
  const { run, aptRan } = rig(t);
  const { status, out } = run(['--yes']);
  assert.match(out, /package managers: npm usable · apt installed but needs root \(this user is not root and there is no sudo\)/);
  assert.match(out, /✗ pipx .*needs root: apt is installed, but this user is not root and there is no sudo — as root: apt-get update && apt-get install -y --no-install-recommends pipx/);
  assert.doesNotMatch(out, /none installed/, 'apt is installed; what is missing is permission');
  assert.doesNotMatch(out, /sudo apt-get/, 'there is no sudo to run');
  assert.match(out, /^ {2}needs an administrator — apt is installed, but this user is not root and there is no sudo\. Run:$/m);
  assert.match(out, /^ {6}as root: apt-get update && apt-get install -y --no-install-recommends pipx bubblewrap passt$/m);
  assert.match(out, /bwrap \(package bubblewrap\) and pasta \(package passt\) decide whether lanes are confined: without bwrap every lane runs unconfined; without pasta every lane with network egress is refused as noscan/);
  assert.equal(aptRan(), false, 'apt-get is never driven without root');
  assert.ok(out.lastIndexOf('needs an administrator') > out.lastIndexOf('socket install failed'), `the block closes the run:\n${out}`);
});

test('npm EACCES on the global prefix is named, and a failed install exits 20', posix, (t) => {
  const { run } = rig(t);
  const { status, out } = run(['--yes']);
  assert.match(out, /✗ socket install failed — needs a writable npm prefix \(EACCES on \/usr\/local\/lib\/node_modules\/@socketsecurity\) — set npm_config_prefix to a directory you own and put its bin on PATH, or run as a user who owns the prefix/);
  assert.match(out, /npm error code EACCES/, 'npm\'s own output is passed on');
  assert.equal(status, SETUP_EXIT.FAILED, out);
});

test('needing an administrator with nothing failed exits 21', posix, (t) => {
  const { run, aptRan } = rig(t);
  const { status, out } = run(['--yes', '--only', 'pipx,bwrap']);
  assert.equal(status, SETUP_EXIT.NEEDS_ROOT, out);
  assert.match(out, /as root: apt-get update && apt-get install -y --no-install-recommends pipx bubblewrap$/m);
  assert.match(out, /bwrap \(package bubblewrap\) decides whether lanes are confined/);
  assert.equal(aptRan(), false);
});

test('everything requested already present exits 0 with no administrator block', posix, (t) => {
  const { run } = rig(t);
  const { status, out } = run(['--yes', '--only', 'zz-here']);
  assert.equal(status, 0, out);
  assert.doesNotMatch(out, /needs an administrator/);
});

test('a report-only run requested nothing: exit 0, and the administrator block still prints', posix, (t) => {
  const { run } = rig(t);
  const { status, out } = run([]);
  assert.equal(status, 0, out);
  assert.match(out, /report only/);
  assert.match(out, /as root: apt-get update && apt-get install -y --no-install-recommends pipx bubblewrap passt$/m);
});

test('sudo that asks for a password gets the sudo form', posix, (t) => {
  const { run, aptRan } = rig(t, { sudo: SUDO_NEEDS_PASSWORD });
  const { status, out } = run(['--yes', '--only', 'pipx,pasta']);
  assert.match(out, /apt installed but needs root \(this user is not root and sudo asks for a password\)/);
  assert.match(out, /^ {6}sudo apt-get update && sudo apt-get install -y --no-install-recommends pipx passt$/m);
  assert.doesNotMatch(out, /as root:/);
  assert.equal(status, SETUP_EXIT.NEEDS_ROOT, out);
  assert.equal(aptRan(), false);
});

test('as root, apt is driven directly and the install counts', posix, (t) => {
  const { run, aptRan } = rig(t);
  const { status, out } = run(['--yes', '--only', 'pipx'], { CW_SETUP_UID: '0' });
  assert.equal(aptRan(), true, out);
  assert.match(out, /installed: pipx/);
  assert.doesNotMatch(out, /needs an administrator/);
  assert.equal(status, 0, out);
});

test('a name --only gave that the catalogue lacks is a request nothing can meet: exit 20', posix, (t) => {
  const { run } = rig(t);
  const { status, out } = run(['--yes', '--only', 'zz-here,zz-nope']);
  assert.match(out, /requested, and nothing here can install: zz-nope/);
  assert.equal(status, SETUP_EXIT.FAILED, out);
});

test('`commitwork setup` exits with setup\'s verdict', posix, (t) => {
  const { d, env } = rig(t);
  const r = spawnSync(process.execPath, [CLI, 'setup', '--yes', '--only', 'pipx'], {
    encoding: 'utf8', cwd: d,
    env: { ...env, TMPDIR: d, CW_REPORT_DIR: join(d, 'reports'), CW_SKIP_SETUP: '1', DOCKER_CONFIG: join(d, 'docker-config') },
  });
  assert.equal(r.status, SETUP_EXIT.NEEDS_ROOT, `${r.stdout}${r.stderr}`);
});

test('npmFailureReason names EACCES and nothing else', () => {
  assert.match(npmFailureReason('npm ERR! code EACCES\nnpm ERR! path /opt/npm/lib/node_modules\n'), /needs a writable npm prefix \(EACCES on \/opt\/npm\/lib\/node_modules\)/);
  assert.match(npmFailureReason('Error: EACCES: permission denied'), /^needs a writable npm prefix — set npm_config_prefix/);
  assert.equal(npmFailureReason('npm error code E404\n'), null);
  assert.equal(npmFailureReason(undefined), null);
});

test('setupExitCode counts what was requested; a failure outranks a needed administrator', () => {
  assert.equal(setupExitCode({ installed: [], failed: [], declined: ['a'] }), 0);
  assert.equal(setupExitCode({ installed: ['a'], failed: [], needsRoot: [], unavailable: [] }), 0);
  assert.equal(setupExitCode({ installed: [], failed: [], needsRoot: ['pipx'], unavailable: [] }), 21);
  assert.equal(setupExitCode({ installed: [], failed: ['socket'], needsRoot: ['pipx'], unavailable: [] }), 20);
  assert.equal(setupExitCode({ installed: [], failed: [], needsRoot: [], unavailable: ['x'] }), 20);
});

test('elevatedCommand spells both managers both ways', () => {
  assert.equal(elevatedCommand('apt', ['a', 'b'], 'absent'), 'as root: apt-get update && apt-get install -y --no-install-recommends a b');
  assert.equal(elevatedCommand('apt', ['a'], 'password'), 'sudo apt-get update && sudo apt-get install -y --no-install-recommends a');
  assert.equal(elevatedCommand('dnf', ['a'], 'absent'), 'as root: dnf install -y a');
  assert.equal(elevatedCommand('dnf', ['a'], 'password'), 'sudo dnf install -y a');
});
