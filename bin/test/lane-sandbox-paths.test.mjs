// The lanes whose own lock, cache or database sat outside what the host sandbox let them touch,
// measured 2026-09-30 on cobolwork and ironwork. Every row was written by the sandbox rather than by
// the scanned repo, so every repo in the fleet carried it:
//
//   deps-rust-audit   cargo-audit locks ~/.cargo/advisory-db..lock, a SIBLING of the declared dir
//   sast-opengrep     the onefile bundle could not read its own unpacked copy and tried to rewrite it
//   supply-chain-socket  the CLI's self-update check read ~/.npmrc, which the sandbox withholds
//   deps-reachability dep-scan re-downloads a DB built over 48h ago, inside a network-severed container
//
// lint-rust-clippy's build lock is handled by bin/lib/cargo-target.mjs, pinned in cargo-target.test.mjs.
//
// Each is held against the REAL declaration in manifests/security-baseline.json. The live half runs
// the generated seatbelt profile over a fixture home, each result paired with a control that must
// come out the other way, and skips loudly where sandbox-exec is absent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostSandboxArgv } from '../lib/sandbox.mjs';
import { scopedDockerReads } from '../commitwork.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const sb = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
const lane = (id) => { const c = sb.checks.find((x) => x.id === id); assert.ok(c, `${id} is not in the manifest`); return c; };
const reads = (c) => c.sandboxExtraReads || [];
const writes = (c) => c.sandboxExtraWrites || [];

/**
 * Why a seatbelt control in this file could not refuse, when it could not.
 *
 * Every live block below puts its fixture under `homedir()` on the stated fact that TMPDIR and /tmp
 * are readable and writable in EVERY lane, so a control placed there would pass for the wrong
 * reason. That rests on an unstated premise: that HOME is not itself inside one of those roots. A
 * harness running this suite with `HOME=mkdtemp(os.tmpdir())` — which is what a clean-export
 * public-test run does — breaks it. The controls stop refusing and the tests fail about the LANE
 * DECLARATIONS for a reason that belongs to the harness.
 *
 * Measured 2026-10-04 on a sidecar-less public export of HEAD with HOME under an allowed root: 4
 * failures in this file and 2 in bin/test/sandbox-host.test.mjs, all 6 passing again with the real
 * HOME. Unmeasured is its own state: not a pass, and not a finding about the declarations.
 */
const unconfinedHome = (where) => 'SKIPPED (not a silent pass): the negative control was NOT refused, so '
  + `HOME (${homedir()}) resolves inside a root this profile allows and nothing placed under ${where} can `
  + 'be denied. The lane declaration is UNMEASURED here, neither confirmed nor broken. Remedy: run this '
  + 'suite with HOME outside TMPDIR and /tmp.';

