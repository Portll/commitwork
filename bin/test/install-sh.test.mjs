// node --test bin/test/install-sh.test.mjs
//
// bin/install.sh against throwaway prefixes. The source is a stub tree: the real lib/node-floor.mjs
// beside a bin/setup.mjs that records what it was asked and reports what the test tells it to, so
// nothing is downloaded and no scanner is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin', 'install.sh');
const WIN = process.platform === 'win32';
const has = (bin) => !WIN && spawnSync('sh', ['-c', 'command -v "$1"', 'sh', bin], { stdio: 'ignore' }).status === 0;
const skip = WIN ? 'install.sh is POSIX sh; Windows installs through npm (README, "Windows")' : false;

const SETUP_STUB = `import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// the real module runs itself when argv[1] names it; record it if that ever happens here
const self = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (self) appendFileSync(process.env.STUB_SETUP_LOG, 'SELF-RUN\\n');
const env = (k) => (process.env[k] || '').split(',').filter(Boolean);
export const loadCatalog = () => ({ tools: { 'fake-a': {}, 'fake-b': {} } });
export async function runSetup(opts) {
  appendFileSync(process.env.STUB_SETUP_LOG, JSON.stringify(opts) + '\\n');
  return { installed: opts.only, failed: env('STUB_SETUP_FAILED'), declined: [] };
}
const via = (name) => (env('STUB_SETUP_VIA').find((v) => v.startsWith(name + '=')) || '').split('=')[1] || null;
export function toolPlan(only) {
  return (only.length ? only : ['fake-a', 'fake-b']).map((name) => ({ name, present: !env('STUB_SETUP_MISSING').includes(name), via: via(name) }));
}
`;

