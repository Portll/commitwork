// The coverage manifest exists to declare where nothing is looking. It had an undeclared gap of
// its own: an ecosystem absent from ECOSYSTEMS produced no row at all — not a void, NOTHING —
// because the loop never searched for a marker set it did not have. Measured 2026-08-22 across
// ~/Repositories/100RandomRepos: C/C++ in 12 repos, nix 10, .NET 6, Swift 2, Dart 2, Elixir 1, all
// invisible, plus 12 PEP-621 Python repos registering as not-Python.
//
// These tests drive the module as a subprocess against fixture trees, because the marker walk and
// the void classification are the behaviour — not any single exported function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOD = join(HERE, '..', 'coverage-manifest.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-cov-'));

/** A fixture repo containing exactly the named files, and a registry pointing at it. */
function fixture(name, files) {
  const root = join(T, name);
  mkdirSync(root, { recursive: true });
  for (const f of files) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '');
  }
  const reg = join(T, `registry-${name}.json`);
  writeFileSync(reg, JSON.stringify({
    reportsRoot: join(T, 'reports'),
    areas: [{ slug: 'fx', label: 'fx', out: 'fx' }],
    roots: [],
    projects: [{ name, area: 'fx', path: root, manifest: 'security-baseline' }],
  }));
  return { root, reg };
}

function run(name, files) {
  const { reg } = fixture(name, files);
  const r = spawnSync(process.execPath, [MOD, '--json'], {
    encoding: 'utf8', env: { ...process.env, CW_REGISTRY: reg, CW_MONITOR_OUT: join(T, 'reports') },
  });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* asserted below, never swallowed */ }
  // A parse failure must FAIL, not skip. The first cut of this file returned early when the
  // registry fixture was malformed, so six assertions passed without ever running — a test suite
  // reporting green on a module it had not executed, which is the defect the module is about.
  assert.ok(j, `coverage-manifest did not emit parseable JSON (exit ${r.status}): ${String(r.stderr).slice(0, 400)}`);
  return { r, j };
}

test('a C/C++ tree emits a DECLARED VOID row, not silence', () => {
  const { j } = run('cpp-only', ['CMakeLists.txt', 'src/main.cpp']);
  const repo = j.repos.find((x) => x.repo === 'cpp-only');
  assert.ok(repo, 'the repo must appear at all');
  const cpp = repo.ecosystems.find((e) => e.ecosystem === 'cpp');
  assert.ok(cpp, 'a CMakeLists.txt tree must produce a cpp row — absence of a row is what this test exists to forbid');
  assert.equal(cpp.vulnerabilityLane, false);
  assert.equal(cpp.voidKind, 'no-advisory-db');
  assert.match(cpp.void, /checked against any CVE feed|memory-safety/i);
});

test('a PEP-621 tree registers as PYTHON — pyproject.toml alone used to read as not-Python', () => {
  const { j } = run('pep621', ['pyproject.toml', 'uv.lock']);
  const repo = j.repos.find((x) => x.repo === 'pep621');
  const py = repo.ecosystems.find((e) => e.ecosystem === 'python');
  assert.ok(py, 'twelve corpus repos were invisible for exactly this reason');
  assert.equal(py.vulnerabilityLane, true, 'python has a lane; the marker list was the gap');
});

test('an ecosystem with no fixed-name marker is found by extension', () => {
  const { j } = run('dotnet', ['src/App.csproj']);
  const repo = j.repos.find((x) => x.repo === 'dotnet');
  const net = repo.ecosystems.find((e) => e.ecosystem === 'dotnet');
  assert.ok(net, '*.csproj is the only marker six corpus repos have');
  // WAS not-wired until 2026-08-24; the gate gained packages.lock.json/packages.config/paket.lock
  // and extraction was measured 2026-08-26, so the ECOSYSTEM is wired. A csproj-only tree still
  // has no resolvable set — that is preflight-build's `blind`, a different module's named grey.
  assert.equal(net.vulnerabilityLane, true, 'NuGet is wired since 2026-08-24; blind-ness is preflight\'s claim, not this row\'s');
  assert.equal(net.voidKind, undefined, 'a wired ecosystem carries no void');
});

