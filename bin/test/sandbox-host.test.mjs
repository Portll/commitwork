// The host posture: hostSandboxArgv is pure, so the argv and the seatbelt profile are asserted as
// text for every egress class on both platforms. The live section then runs sandbox-exec for real
// and asserts the effects the text promises, each paired with a control that must come out the
// other way; it skips loudly where the tool is absent, because a not-run confinement check is not
// a pass.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn as spawnAsync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  hostSandboxArgv, probeHostSandbox, resetHostSandboxProbe, preflightHostSandbox, expandSandboxPath, symlinkReads,
  EGRESS, EGRESS_CLASSES, POSTURES, DECLARABLE_CREDENTIALS, xcodeBundleContents, targetLoopbackPorts,
} from '../lib/sandbox.mjs';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { containerLaneIsolation, ISOLATION } from '../lib/isolation.mjs';

const base = (over = {}) => ({
  cmd: 'echo hi', egress: 'none', repoPath: '/work/repo', reportDir: '/tmp/reports/r1', platform: 'darwin',
  cwRoot: '/opt/commitwork', nodePrefix: '/opt/homebrew/Cellar/node/26.7.0', tmpDir: '/var/folders/x/T',
  home: '/Users/op', developerDir: '/Applications/Xcode.app/Contents/Developer', ...over,
});

describe('the egress vocabulary', () => {
  test('is closed and frozen, and every class explains what it reaches', () => {
    assert.deepEqual([...EGRESS_CLASSES], ['none', 'registry', 'verifiers', 'github', 'target']);
    assert.ok(Object.isFrozen(EGRESS) && Object.isFrozen(EGRESS_CLASSES));
    for (const k of EGRESS_CLASSES) assert.ok(EGRESS[k].length > 10, k);
  });
  test('an undeclared or unknown class is refused, never defaulted', () => {
    assert.throws(() => hostSandboxArgv(base({ egress: undefined })), /not one of none\|registry\|verifiers\|github\|target/);
    assert.throws(() => hostSandboxArgv(base({ egress: 'internet' })), /guessed one/);
  });
});