describe('the scoped docker config', () => {
  test('a networked lane reads the docker config commitwork set, and a lane with no network does not', () => {
    const env = { DOCKER_CONFIG: '/srv/commitwork/docker' };
    assert.deepEqual(scopedDockerReads(lane('deps-jvm'), env), ['/srv/commitwork/docker']);
    assert.deepEqual(scopedDockerReads({ egress: 'none' }, env), []);
    assert.deepEqual(scopedDockerReads({}, env), [], 'an undeclared egress class is not treated as networked');
    assert.deepEqual(scopedDockerReads(lane('deps-jvm'), {}), [], 'no DOCKER_CONFIG, nothing to read');
  });

  test('a trivy lane under the real profile reads that config, and without the read it cannot (the control)', { skip: process.platform === 'darwin' ? false : 'seatbelt is macOS only' }, (t) => {
    const home = mkdtempSync(join(homedir(), '.cw-dockercfg-'));
    try {
      const cfg = join(home, 'docker'); mkdirSync(cfg); writeFileSync(join(cfg, 'config.json'), '{}\n');
      const repo = join(home, 'repo'); mkdirSync(repo);
      const base = { egress: 'registry', repoPath: repo, reportDir: join(home, 'r'), platform: 'darwin', cwRoot: ROOT,
        nodePrefix: join(process.execPath, '..', '..'), tmpDir: tmpdir(), home, cmd: `cat "${cfg}/config.json"` };
      mkdirSync(base.reportDir);
      const run = (extraReads) => { const { argv } = hostSandboxArgv({ ...base, extraReads }); return spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' }); };
      // The control FIRST, as a precondition: if an undeclared read is not refused, HOME is inside an
      // allowed root and the pair below proves nothing either way. See `unconfinedHome` above.
      const withoutRead = run([]);
      if (withoutRead.status === 0) { t.skip(unconfinedHome(home)); return; }
      assert.equal(run(scopedDockerReads(lane('deps-jvm'), { DOCKER_CONFIG: cfg })).stdout, '{}\n');
      assert.notEqual(withoutRead.status, 0, 'the config was readable without the declared read');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

describe('a Swift package under the Swift lane', () => {
  // fact: swiftc writes its clang module cache under the per-user cache dir, a sibling of TMPDIR / without the declared @usercache write the manifest compile died at "Unable to load standard library", measured 2026-10-07 (expiry: never, prev: broken)
  const swift = process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'swift'], { stdio: 'ignore' }).status === 0;
  test('swift build --disable-sandbox completes under the declaration, and without the cache write it cannot (the control)', { skip: swift ? false : 'no swift toolchain on this host', timeout: 600_000 }, (t) => {
    const c = lane('sast-codeql-swift');
    assert.ok(writes(c).includes('@usercache/clang/ModuleCache'), JSON.stringify(writes(c)));
    const cache = spawnSync('getconf', ['DARWIN_USER_CACHE_DIR'], { encoding: 'utf8' }).stdout.trim().replace(/\/+$/, '');
    const dev = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' }).stdout.trim();
    const root = mkdtempSync(join(homedir(), '.cw-swiftpm-'));
    try {
      const repo = join(root, 'repo'); mkdirSync(join(repo, 'Sources', 'Seed'), { recursive: true });
      writeFileSync(join(repo, 'Package.swift'), '// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "Seed", targets: [.target(name: "Seed", path: "Sources/Seed")])\n');
      writeFileSync(join(repo, 'Sources', 'Seed', 'Seed.swift'), 'public func seed() -> Int { 1 }\n');
      const report = join(root, 'r'); mkdirSync(report);
      const run = (extraWrites, scratch) => {
        const { argv } = hostSandboxArgv({ egress: c.egress, repoPath: repo, reportDir: report, platform: 'darwin', cwRoot: ROOT,
          nodePrefix: join(process.execPath, '..', '..'), tmpDir: tmpdir(), home: homedir(), developerDir: dev,
          userCacheDir: realpathSync(cache), extraReads: reads(c), extraWrites,
          cmd: `xcrun swift build --disable-sandbox --scratch-path "${join(report, scratch)}" 2>&1 | tail -3` });
        return spawnSync(argv[0], argv.slice(1), { cwd: repo, encoding: 'utf8' }).stdout;
      };
      const without = run(writes(c).filter((p) => !p.startsWith('@usercache/')), 'b0');
      if (/Build complete/.test(without)) { t.skip('SKIPPED (not a silent pass): the package built WITHOUT the declared cache write, so the control was not refused and the declaration is UNMEASURED here.'); return; }
      assert.match(run(writes(c), 'b1'), /Build complete/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('the declarations', () => {
  // fact: rust-analyzer reads ~/.rustup/settings.toml to find the sysroot / without it the CodeQL Rust lane extracted no standard library and returned zero results from code with two findings, measured 2026-10-04 (expiry: never, prev: broken)
  test('sast-codeql-rust reads the toolchain the standard library comes from', () => {
    const c = lane('sast-codeql-rust');
    assert.ok(reads(c).includes('~/.rustup') && reads(c).includes('~/.cargo'), JSON.stringify(reads(c)));
  });

  test('deps-rust-audit declares the sibling lock cargo-audit takes, beside the database it guards', () => {
    assert.deepEqual(writes(lane('deps-rust-audit')).filter((p) => p.startsWith('~/.cargo/advisory-db')).sort(),
      ['~/.cargo/advisory-db', '~/.cargo/advisory-db..lock']);
  });

  test('sast-opengrep reads its unpacked bundle and cannot write it', () => {
    const c = lane('sast-opengrep');
    assert.ok(reads(c).includes('~/.cache/opengrep'));
    assert.deepEqual(writes(c).filter((p) => p === '~/.cache' || p.startsWith('~/.cache/opengrep/') || p === '~/.cache/opengrep'), []);
  });

  test('supply-chain-socket names its registry, and ~/.npmrc is declared nowhere on the lane', () => {
    const c = lane('supply-chain-socket');
    assert.match(c.local[0], /^npm_config_registry=https:\/\/\S+ socket scan create /);
    assert.deepEqual([...reads(c), ...writes(c)].filter((p) => p.includes('.npmrc')), []);
  });

  test('deps-reachability: the severed scan phase hands dep-scan an age it cannot exceed; the warm phase does not', () => {
    const script = readFileSync(join(ROOT, 'bin', 'depscan-scan.sh'), 'utf8');
    const scan = script.slice(script.indexOf('SCAN_SBX="$('), script.indexOf('$ALLOW_NET_FLAG)"'));
    const hours = Number((/--env VDB_AGE_HOURS=(\d+)/.exec(scan) || [])[1]);
    assert.ok(hours >= 24 * 365 * 50, `VDB_AGE_HOURS=${hours} lets dep-scan decide a DB is stale inside a container that cannot fetch`);
    assert.match(scan, /--mount "\$VDB_VOL:\/vdb:ro"/, 'the scan phase still mounts the DB read-only');
    const warm = script.slice(script.indexOf('vdb_download(){'), script.indexOf('VDB_WARM=0'));
    assert.doesNotMatch(warm, /VDB_AGE_HOURS/);
  });
});

const live = process.platform === 'darwin' && spawnSync('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'], { stdio: 'ignore', timeout: 20_000 }).status === 0;
const skip = live ? false : 'sandbox-exec unavailable on this host — the lane declarations are NOT verified here';

describe('the declarations, measured under seatbelt', { skip }, () => {
  // fact: the fixture lives under the home directory, not TMPDIR / TMPDIR and /tmp are writable in every lane, so a control placed there passes for the wrong reason (expiry: never, prev: wrong)
  const dir = mkdtempSync(join(homedir(), '.cw-sbx-lanes-'));
  const home = join(dir, 'home'); const repo = join(dir, 'repo'); const report = join(dir, 'report'); const stubs = join(dir, 'stubs');
  for (const d of [home, repo, report, stubs]) mkdirSync(d);
  const stub = (name, body) => { const p = join(stubs, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); };
  const run = (c, cmd, over = {}) => {
    const { argv } = hostSandboxArgv({
      egress: c.egress, repoPath: repo, reportDir: report, platform: 'darwin', cwRoot: ROOT,
      nodePrefix: join(process.execPath, '..', '..'), tmpDir: tmpdir(), home,
      extraReads: [stubs, ...reads(c)], extraWrites: writes(c), cmd, ...over,
    });
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 60_000, cwd: repo,
      env: { ...process.env, CW_REPORT_DIR: report, PATH: `${stubs}:${process.env.PATH}`, CW_FIXTURE_HOME: home } });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
  };

  // A PRECONDITION, NOT AN ASSERTION — see `unconfinedHome` at the top of this file for why.
  // Probed, never inferred from the path: the allowed set is the profile's to state, and /tmp is in it
  // without being os.tmpdir().
  const unconfinedHomeHere = (() => {
    const p = join(home, 'confinement-probe');
    const r = run(lane('deps-rust-audit'), `echo x > "${p}"`, { extraWrites: [] });
    const landed = existsSync(p);
    if (landed) rmSync(p, { force: true });
    if (r.status !== 0 && !landed) return null; // the control refuses: the premise holds
    return unconfinedHome(home);
  })();

  test('cargo-audit takes its lock under the declaration, and cannot with the database alone declared', (t) => {
    if (unconfinedHomeHere) { t.skip(unconfinedHomeHere); return; }
    const c = lane('deps-rust-audit');
    mkdirSync(join(home, '.cargo', 'advisory-db'), { recursive: true });
    const lock = join(home, '.cargo', 'advisory-db..lock');
    const take = `: > "${lock}" && echo LOCKED`;
    const without = run(c, take, { extraWrites: writes(c).filter((p) => !p.endsWith('..lock')) });
    assert.notEqual(without.status, 0);
    assert.ok(!existsSync(lock), 'the control created the lock, so the pair below proves nothing');
    assert.equal(run(c, take).out, 'LOCKED');
  });

  test('opengrep reads its unpacked copy, cannot overwrite it, and without the read is refused (the measured failure)', (t) => {
    if (unconfinedHomeHere) { t.skip(unconfinedHomeHere); return; }
    const c = lane('sast-opengrep');
    const bin = join(home, '.cache', 'opengrep', 'v0', 'opengrep.bin');
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, 'BUNDLE');
    assert.notEqual(run(c, `cat "${bin}"`, { extraReads: [stubs] }).status, 0);
    assert.equal(run(c, `cat "${bin}"`).out, 'BUNDLE');
    assert.notEqual(run(c, `echo X > "${bin}"`).status, 0);
    assert.equal(readFileSync(bin, 'utf8'), 'BUNDLE');
  });

  // The stub reproduces socket 1.1.102's registryUrl (dist/vendor.js): npm_config_registry returns
  // early; without it the CLI reads the .npmrc it finds walking up from the tree.
  test('socket\'s own command reaches the CLI with the registry named, and ~/.npmrc stays unreadable', (t) => {
    if (unconfinedHomeHere) { t.skip(unconfinedHomeHere); return; }
    const c = lane('supply-chain-socket');
    writeFileSync(join(home, '.npmrc'), '//registry.npmjs.org/:_authToken=FIXTURE\n');
    stub('socket', '[ -n "$npm_config_registry" ] && { echo "{}"; exit 0; }\ncat "$CW_FIXTURE_HOME/.npmrc" >/dev/null || exit 1\necho "{}"');
    run(c, c.local[0]);
    assert.equal(readFileSync(join(report, 'socket.json.exit'), 'utf8').trim(), '0', readFileSync(join(report, 'socket.log'), 'utf8'));
    const r = run(c, `cat "${join(home, '.npmrc')}"`);
    assert.notEqual(r.status, 0, `~/.npmrc was readable in the socket lane: ${r.out}`);
    assert.equal(run(c, c.local[0].replace(/^npm_config_registry=\S+ /, '') + '; cat "$CW_REPORT_DIR/socket.json.exit"').out.split('\n').pop(), '1',
      'without the variable the stub must hit the withheld file, or it does not model the failure');
  });

  test('cleanup', () => { rmSync(dir, { recursive: true, force: true }); assert.ok(!existsSync(dir)); });
});