function fixture({ floor = '>=18.0.0', name = 'commitwork' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cw-install-sh-')));
  const src = join(dir, 'src');
  mkdirSync(join(dir, 'home'));
  const put = (rel, body) => { mkdirSync(dirname(join(src, rel)), { recursive: true }); writeFileSync(join(src, rel), body); };
  put('package.json', `${JSON.stringify({ name, version: '9.9.9', engines: { node: floor } })}\n`);
  mkdirSync(join(src, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'lib', 'node-floor.mjs'), join(src, 'lib', 'node-floor.mjs'));
  put('bin/commitwork.mjs', "console.log('stub commitwork ' + JSON.stringify(process.argv.slice(2)));\n");
  put('bin/setup.mjs', SETUP_STUB);
  put('manifests/install-catalog.json', '{"tools":{"fake-a":{},"fake-b":{}}}\n');
  return { dir, src, prefix: join(dir, 'prefix'), log: join(dir, 'setup.log'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function install(fx, args, { shell = 'sh', env = {} } = {}) {
  const from = args.includes('--from') ? [] : ['--from', fx.src];
  const r = spawnSync(shell, [SCRIPT, '--prefix', fx.prefix, ...from, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`, HOME: join(fx.dir, 'home'), STUB_SETUP_LOG: fx.log,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Every file under dir as path -> sha256 (and mode), so two installs compare byte for byte. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p);
      else out[p.slice(dir.length)] = `${createHash('sha256').update(readFileSync(p)).digest('hex')} ${(statSync(p).mode & 0o777).toString(8)}`;
    }
  };
  walk(dir);
  return out;
}

const leftovers = (fx) => readdirSync(join(fx.prefix, 'lib')).filter((n) => n.startsWith('.commitwork-install.'));

test('a directory installs into the prefix, the launcher runs it, and a re-run is byte-identical', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    const shells = ['sh', 'sh', ...(has('dash') ? ['dash'] : [])];
    let first = null;
    for (const [i, shell] of shells.entries()) {
      const r = install(fx, [], { shell });
      assert.equal(r.status, 0, `${shell}: ${r.out}`);
      const snap = { dest: snapshot(dest), launcher: readFileSync(join(fx.prefix, 'bin', 'commitwork'), 'utf8') };
      if (first) {
        assert.deepEqual(snap, first, `${shell} re-run changed the install`);
        assert.deepEqual(snapshot(`${dest}.previous`), first.dest, `${shell}: the replaced tree is kept whole beside the new one`);
        assert.match(r.out, /the tree it replaced is kept at .*commitwork\.previous/);
      } else assert.equal(existsSync(`${dest}.previous`), false, 'a first install has nothing to keep');
      first = snap;
      assert.deepEqual(readdirSync(join(fx.prefix, 'lib')).sort(), i ? ['commitwork', 'commitwork.previous'] : ['commitwork'], 'one generation kept, no more');
    }
    assert.equal(readFileSync(join(dest, '.commitwork-install'), 'utf8'), 'commitwork 9.9.9\nsource directory\n');
    const listed = readFileSync(join(dest, '.commitwork-files'), 'utf8').trim().split('\n');
    assert.match(listed[0], /^# commitwork-files v1/);
    assert.deepEqual(listed.slice(1).map((l) => JSON.parse(l)), ['.commitwork-files', '.commitwork-install', 'bin', 'bin/commitwork.mjs', 'bin/setup.mjs',
      'lib', 'lib/node-floor.mjs', 'manifests', 'manifests/install-catalog.json', 'package.json'], 'the list names every path the installer wrote, and only those');
    const run = spawnSync(join(fx.prefix, 'bin', 'commitwork'), ['doctor', 'x y'], { encoding: 'utf8', env: { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` } });
    assert.equal(run.stdout.trim(), 'stub commitwork ["doctor","x y"]', run.stderr);
    assert.deepEqual(leftovers(fx), [], 'a staging directory was left behind');
    assert.equal(existsSync(fx.log), false, 'setup ran although --scanners defaulted to none');
  } finally { fx.cleanup(); }
});

test('--scanners hands the names to setup with --yes; a failed or still-missing tool is exit 22, after the tree is in place', { skip }, () => {
  const fx = fixture();
  try {
    assert.equal(install(fx, ['--scanners', 'fake-a,fake-b']).status, 0);
    assert.deepEqual(readFileSync(fx.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)), [{ yes: true, only: ['fake-a', 'fake-b'] }], 'setup ran once, with --yes and the names');
    const failed = install(fx, ['--scanners', 'fake-a'], { env: { STUB_SETUP_FAILED: 'fake-a', STUB_SETUP_MISSING: 'fake-a' } });
    assert.equal(failed.status, 22, failed.out);
    assert.match(failed.out, /failed to install: fake-a/);
    const missing = install(fx, ['--scanners', 'fake-b'], { env: { STUB_SETUP_MISSING: 'fake-b' } });
    assert.equal(missing.status, 22, missing.out);
    assert.match(missing.out, /still missing: fake-b/);
    assert.ok(existsSync(join(fx.prefix, 'bin', 'commitwork')), 'the launcher is written before setup runs');
    const all = install(fx, ['--scanners', 'all'], { env: { STUB_SETUP_MISSING: 'fake-b' } });
    assert.equal(all.status, 0, `with all, a tool with no installer here is listed, not failed: ${all.out}`);
    assert.match(all.out, /1 catalogue tool\(s\) are not installed here.*fake-b/);
    assert.deepEqual(JSON.parse(readFileSync(fx.log, 'utf8').trim().split('\n').at(-1)), { yes: true, only: [] });
  } finally { fx.cleanup(); }
});

test('refusals happen before anything is installed', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    const unknown = install(fx, ['--scanners', 'fake-a,nope']);
    assert.equal(unknown.status, 2, unknown.out);
    assert.match(unknown.out, /not in manifests\/install-catalog\.json: nope/);
    assert.equal(existsSync(dest), false);
    assert.equal(install(fx, ['--bogus']).status, 2);
    assert.equal(install(fx, ['--scanners', 'a;rm']).status, 2);
    assert.equal(install(fx, ['--from', join(fx.dir, 'absent')]).status, 21);
    assert.equal(install(fx, ['--dest', fx.src]).status, 21, 'the source itself');
    assert.equal(install(fx, ['--dest', join(fx.src, 'inner')]).status, 21, 'inside the source');
    assert.equal(install(fx, ['--dest', join(fx.dir, 'home')]).status, 21, 'the home directory');
    assert.equal(existsSync(dest), false);
    assert.deepEqual(leftovers(fx), []);
  } finally { fx.cleanup(); }
});