describe('macOS profile text', () => {
  test('none denies the network and reports full; every other class allows it and reports fs-only', () => {
    for (const egress of EGRESS_CLASSES) {
      const r = hostSandboxArgv(base({ egress }));
      assert.equal(r.argv[0], 'sandbox-exec');
      assert.equal(r.argv[1], '-p');
      assert.deepEqual(r.argv.slice(3), ['/bin/sh', '-c', 'echo hi']);
      assert.deepEqual(r.prefix, r.argv.slice(0, 3));
      assert.equal(r.profile, r.argv[2]);
      if (egress === 'none') {
        assert.equal(r.isolation, 'full');
        assert.match(r.profile, /\(deny network\*\)/);
        assert.doesNotMatch(r.profile, /\(allow network\*\)/);
      } else {
        assert.equal(r.isolation, 'fs-only');
        assert.match(r.profile, /\(allow network\*\)/);
        assert.doesNotMatch(r.profile, /\(deny network\*\)/);
      }
      assert.ok(ISOLATION.includes(r.isolation));
    }
  });

  // fact: an open class allows the internet and denies every local peer after it / review 2026-10-07 D1 (expiry: never, prev: broken)
  test('every open class denies loopback (ip4 localhost, all ip6) and unix sockets after the allow, keeping only mDNSResponder', () => {
    const DENY = '(deny network-outbound (remote ip4 "localhost:*") (remote ip6 "*:*") (remote unix-socket))';
    const MDNS = '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))';
    for (const egress of EGRESS_CLASSES) {
      const lines = hostSandboxArgv(base({ egress })).profile.split('\n');
      if (egress === 'none') { assert.ok(!lines.includes(DENY)); continue; }
      const allow = lines.indexOf('(allow network*)');
      assert.ok(allow >= 0 && lines.indexOf(DENY) > allow, `${egress}: the deny must follow the allow, or seatbelt's last match lets loopback through`);
      assert.ok(lines.indexOf(MDNS) > lines.indexOf(DENY), `${egress}: name resolution is a unix socket and must be re-allowed after the deny`);
      assert.ok(!lines.some((l) => /localhost:\d/.test(l)), `${egress}: no loopback port without a declared target`);
    }
  });

  test('a target lane gets exactly its target URLs\' loopback ports, and any other class refuses one', () => {
    const lines = hostSandboxArgv(base({ egress: 'target', loopbackPorts: [8080, 8443, 8080] })).profile.split('\n');
    assert.deepEqual(lines.filter((l) => /localhost:\d/.test(l)), [
      '(allow network-outbound (remote ip4 "localhost:8080") (remote ip6 "localhost:8080"))',
      '(allow network-outbound (remote ip4 "localhost:8443") (remote ip6 "localhost:8443"))',
    ]);
    assert.throws(() => hostSandboxArgv(base({ egress: 'registry', loopbackPorts: [7980] })), /target class only/);
    assert.throws(() => hostSandboxArgv(base({ egress: 'target', loopbackPorts: [0] })), /ports 1-65535/);
    assert.throws(() => hostSandboxArgv(base({ egress: 'target', loopbackPorts: ['8080'] })), /ports 1-65535/);
    assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'http://localhost:8080/x', CW_TLS_URL: 'https://127.0.0.1', CW_OPENAPI: '/repo/openapi.yaml' }), [443, 8080]);
    assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'http://[::1]:9000', CW_OPENAPI: 'http://0.0.0.0:9001/spec' }), [9000, 9001]);
    assert.deepEqual(targetLoopbackPorts({ CW_TARGET_URL: 'https://api.example.com:8443' }), [], 'a remote target needs no loopback exception');
    assert.deepEqual(targetLoopbackPorts({}), []);
  });

  test('deny default, the fixed read set, and writes confined to the report dir and TMPDIR', () => {
    const { profile } = hostSandboxArgv(base());
    const lines = profile.split('\n');
    assert.equal(lines[0], '(version 1)');
    assert.equal(lines[1], '(deny default)');
    const reads = lines.filter((l) => l.startsWith('(allow file-read* ')).join(' ');
    for (const p of ['/usr', '/bin', '/opt/homebrew', '/private/tmp', '/work/repo', '/opt/commitwork', '/opt/homebrew/Cellar/node/26.7.0', '/Applications/Xcode.app/Contents', '/Users/op/.config/git']) {
      assert.ok(reads.includes(`(subpath "${p}")`), `read ${p}`);
    }
    assert.ok(reads.includes('(literal "/Users/op/.gitconfig")'));
    const writes = lines.find((l) => l.startsWith('(allow file-write* '));
    assert.equal(writes, '(allow file-write* (subpath "/tmp/reports/r1") (subpath "/private/tmp/reports/r1") (subpath "/var/folders/x/T") (subpath "/private/var/folders/x/T") (subpath "/tmp") (subpath "/private/tmp") (literal "/dev/null"))');
    assert.doesNotMatch(profile, /\(allow file-write\* \(subpath "\/work\/repo"\)/, 'the scanned tree is never writable');
    assert.ok(lines.includes('(allow ipc-posix-sem*)') && lines.includes('(allow ipc-sysv-sem)'), 'CodeQL: python SemLock needs posix sem, the C++ extractor semget');
    const anc = lines.filter((l) => l.startsWith('(allow file-read* (literal "/Applications")'));
    assert.equal(anc.length, 1, 'one ancestor line, sorted, so realpath can walk every component');
    for (const p of ['/opt', '/work', '/private', '/private/var', '/Users', '/Users/op', '/Applications/Xcode.app']) assert.ok(anc[0].includes(`(literal "${p}")`), p);
    assert.ok(!anc[0].includes('(subpath "/opt")'), 'ancestors are literals, never subpaths');
  });

  test('an Xcode developer dir widens to its bundle Contents, and a Command Line Tools dir stays as it is', () => {
    assert.equal(xcodeBundleContents('/Applications/Xcode-26.6.0.app/Contents/Developer'), '/Applications/Xcode-26.6.0.app/Contents');
    assert.equal(xcodeBundleContents('/Library/Developer/CommandLineTools'), '/Library/Developer/CommandLineTools');
    const { profile } = hostSandboxArgv(base());
    assert.ok(profile.includes('(subpath "/Applications/Xcode.app/Contents")'), 'SharedFrameworks sits beside Developer');
  });

  test('the resolver config is readable exactly where the network is allowed', () => {
    for (const egress of EGRESS_CLASSES) {
      const { profile } = hostSandboxArgv(base({ egress }));
      const line = '(allow file-read* (literal "/private/var/run/resolv.conf"))';
      if (egress === 'none') assert.ok(!profile.includes('resolv.conf'), 'a lane with no network has no resolver to configure');
      else assert.ok(profile.split('\n').includes(line), egress);
    }
  });

  test('/private/tmp is writable and both semaphore families are allowed in every class', () => {
    for (const egress of EGRESS_CLASSES) {
      const { profile } = hostSandboxArgv(base({ egress, reportDir: '/srv/reports', tmpDir: '/var/folders/x/T' }));
      assert.match(profile, /\(allow file-write\* [^\n]*\(subpath "\/private\/tmp"\)/, egress);
      assert.match(profile, /\(allow ipc-posix-sem\*\)\n\(allow ipc-sysv-sem\)/, egress);
    }
  });

  test('credential directories are denied after every allow, so a broad extra read cannot reach them', () => {
    const { profile } = hostSandboxArgv(base({ extraReads: ['~/'] }));
    const lines = profile.split('\n');
    const denyAt = lines.findIndex((l) => l.startsWith('(deny file-read* file-write* '));
    const lastAllow = lines.map((l, i) => (l.startsWith('(allow file-') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    assert.ok(denyAt > lastAllow, 'the credential deny must follow every allow, because the last matching rule wins');
    for (const seg of ['.ssh', '.aws', '.gnupg', '.docker', '.kube', '.netrc', 'Keychains']) {
      assert.ok(lines[denyAt].includes(`/Users/op/${seg === 'Keychains' ? 'Library/Keychains' : seg}"`), seg);
    }
  });

  test('extra reads and writes expand ~/ against home and ./ against the scanned tree; a write is readable too', () => {
    const { profile } = hostSandboxArgv(base({ toolPrefixes: ['/opt/tools/go'], extraReads: ['~/.composer', '/srv/rules'], extraWrites: ['~/.semgrep', './target'] }));
    assert.match(profile, /\(allow file-read\* .*\(subpath "\/opt\/tools\/go"\).*\(subpath "\/Users\/op\/\.composer"\).*\(subpath "\/srv\/rules"\).*\(subpath "\/Users\/op\/\.semgrep"\) \(subpath "\/work\/repo\/target"\)/);
    assert.match(profile, /\(allow file-write\* .*\(subpath "\/Users\/op\/\.semgrep"\) \(subpath "\/work\/repo\/target"\)/);
    assert.equal(expandSandboxPath('~/x', { home: '/h', repoPath: '/r' }), '/h/x');
    assert.equal(expandSandboxPath('./x', { home: '/h', repoPath: '/r' }), '/r/x');
    assert.equal(expandSandboxPath('/x', { home: '/h', repoPath: '/r' }), '/x');
  });

  test('@usercache/ expands against the per-user cache dir, and a host that reports none refuses it', () => {
    assert.equal(expandSandboxPath('@usercache/clang/ModuleCache', { home: '/h', repoPath: '/r', userCacheDir: '/private/var/folders/x/C' }), '/private/var/folders/x/C/clang/ModuleCache');
    assert.throws(() => expandSandboxPath('@usercache/clang', { home: '/h', repoPath: '/r' }), /per-user cache dir/);
    const { profile } = hostSandboxArgv(base({ extraWrites: ['@usercache/clang/ModuleCache'], userCacheDir: '/private/var/folders/x/C' }));
    assert.match(profile, /\(allow file-write\* [^\n]*\(subpath "\/private\/var\/folders\/x\/C\/clang\/ModuleCache"\)/);
    assert.throws(() => hostSandboxArgv(base({ extraWrites: ['@usercache/clang/ModuleCache'] })), /per-user cache dir/);
  });

  test('a path the profile grammar cannot carry is refused rather than emitted', () => {
    assert.throws(() => hostSandboxArgv(base({ repoPath: '/work/re"po' })), /cannot carry/);
    assert.throws(() => hostSandboxArgv(base({ reportDir: 'reports' })), /absolute path/);
    assert.throws(() => hostSandboxArgv(base({ extraWrites: ['cache'] })), /write path #1/);
    assert.throws(() => hostSandboxArgv(base({ cmd: '  ' })), /command is required/);
  });

  test('is deterministic', () => {
    assert.deepEqual(hostSandboxArgv(base({ egress: 'registry' })), hostSandboxArgv(base({ egress: 'registry' })));
  });
});

describe('symlink targets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sbx-links-'));
  const repo = join(dir, 'repo'); const outside = join(dir, 'sidecar', 'evaluations'); const home = join(dir, 'home');
  mkdirSync(join(repo, 'sub', 'deep'), { recursive: true }); mkdirSync(outside, { recursive: true });
  mkdirSync(join(home, '.ssh'), { recursive: true }); mkdirSync(join(repo, 'internal'));
  symlinkSync(outside, join(repo, 'evaluations'));
  symlinkSync(join(home, '.ssh'), join(repo, 'sub', 'keys'));
  symlinkSync(join(repo, 'internal'), join(repo, 'alias'));
  symlinkSync(outside, join(repo, 'sub', 'deep', 'toodeep'));
  symlinkSync(join(repo, 'evaluations'), join(dir, 'via-extra'));

  test('a link out of the tree puts its resolved target, with ancestors, in the read set; one into the tree is nothing', () => {
    const r = symlinkReads(repo, [], { home });
    assert.deepEqual(r.reads, [realpathSync(outside)]);
    assert.deepEqual(r.refused.map((s) => s.split(':')[0]), [`${realpathSync(repo)}/sub/keys -> ${realpathSync(join(home, '.ssh'))}`]);
    assert.match(r.refused[0], /credential material \(\.ssh\)/);
    const { profile } = hostSandboxArgv(base({ repoPath: repo, extraReads: r.reads }));
    assert.ok(profile.includes(`(subpath "${realpathSync(outside)}")`));
    assert.ok(profile.includes(`(literal "${realpathSync(join(dir, 'sidecar'))}")`), 'ancestor literal');
  });

  test('a declared extra read that is itself a link is resolved; a real credential dir declared is not a link and is left to the deny rule', () => {
    assert.deepEqual(symlinkReads(repo, [join(dir, 'via-extra')], { home }).reads, [realpathSync(outside)]);
    assert.equal(symlinkReads(repo, ['~/.ssh'], { home }).refused.length, 1, 'the tree\'s own refusal, and nothing for a declared real directory');
  });

  test('a link whose target holds or lies inside a credential store is refused: the home directory, ~/.config, a declarable store', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-sbx-homelinks-'));
    const h = join(d, 'home'); const r = join(d, 'repo');
    mkdirSync(join(h, '.config', 'gh'), { recursive: true }); mkdirSync(join(h, 'sidecar')); mkdirSync(r);
    symlinkSync(h, join(r, 'home')); symlinkSync(join(h, '.config'), join(r, 'cfg'));
    symlinkSync(join(h, '.config', 'gh'), join(r, 'gh')); symlinkSync(join(h, 'sidecar'), join(r, 'ok'));
    const out = symlinkReads(r, [], { home: h });
    assert.deepEqual(out.reads, [realpathSync(join(h, 'sidecar'))], 'a sibling of the stores is still followed');
    assert.equal(out.refused.length, 3, out.refused.join('\n'));
    for (const s of out.refused) assert.match(s, /overlaps the credential store /);
    rmSync(d, { recursive: true, force: true });
  });

  test('cleanup', () => { rmSync(dir, { recursive: true, force: true }); assert.ok(!existsSync(dir)); });
});

// A home with nothing in it, so the Linux argv never depends on the box the test runs on.
const fakeFs = (present = {}, links = {}) => {
  const look = (p) => {
    if (present[p] instanceof Error) throw present[p];
    if (!(p in present)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return p;
  };
  return {
    realpathSync: (p) => look(links[p] ?? p),
    statSync: (p) => ({ isDirectory: () => present[look(p)] === 'dir' }),
  };
};
const NOFS = fakeFs();

describe('Linux argv', () => {
  test('ro root, tmpfs before the report bind, net unshared only for none', () => {
    const none = hostSandboxArgv(base({ platform: 'linux', reportDir: '/tmp/reports/r1', tmpDir: '/tmp', fs: NOFS }));
    assert.deepEqual(none.argv, ['bwrap', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--bind', '/tmp/reports/r1', '/tmp/reports/r1', '--unshare-net', '--die-with-parent', '--', 'sh', '-c', 'echo hi']);
    assert.equal(none.isolation, 'full');
    assert.equal(none.profile, null);
    const reg = hostSandboxArgv(base({ platform: 'linux', egress: 'registry', reportDir: '/srv/reports', tmpDir: '/var/tmp', extraWrites: ['~/.cache/trivy'], fs: NOFS }));
    assert.deepEqual(reg.argv, ['/opt/homebrew/Cellar/node/26.7.0/bin/node', '/opt/commitwork/bin/lib/sandbox-net.mjs', '--',
      'bwrap', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--bind', '/srv/reports', '/srv/reports', '--bind', '/var/tmp', '/var/tmp', '--bind-try', '/Users/op/.cache/trivy', '/Users/op/.cache/trivy',
      '--unshare-net', '--info-fd', '3', '--block-fd', '4', '--die-with-parent', '--', 'sh', '-c', 'echo hi']);
    assert.deepEqual(reg.prefix, reg.argv.slice(0, -3));
    assert.equal(reg.isolation, 'fs-only');
  });

  // fact: every open class runs in its own network namespace through sandbox-net.mjs / review 2026-10-07 D1: in the host namespace a lane reached loopback, abstract sockets and the host's own addresses (expiry: never, prev: broken)
  test('every open class unshares the network behind the pasta helper; none unshares it with no helper', () => {
    for (const egress of EGRESS_CLASSES) {
      const { argv, prefix } = hostSandboxArgv(base({ platform: 'linux', egress, reportDir: '/tmp/reports/r1', tmpDir: '/tmp', fs: NOFS }));
      assert.equal(argv.filter((a) => a === '--unshare-net').length, 1, egress);
      if (egress === 'none') { assert.equal(argv[0], 'bwrap'); assert.ok(!argv.includes('--block-fd')); continue; }
      assert.deepEqual(prefix.slice(0, 3), ['/opt/homebrew/Cellar/node/26.7.0/bin/node', '/opt/commitwork/bin/lib/sandbox-net.mjs', '--'], egress);
      const bw = prefix.slice(3);
      assert.equal(bw[0], 'bwrap');
      assert.deepEqual(bw.slice(-7), ['--unshare-net', '--info-fd', '3', '--block-fd', '4', '--die-with-parent', '--'], `${egress}: the command must be held until the namespace has its network`);
    }
  });

  test('a target lane hands the helper exactly its loopback ports, and no other class can', () => {
    const t = hostSandboxArgv(base({ platform: 'linux', egress: 'target', loopbackPorts: [8443, 8080, 8080], reportDir: '/tmp/r', tmpDir: '/tmp', fs: NOFS }));
    assert.deepEqual(t.prefix.slice(1, 5), ['/opt/commitwork/bin/lib/sandbox-net.mjs', '--loopback', '8080,8443', '--']);
    const plain = hostSandboxArgv(base({ platform: 'linux', egress: 'target', reportDir: '/tmp/r', tmpDir: '/tmp', fs: NOFS }));
    assert.ok(!plain.prefix.includes('--loopback'), 'a remote target forwards no loopback port');
    assert.throws(() => hostSandboxArgv(base({ platform: 'linux', egress: 'registry', loopbackPorts: [7980], fs: NOFS })), /target class only/);
  });

  // fact: /run is a tmpfs in every class, before every bind / under HEAD's argv a lane with egress none connected to a unix socket in /run, measured 2026-10-07 (expiry: never, prev: broken)
  test('/run (and /var/run where it is not a link to it) is a tmpfs before the binds; the resolver config is replaced only where the network is open', () => {
    const fs = fakeFs({ '/run': 'dir', '/run/systemd/resolve/stub-resolv.conf': 'file' }, { '/var/run': '/run', '/etc/resolv.conf': '/run/systemd/resolve/stub-resolv.conf' });
    for (const egress of EGRESS_CLASSES) {
      const { argv } = hostSandboxArgv(base({ platform: 'linux', egress, reportDir: '/run/user/1000/r', tmpDir: '/tmp', fs }));
      const bw = argv.slice(argv.indexOf('bwrap'));
      assert.deepEqual(bw.slice(0, 9), ['bwrap', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--tmpfs', '/run', '--bind'], egress);
      assert.equal(bw.filter((a) => a === '--tmpfs').length, 2, `${egress}: /var/run resolves to /run and is masked once`);
      const data = bw.indexOf('--ro-bind-data');
      if (egress === 'none') { assert.equal(data, -1, 'a lane with no network has no resolver to configure'); continue; }
      assert.deepEqual(bw.slice(data, data + 3), ['--ro-bind-data', '5', '/run/systemd/resolve/stub-resolv.conf'], `${egress}: written at the link's target`);
      assert.ok(data > bw.lastIndexOf('--bind') && data < bw.indexOf('--unshare-net'));
    }
    const real = fakeFs({ '/run': 'dir', '/var/run': 'dir', '/etc/resolv.conf': 'file' });
    const r = hostSandboxArgv(base({ platform: 'linux', egress: 'github', reportDir: '/tmp/r', tmpDir: '/tmp', fs: real })).argv;
    assert.deepEqual(r.slice(r.indexOf('bwrap') + 6, r.indexOf('bwrap') + 10), ['--tmpfs', '/run', '--tmpfs', '/var/run']);
    assert.ok(r.includes('/etc/resolv.conf'));
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    assert.throws(() => hostSandboxArgv(base({ platform: 'linux', fs: fakeFs({ '/run': eacces }) })), /cannot tell whether \/run exists \(EACCES\)/);
    assert.throws(() => hostSandboxArgv(base({ platform: 'linux', egress: 'registry', fs: fakeFs({ '/etc/resolv.conf': eacces }) })), /cannot resolve \/etc\/resolv\.conf/);
  });
  test('an unknown platform throws', () => {
    assert.throws(() => hostSandboxArgv(base({ platform: 'win32' })), /no host sandbox for platform "win32"/);
  });
});

// The macOS profile text is the witness here: the denied set is parsed out of it rather than taken
// from the list the Linux branch uses, so a path added to one platform and not the other fails.
describe('Linux denies what macOS denies', () => {
  const H = '/home/op';
  const FILES = new Set(['.netrc', '.git-credentials', '.npmrc', '.pypirc', '.cargo/credentials', '.cargo/credentials.toml']);
  const spec = (over = {}) => base({ home: H, reportDir: '/tmp/reports/r1', tmpDir: '/tmp', ...over });
  const darwinDenied = (profile) => {
    const line = profile.split('\n').find((l) => l.startsWith('(deny file-read* file-write* '));
    return [...new Set([...line.matchAll(/\(subpath "([^"]+)"\)/g)].map((m) => m[1]))];
  };
  const within = (p, root) => p === root || p.startsWith(`${root}/`);
  // Readable on macOS: under an allowed subpath or a literal beside one, and under no denied subpath.
  // The ancestors line (literals only) is left out: it opens a directory entry, never its contents.
  const darwinReadable = (profile, p) => {
    const allows = profile.split('\n').filter((l) => l.startsWith('(allow file-read* ') && l.includes('(subpath '));
    const subs = allows.flatMap((l) => [...l.matchAll(/\(subpath "([^"]+)"\)/g)].map((m) => m[1]));
    const lits = allows.flatMap((l) => [...l.matchAll(/\(literal "([^"]+)"\)/g)].map((m) => m[1]));
    return (subs.some((s) => within(p, s)) || lits.includes(p)) && !darwinDenied(profile).some((d) => within(p, d));
  };
  const everyStore = () => {
    const denied = darwinDenied(hostSandboxArgv(spec()).profile);
    const all = [...denied, ...DECLARABLE_CREDENTIALS.map((s) => `${H}/${s}`)];
    const rel = (p) => (p.startsWith(`${H}/`) ? p.slice(H.length + 1) : p);
    return { denied, present: Object.fromEntries(all.map((p) => [p, FILES.has(rel(p)) ? 'file' : 'dir'])) };
  };
  const maskOf = (argv, p) => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--tmpfs' && argv[i + 1] === p) return { kind: 'dir', at: i };
      if (argv[i] === '--ro-bind' && argv[i + 1] === '/dev/null' && argv[i + 2] === p) return { kind: 'file', at: i };
    }
    return null;
  };

  test('with every store present, each path the macOS profile denies is masked by its type, whatever the lane declares', () => {
    const { denied, present } = everyStore();
    assert.equal(denied.length, 9, `the macOS deny line names ${denied.join(' ')}`);
    for (const over of [{}, { extraReads: ['~/', '~/.ssh'] }, { extraWrites: ['~'] }, { egress: 'registry' }]) {
      const { argv } = hostSandboxArgv(spec({ platform: 'linux', fs: fakeFs(present), ...over }));
      for (const p of denied) {
        const m = maskOf(argv, p);
        assert.ok(m, `${p} readable on Linux under ${JSON.stringify(over)}`);
        assert.equal(m.kind, present[p], p);
      }
    }
  });

  test('a declarable store is masked exactly where the macOS allowlist leaves it unreadable', () => {
    const { present } = everyStore();
    const cases = [
      {},
      { extraReads: ['~/.local/bin', '~/.config/gh'] }, // posture-scorecard
      { toolPrefixes: [`${H}/.cargo`] },                 // a cargo that lives in ~/.cargo
      { extraReads: ['~/'] },
      { extraWrites: ['~/.cache/trivy', '~/.npm'] },
    ];
    for (const over of cases) {
      const { profile } = hostSandboxArgv(spec(over));
      const { argv } = hostSandboxArgv(spec({ platform: 'linux', fs: fakeFs(present), ...over }));
      for (const s of DECLARABLE_CREDENTIALS) {
        const p = `${H}/${s}`;
        assert.equal(!maskOf(argv, p), darwinReadable(profile, p), `${p} under ${JSON.stringify(over)}`);
      }
    }
    const scorecard = hostSandboxArgv(spec({ platform: 'linux', fs: fakeFs(present), extraReads: ['~/.config/gh'] })).argv;
    assert.equal(maskOf(scorecard, `${H}/.config/gh`), null, 'the declared store is left readable');
    assert.ok(maskOf(scorecard, `${H}/.npmrc`) && maskOf(scorecard, `${H}/.ssh`), 'and nothing else is');
  });

  test('an absent store produces no mask, and a partial home masks only what exists', () => {
    const empty = hostSandboxArgv(spec({ platform: 'linux', fs: NOFS })).argv;
    assert.ok(!empty.includes('/dev/null') && empty.filter((a) => a === '--tmpfs').length === 1, empty.join(' '));
    const some = hostSandboxArgv(spec({ platform: 'linux', fs: fakeFs({ [`${H}/.ssh`]: 'dir', [`${H}/.netrc`]: 'file', [`${H}/.config/gh`]: 'dir' }) })).argv;
    assert.deepEqual(some.slice(9, some.indexOf('--unshare-net')), ['--tmpfs', `${H}/.ssh`, '--ro-bind', '/dev/null', `${H}/.netrc`, '--tmpfs', `${H}/.config/gh`]);
  });

  test('a symlinked store is masked at its resolved path, because bwrap refuses a symlink destination; a dangling one is skipped', () => {
    const fs = fakeFs({ '/data/kube': 'dir', '/data/netrc': 'file' }, { [`${H}/.kube`]: '/data/kube', [`${H}/.netrc`]: '/data/netrc', [`${H}/.aws`]: '/gone' });
    const { argv } = hostSandboxArgv(spec({ platform: 'linux', fs }));
    assert.deepEqual(argv.slice(9, argv.indexOf('--unshare-net')), ['--tmpfs', '/data/kube', '--ro-bind', '/dev/null', '/data/netrc']);
  });

  test('the root bind comes first and the masks follow every bind, so a declared write of ~ cannot re-expose them', () => {
    const { denied, present } = everyStore();
    const { argv } = hostSandboxArgv(spec({ platform: 'linux', tmpDir: '/var/tmp', extraWrites: ['~', '~/.cache/trivy'], fs: fakeFs(present) }));
    assert.deepEqual(argv.slice(0, 7), ['bwrap', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--bind']);
    const masks = denied.map((p) => maskOf(argv, p).at);
    const lastBind = argv.lastIndexOf('--bind-try');
    assert.deepEqual(argv.slice(lastBind, lastBind + 3), ['--bind-try', `${H}/.cache/trivy`, `${H}/.cache/trivy`]);
    assert.ok(argv.indexOf(`${H}`) < Math.min(...masks), 'the home bind precedes every mask');
    assert.ok(Math.min(...masks) > lastBind + 2, 'every mask follows the last bind');
    assert.ok(Math.max(...masks) < argv.indexOf('--unshare-net'), 'and precedes the options that end the prefix');
  });

  test('a write, report dir or TMPDIR inside a denied store is refused on both platforms', () => {
    for (const platform of ['darwin', 'linux']) {
      assert.throws(() => hostSandboxArgv(spec({ platform, fs: NOFS, extraWrites: ['~/.ssh/cache'] })), /\/home\/op\/\.ssh\/cache is inside \/home\/op\/\.ssh/);
      assert.throws(() => hostSandboxArgv(spec({ platform, fs: NOFS, reportDir: `${H}/.docker/r` })), /inside \/home\/op\/\.docker/);
      assert.throws(() => hostSandboxArgv(spec({ platform, fs: NOFS, tmpDir: `${H}/.aws` })), /inside \/home\/op\/\.aws/);
      assert.doesNotThrow(() => hostSandboxArgv(spec({ platform, fs: NOFS, extraWrites: ['~/.sshx', '~/.config/gh'] })), 'a sibling or a declarable store is not a denied one');
    }
  });

  test('a stat error other than ENOENT or ENOTDIR refuses rather than leaving the store readable', () => {
    const enotdir = Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' });
    assert.equal(maskOf(hostSandboxArgv(spec({ platform: 'linux', fs: fakeFs({ [`${H}/.config/gh`]: enotdir }) })).argv, `${H}/.config/gh`), null);
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    assert.throws(() => hostSandboxArgv(spec({ platform: 'linux', fs: fakeFs({ [`${H}/.kube`]: eacces }) })), /cannot tell whether the credential store \/home\/op\/\.kube exists \(EACCES\)/);
  });

  test('without an injected fs the real disk decides: a temp home\'s stores are masked by type, a linked one at its target', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'cw-sbx-home-')));
    mkdirSync(join(home, '.ssh')); writeFileSync(join(home, '.netrc'), 'machine x password y');
    mkdirSync(join(home, 'dotfiles-kube')); symlinkSync(join(home, 'dotfiles-kube'), join(home, '.kube'));
    const { argv } = hostSandboxArgv(base({ platform: 'linux', home, reportDir: '/tmp/reports/r1', tmpDir: '/tmp' }));
    assert.equal(maskOf(argv, join(home, '.ssh'))?.kind, 'dir');
    assert.equal(maskOf(argv, join(home, '.netrc'))?.kind, 'file');
    assert.equal(maskOf(argv, join(home, 'dotfiles-kube'))?.kind, 'dir');
    assert.equal(maskOf(argv, join(home, '.kube')), null, 'never the link itself');
    assert.equal(maskOf(argv, join(home, '.aws')), null);
    rmSync(home, { recursive: true, force: true });
  });

  test('the Linux probe is still a trivial run that names no home path', () => {
    resetHostSandboxProbe();
    const seen = [];
    probeHostSandbox({ platform: 'linux', spawn: (bin, args) => { seen.push([bin, ...args]); return { status: 0, stdout: '', stderr: '' }; } });
    assert.deepEqual(seen, [['bwrap', '--ro-bind', '/', '/', '--unshare-net', '--die-with-parent', '--', '/bin/true']]);
    resetHostSandboxProbe();
  });
});

describe('container lanes', () => {
  test('are confined by the posture their command names', () => {
    assert.deepEqual(containerLaneIsolation({ local: ['x=$(node bin/sandbox.mjs --posture lookup --name n); docker run $x img'] }),
      { isolation: 'fs-only', isolationReason: 'container lane: confined by posture lookup; host wrapper not applied' });
    assert.equal(containerLaneIsolation({ local: ['node bin/sandbox.mjs --posture analyse'] }).isolation, 'full');
    assert.equal(containerLaneIsolation({ local: ['node bin/sandbox.mjs --posture analyse', 'node bin/sandbox.mjs --posture fetch'] }).isolation, 'fs-only');
    assert.equal(containerLaneIsolation({ local: ['node bin/sandbox.mjs --posture nosuch'] }).isolation, 'fs-only');
    assert.equal(containerLaneIsolation({ local: ['bash bin/depscan-scan.sh'] }).isolationReason, 'container lane: confined by the posture its script selects; host wrapper not applied');
    assert.equal(POSTURES.analyse.network, 'none');
  });
});

describe('the probe and the preflight', () => {
  test('probe runs the tool once per process and memoises; reset forgets', () => {
    resetHostSandboxProbe();
    const calls = [];
    const spawn = (bin, args) => { calls.push(bin); return bin === 'xcode-select' ? { status: 0, stdout: '/Dev\n', stderr: '' } : { status: 0, stdout: '', stderr: '' }; };
    const a = probeHostSandbox({ platform: 'darwin', spawn });
    const b = probeHostSandbox({ platform: 'darwin', spawn });
    assert.equal(a, b);
    assert.deepEqual(calls, ['sandbox-exec', 'xcode-select']);
    assert.deepEqual(a, { available: true, why: 'sandbox-exec ran a trivial command', tool: 'sandbox-exec', developerDir: '/Dev', platform: 'darwin' });
    resetHostSandboxProbe();
    const missing = probeHostSandbox({ platform: 'linux', spawn: () => ({ error: { code: 'ENOENT' }, status: null }) });
    assert.deepEqual(missing, { available: false, why: 'bwrap: ENOENT', tool: 'bwrap', developerDir: null, platform: 'linux' });
    resetHostSandboxProbe();
    assert.equal(probeHostSandbox({ platform: 'win32', spawn }).available, false);
    resetHostSandboxProbe();
  });
  test('preflight reports a wrapper that exits before the command, with its first stderr line', () => {
    const wrap = hostSandboxArgv(base());
    const seen = [];
    const spawn = (bin, args) => { seen.push([bin, ...args]); return { status: 65, stdout: '', stderr: 'sandbox-exec: syntax error\nmore' }; };
    assert.deepEqual(preflightHostSandbox(wrap, { spawn }), { ok: false, why: 'sandbox-exec exited 65 before running the command: sandbox-exec: syntax error' });
    assert.deepEqual(seen[0], ['sandbox-exec', '-p', wrap.profile, '/bin/sh', '-c', 'exit 0']);
    assert.deepEqual(preflightHostSandbox(wrap, { spawn: () => ({ status: 0 }) }), { ok: true, why: null });
  });
});

// ── live: does the profile DO what its text says ─────────────────────────────────────────────
const live = process.platform === 'darwin' && spawnSync('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'], { stdio: 'ignore', timeout: 20_000 }).status === 0;
const skip = live ? false : 'sandbox-exec unavailable on this host — confinement NOT verified here';

describe('host confinement, measured', { skip }, () => {
  // fact: the fixture lives under the home directory, not TMPDIR / TMPDIR is readable and writable by design, so a control placed there passes for the wrong reason (expiry: never, prev: wrong)
  const dir = mkdtempSync(join(homedir(), '.cw-sbx-'));
  const repo = join(dir, 'repo'); const report = join(dir, 'report'); const outside = join(dir, 'outside');
  mkdirSync(repo); mkdirSync(report); mkdirSync(outside);
  writeFileSync(join(repo, 'a.txt'), 'A');
  writeFileSync(join(outside, 'secret.txt'), 'S');
  const dev = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' });
  const spec = (over = {}) => ({
    egress: 'none', repoPath: repo, reportDir: report, platform: 'darwin', cwRoot: process.cwd(),
    nodePrefix: join(process.execPath, '..', '..'), tmpDir: tmpdir(), home: homedir(),
    developerDir: dev.status === 0 ? dev.stdout.trim() : null, ...over,
  });
  const run = (cmd, over) => {
    const { argv } = hostSandboxArgv({ ...spec(over), cmd });
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 60_000, cwd: repo });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
  };

  // ── IS `outside` ACTUALLY OUTSIDE? A PRECONDITION, NOT AN ASSERTION ───────────────────────────
  // The controls below sit under homedir() on the stated fact at the top of this block: TMPDIR is
  // readable and writable by design, so a control placed there passes for the wrong reason. That
  // fact has an unstated premise — that HOME is not itself in an allowed root. A harness that runs
  // the suite with `HOME=mkdtemp(os.tmpdir())`, which is what a clean-export public-test run does,
  // breaks it: every control lands where the profile permits it, nothing refuses, and the two tests
  // below fail about the PROFILE for a reason that belongs to the harness. Measured 2026-10-04 on a
  // sidecar-less export of HEAD with HOME under an allowed root: 2 failures here and 3 in
  // bin/test/lane-sandbox-paths.test.mjs, all of them this, and all 5 passing with the real HOME.
  //
  // Probed rather than inferred from the path, because the allowed set is the profile's to state and
  // not a prefix this test can predict — /tmp is allowed without being os.tmpdir().
  const unconfinedHome = (() => {
    const p = join(outside, 'confinement-probe');
    const r = run(`echo x > "${p}"`);
    const landed = existsSync(p);
    if (landed) rmSync(p, { force: true });
    if (r.status !== 0 && !landed) return null; // the control refuses: the premise holds
    return 'SKIPPED (not a silent pass): the control write outside the report dir was NOT refused, so '
      + `HOME (${homedir()}) resolves inside a root this profile allows and no control placed under it can `
      + 'fail. Confinement is UNMEASURED here, not confirmed and not broken. Remedy: run this suite with '
      + 'HOME outside TMPDIR and /tmp.';
  })();

  test('reads the tree, writes the report dir, and the control write outside is refused', (t) => {
    if (unconfinedHome) { t.skip(unconfinedHome); return; }
    assert.equal(run(`cat a.txt > "${report}/copy" && cat "${report}/copy"`).out, 'A');
    const r = run(`echo x > "${outside}/leak"`);
    assert.notEqual(r.status, 0);
    assert.ok(!existsSync(join(outside, 'leak')), 'a write outside the report dir landed');
  });

  test('a read outside the fixed set is refused, and declaring it as an extra read is what allows it', (t) => {
    if (unconfinedHome) { t.skip(unconfinedHome); return; }
    assert.notEqual(run(`cat "${outside}/secret.txt"`).status, 0);
    assert.equal(run(`cat "${outside}/secret.txt"`, { extraReads: [outside] }).out, 'S');
  });

  test('network is denied under none and reachable under registry (the control)', () => {
    const probe = `node -e "fetch('https://example.com',{signal:AbortSignal.timeout(8000)}).then(r=>console.log('NET',r.status)).catch(e=>console.log('DENIED',(e.cause&&e.cause.code)||e.name))"`;
    assert.match(run(probe).out, /^DENIED/);
    const open = run(probe, { egress: 'registry' }).out;
    assert.ok(/^NET \d+/.test(open) || /DENIED (ENOTFOUND|EAI_AGAIN|TimeoutError)/.test(open), `offline host is not a sandbox failure: ${open}`);
  });

  // fact: the read is asserted through /etc/resolv.conf, the path tools open / the link resolves outside /private/etc, so a profile that allowed only the link's own directory passed text checks while Ruby's Resolv died at load (expiry: never, prev: broken)
  test('a networked lane reads /etc/resolv.conf, and a lane with no network cannot (the control)', { skip: existsSync('/etc/resolv.conf') ? false : 'this host has no /etc/resolv.conf' }, () => {
    const r = run('head -c 1 /etc/resolv.conf >/dev/null && echo READ', { egress: 'registry' });
    assert.equal(r.out, 'READ', r.out);
    assert.notEqual(run('head -c 1 /etc/resolv.conf >/dev/null && echo READ').out, 'READ', 'egress none read the resolver config');
  });

  // fact: xcodebuild is what the cc and xcrun shims run, and it loads Contents/SharedFrameworks / cargo's link step and CodeQL's tracer both reached it through cc, so a profile that allowed only Developer failed them while xcrun --find still worked (expiry: never, prev: broken)
  const xcode = dev.status === 0 && /\.app\/Contents\/Developer$/.test(dev.stdout.trim());
  test('xcodebuild runs under the profile, and allowing only the Developer dir fails it (the control)', { skip: xcode ? false : 'no Xcode.app selected on this host' }, () => {
    const cmd = 'xcodebuild -version >/dev/null 2>&1 && echo OK || echo FAIL';
    assert.equal(run(cmd).out, 'OK');
    assert.match(run(cmd, { developerDir: null, extraReads: [dev.stdout.trim()] }).out, /^FAIL/, 'Developer alone was enough, so the widening is not what made xcodebuild run');
  });

  // fact: measured against our own listeners on ephemeral ports and our own socket, never the live :7980/:7878 or /tmp/cc-socks / review 2026-10-07 D1 (expiry: never, prev: broken)
  test('an open lane cannot connect to a loopback listener or a unix socket; the unsandboxed control and the declared target port can', async () => {
    const listen = (opts) => new Promise((r) => { const s = net.createServer((c) => c.end()); s.listen(opts, () => r(s)); });
    const v4 = await listen({ host: '127.0.0.1', port: 0 });
    const v6 = await listen({ host: '::1', port: 0 }).catch(() => null);
    const wild = await listen({ port: 0 });
    const sock = join(report, 'peer.sock');
    const unix = await listen({ path: sock });
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    const targets = {
      v4: { host: '127.0.0.1', port: v4.address().port },
      mapped: { host: '::ffff:127.0.0.1', port: v4.address().port },
      any: { host: '0.0.0.0', port: wild.address().port },
      ...(v6 ? { v6: { host: '::1', port: v6.address().port } } : {}),
      ...(lan ? { lan: { host: lan.address, port: wild.address().port } } : {}),
      unix: { path: sock },
    };
    const probe = join(report, 'probe.mjs');
    writeFileSync(probe, `import net from 'node:net';
const out = {};
for (const [k, t] of Object.entries(${JSON.stringify(targets)})) out[k] = await new Promise((r) => { const s = net.connect(t); const d = (v) => { s.destroy(); r(v); }; s.once('connect', () => d('CONNECTED')); s.once('error', (e) => d(e.code)); setTimeout(() => d('TIMEOUT'), 5000); });
out.dns = await import('node:dns').then((dns) => dns.promises.lookup('localhost').then(() => 'OK', (e) => e.code));
console.log(JSON.stringify(out));
`);
    // async spawn: the listeners live in this process and must accept while the probe runs
    const go = (argv) => new Promise((r) => { const c = spawnAsync(argv[0], argv.slice(1), { cwd: repo }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', () => r(o.trim())); });
    try {
      const control = JSON.parse(await go([process.execPath, probe]));
      for (const k of Object.keys(targets)) assert.equal(control[k], 'CONNECTED', `unsandboxed ${k} did not connect, so its denial below would prove nothing: ${JSON.stringify(control)}`);
      for (const egress of ['registry', 'verifiers', 'github', 'target']) {
        const { argv } = hostSandboxArgv({ ...spec({ egress }), cmd: `"${process.execPath}" "${probe}"` });
        const got = JSON.parse(await go(argv));
        for (const k of Object.keys(targets)) assert.equal(got[k], 'EPERM', `${egress}: ${k} was reachable: ${JSON.stringify(got)}`);
        assert.equal(got.dns, 'OK', `${egress}: name resolution broke under the profile: ${JSON.stringify(got)}`);
      }
      const { argv } = hostSandboxArgv({ ...spec({ egress: 'target', loopbackPorts: [v4.address().port] }), cmd: `"${process.execPath}" "${probe}"` });
      const tgt = JSON.parse(await go(argv));
      assert.equal(tgt.v4, 'CONNECTED', `the declared target port was refused: ${JSON.stringify(tgt)}`);
      assert.equal(tgt.unix, 'EPERM');
      if (v6) assert.equal(tgt.v6, 'EPERM', 'a different port on ::1 stayed closed');
    } finally { for (const s of [v4, v6, wild, unix]) if (s) s.close(); }
  });

  test('an open lane still reaches an external address', async () => {
    const probe = `"${process.execPath}" -e "const s=require('net').connect({host:'1.1.1.1',port:443});s.once('connect',()=>{console.log('NET');process.exit(0)});s.once('error',e=>{console.log('ERR',e.code);process.exit(0)});setTimeout(()=>{console.log('ERR TIMEOUT');process.exit(0)},8000)"`;
    const out = run(probe, { egress: 'registry' }).out;
    assert.ok(out === 'NET' || /^ERR (ENETUNREACH|EHOSTUNREACH|TIMEOUT)$/.test(out), `an external connect was refused by the profile: ${out}`);
    assert.doesNotMatch(out, /EPERM/);
  });

  test('a credential directory stays unreadable even when the whole home is declared readable', () => {
    const ssh = join(homedir(), '.ssh');
    const r = run(`ls "${ssh}"`, { extraReads: ['~/'] });
    assert.notEqual(r.status, 0, `~/.ssh was listed: ${r.out}`);
    assert.match(r.out, /Operation not permitted|No such file/);
  });

  test('the preflight passes on the real profile', () => {
    assert.deepEqual(preflightHostSandbox(hostSandboxArgv({ ...spec(), cmd: 'exit 0' })), { ok: true, why: null });
  });

  test('cleanup', () => { rmSync(dir, { recursive: true, force: true }); assert.ok(!existsSync(dir)); assert.ok(readFileSync); });
});