test('not-wired is EMPTY — every known-closable void has been closed, and a new one must flip this consciously', () => {
  // 2026-08-22: dart closed. 2026-08-24: the deps-osv gate widened. 2026-08-26: extraction
  // measured per-format against the sweep image (osv-scanner 2.5.1) — dotnet, swift, elixir,
  // haskell, r and conan flipped to wired; deno.lock, conanfile.txt and Podfile.lock were measured
  // as NOT extracted and stay declared voids. If this test fails because a new ecosystem row was
  // added as not-wired, that is the correct state for a parseable-but-ungated format — update the
  // expectation AND schedule the one-line gate fix it names. If it fails any other way, a wired
  // row regressed.
  const { j } = run('mixed', ['CMakeLists.txt', 'src/App.csproj', 'Podfile.lock', 'conan.lock']);
  const repo = j.repos.find((x) => x.repo === 'mixed');
  const kinds = Object.fromEntries(repo.ecosystems.map((e) => [e.ecosystem, e.voidKind]));
  assert.equal(kinds.cpp, 'no-advisory-db', 'nothing in the world resolves a raw CMake tree');
  assert.equal(kinds.cocoapods, 'no-advisory-db', 'OSV has no CocoaPods ecosystem and 2.5.1 does not extract Podfile.lock (measured)');
  assert.equal(kinds.dotnet, undefined, 'dotnet is wired');
  assert.equal(kinds.conan, undefined, 'conan.lock extraction is measured — the resolved face of C/C++ is covered');
  const notWired = repo.ecosystems.filter((e) => e.voidKind === 'not-wired').map((e) => e.ecosystem);
  assert.deepEqual(notWired, [], 'no declared ecosystem is parseable-but-ungated today');
});

test('the C/C++ split: a conan.lock tree is covered AND its CMake face stays a declared void', () => {
  // Two rows on purpose — conan is a package ecosystem with a resolved set; the CMake/autotools
  // face of the same repo still declares system/vendored dependencies no feed can check. One row
  // could only say one of those two true things.
  const { j } = run('cpp-conan', ['CMakeLists.txt', 'conan.lock', 'src/main.cpp']);
  const repo = j.repos.find((x) => x.repo === 'cpp-conan');
  const conan = repo.ecosystems.find((e) => e.ecosystem === 'conan');
  const cpp = repo.ecosystems.find((e) => e.ecosystem === 'cpp');
  assert.ok(conan && conan.vulnerabilityLane === true, 'conan row wired');
  assert.ok(conan.lanes.some((l) => l.check === 'deps-osv' && l.declared), 'and its lane exists in the roster');
  assert.ok(cpp && cpp.vulnerabilityLane === false && cpp.voidKind === 'no-advisory-db', 'cpp face stays a void');
  assert.equal(repo.dependencyCoverage, 'covered', 'one covered ecosystem lifts the repo out of all-voids');
});

test('haskell and r rows exist — parseable formats must not be invisible', () => {
  const { j } = run('hask-r', ['stack.yaml.lock', 'renv.lock']);
  const repo = j.repos.find((x) => x.repo === 'hask-r');
  for (const id of ['haskell', 'r']) {
    const e = repo.ecosystems.find((x) => x.ecosystem === id);
    assert.ok(e, `${id} row must exist — absence of a row is the defect this file exists to forbid`);
    assert.equal(e.vulnerabilityLane, true, `${id} extraction was measured 2026-08-26`);
  }
});

test('dart is no longer a void at all — the worked example of what `not-wired` was worth', () => {
  // Classified not-wired on 2026-08-22 because osv-scanner was SHOWN to parse pubspec.lock
  // (33 packages on the corpus copy), then closed in one line by adding the marker to deps-osv.
  // The whole value of separating the two void kinds is that this one was an afternoon, not a
  // limit of the world.
  const { j } = run('dartrepo', ['pubspec.yaml', 'pubspec.lock']);
  const dart = j.repos.find((x) => x.repo === 'dartrepo').ecosystems.find((e) => e.ecosystem === 'dart');
  assert.ok(dart, 'still detected');
  assert.equal(dart.vulnerabilityLane, true);
  assert.equal(dart.voidKind, undefined, 'a wired ecosystem carries no void at all');
  assert.ok(dart.lanes.some((l) => l.check === 'deps-osv' && l.declared),
    'and the lane it names must exist in the roster');
});

test('a repo whose ecosystems are ALL voids is flagged — the outermost gap', () => {
  const { j } = run('all-void', ['flake.nix', 'CMakeLists.txt']);
  const repo = j.repos.find((x) => x.repo === 'all-void');
  assert.equal(repo.dependencyCoverage, 'all-voids');
  assert.ok(j.unscannedRepos.includes('all-void'),
    'eighteen fleet repos are in this state: fully SAST-scanned, dependencies checked against nothing');
});

test('a repo matching NO marker at all is `unknown-ecosystem`, not "no dependencies"', () => {
  const { j } = run('mystery', ['README.md', 'main.zig']);
  const repo = j.repos.find((x) => x.repo === 'mystery');
  assert.equal(repo.dependencyCoverage, 'unknown-ecosystem');
  assert.match(repo.note, /do not know what this is built with/);
});

test('--area matching nothing EXITS NONZERO rather than printing an empty manifest', () => {
  const { reg } = fixture('area-guard', ['package.json']);
  const r = spawnSync(process.execPath, [MOD, '--json', '--area', 'no-such-area'], {
    encoding: 'utf8', env: { ...process.env, CW_REGISTRY: reg, CW_MONITOR_OUT: join(T, 'reports') },
  });
  assert.notEqual(r.status, 0, 'an empty result here is indistinguishable from a fleet with nothing to scan');
  assert.match(String(r.stderr), /matched none of the/);
});