test('--release-only installs only what setup would take from a pinned release, and refuses the rest first', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    const missing = { STUB_SETUP_MISSING: 'fake-a,fake-b' };
    const other = install(fx, ['--release-only', '--scanners', 'fake-a,fake-b'], { env: { ...missing, STUB_SETUP_VIA: 'fake-a=release,fake-b=pipx' } });
    assert.equal(other.status, 2, other.out);
    assert.match(other.out, /not from a pinned release here: fake-b \(setup would use pipx\)/);
    const none = install(fx, ['--release-only', '--scanners', 'fake-a'], { env: { STUB_SETUP_MISSING: 'fake-a' } });
    assert.equal(none.status, 2, none.out);
    assert.match(none.out, /fake-a \(no installer\)/);
    assert.equal(install(fx, ['--release-only', '--scanners', 'all']).status, 2);
    assert.equal(existsSync(dest), false, 'a refusal installs nothing');
    assert.equal(existsSync(fx.log), false, 'and never reaches setup');
    const ok = install(fx, ['--release-only', '--scanners', 'fake-a,fake-b'], { env: { STUB_SETUP_MISSING: 'fake-a', STUB_SETUP_VIA: 'fake-a=release,fake-b=pipx' } });
    assert.equal(ok.status, 22, `fake-b is present, so only fake-a is planned; the stub then reports it still missing: ${ok.out}`);
    assert.ok(existsSync(dest));
    assert.deepEqual(JSON.parse(readFileSync(fx.log, 'utf8').trim()), { yes: true, only: ['fake-a', 'fake-b'] });
  } finally { fx.cleanup(); }
});

test('a Node below the floor is exit 20 and installs nothing; a tree that is not commitwork is exit 21', { skip }, () => {
  for (const [opts, code, re] of [[{ floor: '>=99.0.0' }, 20, /below the supported floor 99\.0\.0/], [{ name: 'other' }, 21, /not commitwork/]]) {
    const fx = fixture(opts);
    try {
      const r = install(fx, []);
      assert.equal(r.status, code, r.out);
      assert.match(r.out, re);
      assert.equal(existsSync(join(fx.prefix, 'lib', 'commitwork')), false);
      assert.equal(existsSync(join(fx.prefix, 'bin', 'commitwork')), false);
      assert.deepEqual(leftovers(fx), []);
    } finally { fx.cleanup(); }
  }
});

test('an existing dest or launcher it did not write is left alone; an empty dest is taken', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'keep'), 'data');
    const r = install(fx, []);
    assert.equal(r.status, 21, r.out);
    assert.equal(readFileSync(join(dest, 'keep'), 'utf8'), 'data');
    rmSync(join(dest, 'keep'));
    mkdirSync(join(fx.prefix, 'bin'), { recursive: true });
    writeFileSync(join(fx.prefix, 'bin', 'commitwork'), '#!/bin/sh\necho mine\n');
    assert.equal(install(fx, []).status, 21);
    assert.equal(readFileSync(join(fx.prefix, 'bin', 'commitwork'), 'utf8'), '#!/bin/sh\necho mine\n');
    const noLink = install(fx, ['--no-link']);
    assert.equal(noLink.status, 0, noLink.out);
    assert.ok(existsSync(join(dest, 'bin', 'commitwork.mjs')));
  } finally { fx.cleanup(); }
});

test('a tarball needs its sha256 and is refused on a mismatch', { skip }, () => {
  const fx = fixture();
  try {
    const stage = join(fx.dir, 'pack');
    mkdirSync(stage);
    assert.equal(spawnSync('cp', ['-R', fx.src, join(stage, 'package')]).status, 0);
    const tgz = join(fx.dir, 'commitwork-9.9.9.tgz');
    assert.equal(spawnSync('tar', ['-czf', tgz, '-C', stage, 'package']).status, 0);
    const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
    assert.equal(install(fx, ['--from', tgz]).status, 2);
    const wrong = install(fx, ['--from', tgz, '--sha256', '0'.repeat(64)]);
    assert.equal(wrong.status, 21, wrong.out);
    assert.match(wrong.out, /refusing it/);
    assert.equal(existsSync(join(fx.prefix, 'lib', 'commitwork')), false);
    const ok = install(fx, ['--from', tgz, '--sha256', sha]);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(readFileSync(join(fx.prefix, 'lib', 'commitwork', '.commitwork-install'), 'utf8'), `commitwork 9.9.9\nsource tarball sha256:${sha}\n`);
  } finally { fx.cleanup(); }
});

test('a git checkout installs its HEAD, not its uncommitted edits', { skip: skip || (!has('git') && 'git is not on PATH') }, () => {
  const fx = fixture();
  try {
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', fx.src, ...a],
      { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
    for (const a of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) assert.equal(git(...a).status, 0, a.join(' '));
    const head = git('rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(fx.src, 'bin', 'commitwork.mjs'), "console.log('uncommitted');\n");
    writeFileSync(join(fx.src, 'untracked.txt'), 'x');
    const r = install(fx, ['--from', fx.src]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /uncommitted changes; they are not installed/);
    const dest = join(fx.prefix, 'lib', 'commitwork');
    assert.match(readFileSync(join(dest, 'bin', 'commitwork.mjs'), 'utf8'), /stub commitwork/);
    assert.equal(existsSync(join(dest, 'untracked.txt')), false);
    assert.equal(existsSync(join(dest, '.git')), false);
    assert.equal(readFileSync(join(dest, '.commitwork-install'), 'utf8'), `commitwork 9.9.9\nsource git ${head}\n`);
  } finally { fx.cleanup(); }
});

// ── upgrades: the operator's data survives a re-install ───────────────────────────────────────────
// `commitwork init` writes its registry inside the installed tree, and a re-install used to replace
// that tree and delete the old one on exit, registry included, with exit 0.

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const mode = (p) => (statSync(p).mode & 0o777).toString(8);
const shells = () => ['sh', ...(has('dash') ? ['dash'] : [])];
const put = (root, rel, body, m) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
  if (m !== undefined) chmodSync(join(root, rel), m);
};
const runs = (fx) => spawnSync(join(fx.prefix, 'bin', 'commitwork'), ['doctor'], { encoding: 'utf8', env: { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}` } });

test('an upgrade carries the operator data into the new tree, modes and symlinks kept, and keeps the old tree at <dest>.previous', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    assert.equal(install(fx, []).status, 0);
    const registry = '{"projects":[],"areas":[{"slug":"local","out":"local"}],"roots":[{"path":"/tmp/fleet-example"}]}\n';
    mkdirSync(join(dest, 'monitor', 'private'), { recursive: true, mode: 0o700 });
    chmodSync(join(dest, 'monitor', 'private'), 0o700);
    put(dest, 'monitor/private/projects.json', registry, 0o600);
    put(dest, 'reports/run-1/summary.json', '{"ok":true}\n');
    symlinkSync('run-1', join(dest, 'reports', 'latest'));
    put(dest, '.claude/settings.json', '{}\n');
    put(dest, 'notes/operator.txt', 'an operator file in a directory the installer never made\n', 0o640);
    put(dest, 'bin/local-helper.sh', '#!/bin/sh\necho mine\n', 0o750);
    const before = sha(join(dest, 'monitor/private/projects.json'));
    for (const shell of shells()) {
      const r = install(fx, [], { shell });
      assert.equal(r.status, 0, `${shell}: ${r.out}`);
      assert.equal(sha(join(dest, 'monitor/private/projects.json')), before, `${shell}: the registry survived the upgrade byte for byte`);
      assert.equal(mode(join(dest, 'monitor/private/projects.json')), '600');
      assert.equal(mode(join(dest, 'monitor/private')), '700', 'a private directory stays private');
      assert.equal(readlinkSync(join(dest, 'reports', 'latest')), 'run-1', 'a symlink is copied as a symlink, not followed');
      assert.ok(lstatSync(join(dest, 'reports', 'latest')).isSymbolicLink());
      assert.equal(readFileSync(join(dest, 'reports/run-1/summary.json'), 'utf8'), '{"ok":true}\n');
      assert.equal(readFileSync(join(dest, '.claude/settings.json'), 'utf8'), '{}\n');
      assert.equal(mode(join(dest, 'notes/operator.txt')), '640');
      assert.equal(mode(join(dest, 'bin/local-helper.sh')), '750', 'a file beside the installer files in a shipped directory is carried too');
      assert.match(r.out, /carried 5 operator path\(s\).*\.claude, bin\/local-helper\.sh, monitor, notes, reports/);
      assert.equal(sha(join(`${dest}.previous`, 'monitor/private/projects.json')), before, `${shell}: and the old tree still holds it`);
      assert.match(r.out, /kept at .*commitwork\.previous/);
      assert.deepEqual(leftovers(fx), []);
    }
    assert.ok(!readFileSync(join(dest, '.commitwork-files'), 'utf8').includes('monitor/private'), 'carried data is not listed as installer files, so the next upgrade carries it again');
  } finally { fx.cleanup(); }
});

test('an operator path the new tree also ships is refused by name, and the old tree stays in place and usable', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    assert.equal(install(fx, []).status, 0);
    assert.equal(install(fx, []).status, 0, 'a second install, so a <dest>.previous exists too');
    mkdirSync(join(dest, 'reports'), { mode: 0o755 });
    chmodSync(join(dest, 'reports'), 0o755);
    put(dest, 'reports/shared.json', 'the operator copy\n');
    put(dest, 'reports/only-mine.json', 'carried\n');
    put(fx.src, 'reports/shared.json', 'the copy the new source ships\n');
    chmodSync(join(fx.src, 'reports'), 0o755);
    const was = { dest: snapshot(dest), prev: snapshot(`${dest}.previous`), launcher: readFileSync(join(fx.prefix, 'bin', 'commitwork'), 'utf8') };
    for (const shell of shells()) {
      const r = install(fx, [], { shell });
      assert.equal(r.status, 21, `${shell}: ${r.out}`);
      assert.match(r.out, /reports\/shared\.json: the new tree ships a file there/);
      assert.match(r.out, /Nothing was changed/);
      assert.deepEqual({ dest: snapshot(dest), prev: snapshot(`${dest}.previous`), launcher: readFileSync(join(fx.prefix, 'bin', 'commitwork'), 'utf8') }, was, `${shell}: neither direction was overwritten`);
      assert.equal(runs(fx).stdout.trim(), 'stub commitwork ["doctor"]', 'the old install still runs');
      assert.deepEqual(leftovers(fx), []);
    }
    rmSync(join(fx.src, 'reports'), { recursive: true });
    const ok = install(fx, []);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(readFileSync(join(dest, 'reports/shared.json'), 'utf8'), 'the operator copy\n');
    assert.equal(readFileSync(join(dest, 'reports/only-mine.json'), 'utf8'), 'carried\n');
  } finally { fx.cleanup(); }
});

// An install from before .commitwork-files existed: the list is deleted to make one.
test('an install with no file list carries the known operator paths, and refuses anything else it cannot place', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    const preFix = () => rmSync(join(dest, '.commitwork-files'));
    assert.equal(install(fx, []).status, 0);
    preFix();
    const planted = { 'monitor/private/projects.json': '{"projects":[]}\n', 'reports/r.json': '1\n', '.claude/settings.json': '{}\n', 'evaluations/e.md': 'e\n' };
    for (const [rel, body] of Object.entries(planted)) put(dest, rel, body);
    const r = install(fx, []);
    assert.equal(r.status, 0, r.out);
    for (const [rel, body] of Object.entries(planted)) assert.equal(readFileSync(join(dest, rel), 'utf8'), body, `${rel} carried`);
    assert.match(r.out, /carried 4 operator path\(s\)/);

    preFix();
    put(dest, 'notes/mine.txt', 'unknown to the installer\n');
    const was = { dest: snapshot(dest), prev: snapshot(`${dest}.previous`) };
    const refused = install(fx, []);
    assert.equal(refused.status, 21, refused.out);
    assert.match(refused.out, /installed before \.commitwork-files existed/);
    assert.match(refused.out, /\n.*  notes\n/, 'the unknown path is named');
    assert.match(refused.out, /--keep-previous-only/);
    assert.deepEqual({ dest: snapshot(dest), prev: snapshot(`${dest}.previous`) }, was);

    const kept = install(fx, ['--keep-previous-only']);
    assert.equal(kept.status, 0, kept.out);
    assert.deepEqual(snapshot(`${dest}.previous`), was.dest, '--keep-previous-only leaves the old tree untouched');
    assert.equal(existsSync(join(dest, 'notes')), false, 'and carries nothing');
    assert.equal(existsSync(join(dest, 'monitor', 'private')), false);
    assert.match(kept.out, /nothing was carried from it/);

    // That .previous is now the only copy of the operator data: no upgrade may replace it.
    const held = { dest: snapshot(dest), prev: snapshot(`${dest}.previous`) };
    for (const args of [[], ['--keep-previous-only']]) {
      const again = install(fx, args);
      assert.equal(again.status, 21, again.out);
      assert.match(again.out, /nothing was carried out of it/);
      assert.deepEqual({ dest: snapshot(dest), prev: snapshot(`${dest}.previous`) }, held);
    }
    rmSync(`${dest}.previous`, { recursive: true });
    assert.equal(install(fx, []).status, 0, 'once the operator has moved it, upgrades resume');
  } finally { fx.cleanup(); }
});

test('a <dest>.previous this installer did not write is never replaced', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    put(`${dest}.previous`, 'mine.txt', 'not the installer\'s\n');
    const fresh = install(fx, []);
    assert.equal(fresh.status, 0, `a first install does not touch it: ${fresh.out}`);
    const was = snapshot(dest);
    const r = install(fx, []);
    assert.equal(r.status, 21, r.out);
    assert.match(r.out, /commitwork\.previous exists and was not written by this installer/);
    assert.equal(readFileSync(join(`${dest}.previous`, 'mine.txt'), 'utf8'), 'not the installer\'s\n');
    assert.deepEqual(snapshot(dest), was);
    assert.equal(install(fx, ['--from', join(`${dest}.previous`)]).status, 21, 'a source inside <dest>.previous is refused');
  } finally { fx.cleanup(); }
});

// Each rename can fail. A shim `mv` ahead of the real one fails the first call whose destination
// matches FAKE_MV_FAIL, so every step is exercised for real rather than through a hook in the script.
function failingMv(fx) {
  const real = spawnSync('sh', ['-c', 'command -v mv'], { encoding: 'utf8' }).stdout.trim();
  const bin = join(fx.dir, 'shim');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'mv'), `#!/bin/sh
for last in "$@"; do :; done
if [ ! -e "$FAKE_MV_ONCE" ]; then
  case $last in $FAKE_MV_FAIL) : > "$FAKE_MV_ONCE"; echo "mv: injected failure moving to $last" >&2; exit 1 ;; esac
fi
exec '${real}' "$@"
`, { mode: 0o755 });
  return (pattern) => ({ PATH: `${bin}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH}`, FAKE_MV_FAIL: pattern, FAKE_MV_ONCE: join(fx.dir, `once-${Math.random().toString(16).slice(2)}`) });
}

test('a failure at any step leaves the old tree in place and usable at <dest>, never half-moved', { skip }, () => {
  const fx = fixture();
  try {
    const dest = join(fx.prefix, 'lib', 'commitwork');
    const launcher = join(fx.prefix, 'bin', 'commitwork');
    assert.equal(install(fx, []).status, 0);
    assert.equal(install(fx, []).status, 0);
    put(dest, 'monitor/private/projects.json', '{"projects":[]}\n', 0o600);
    put(fx.src, 'bin/commitwork.mjs', "console.log('stub commitwork v2 ' + JSON.stringify(process.argv.slice(2)));\n");
    const state = () => ({ dest: snapshot(dest), prev: snapshot(`${dest}.previous`), launcher: readFileSync(launcher, 'utf8'), bin: readdirSync(join(fx.prefix, 'bin')) });
    const was = state();
    const fault = failingMv(fx);
    const steps = [['*/discard', 'moving the old <dest>.previous aside'], [`${dest}.previous`, 'moving <dest> to <dest>.previous'],
      [dest, 'moving the new tree into <dest>'], [launcher, 'writing the launcher, after the tree moved']];
    for (const shell of shells()) {
      for (const [pattern, what] of steps) {
        const r = install(fx, [], { shell, env: fault(pattern) });
        assert.equal(r.status, 21, `${shell}, ${what}: ${r.out}`);
        assert.match(r.out, /injected failure/, `${shell}, ${what}: the fault fired`);
        assert.deepEqual(state(), was, `${shell}, ${what}: everything is as it was`);
        assert.equal(runs(fx).stdout.trim(), 'stub commitwork ["doctor"]', `${shell}, ${what}: the old tree still runs`);
        assert.deepEqual(leftovers(fx), [], `${shell}, ${what}: nothing staged is left behind`);
      }
    }
    if (process.getuid && process.getuid() !== 0) {
      // A copy that fails for real, with no shim: an unreadable operator file.
      put(dest, 'reports/locked.json', 'x', 0o000);
      const r = install(fx, []);
      assert.equal(r.status, 21, r.out);
      assert.match(r.out, /could not be carried across/);
      assert.equal(mode(join(dest, 'reports/locked.json')), '0');
      assert.deepEqual(snapshot(`${dest}.previous`), was.prev);
      assert.deepEqual(leftovers(fx), []);
      rmSync(join(dest, 'reports'), { recursive: true, force: true });
    }
    const ok = install(fx, []);
    assert.equal(ok.status, 0, ok.out);
    assert.equal(runs(fx).stdout.trim(), 'stub commitwork v2 ["doctor"]');
    assert.equal(readFileSync(join(dest, 'monitor/private/projects.json'), 'utf8'), '{"projects":[]}\n');
  } finally { fx.cleanup(); }
});

test('shellcheck reads install.sh as POSIX sh and finds nothing', { skip: skip || (!has('shellcheck') && 'shellcheck is not on PATH') }, () => {
  const r = spawnSync('shellcheck', ['-s', 'sh', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
