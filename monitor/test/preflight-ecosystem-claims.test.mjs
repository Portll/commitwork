// The prober and the lane must agree about what an ecosystem IS.
//
// deps-osv scanned Cargo.lock, Gemfile.lock and subdirectory go.mod files and found CVEs in them,
// while preflight published "no dependency manifest of any known ecosystem" over the same repos:
// foundry, reth, quinn, vector (rust), dependabot-core (ruby), 1Panel and coze-loop (go, one level
// down). Seven of the 35 repos it called no-surface were repos it was actively finding CVEs in.
//
// The fix is not to DERIVE the ecosystem table from the lane's appliesIfExists — those answer
// different questions (`does the lane start` vs `is the tree RESOLVED`), and collapsing them would
// make a Cargo.toml-only repo read `ok`, which is the blind-jvm false-clean in a new ecosystem.
// The fix is this test: every marker the lane starts on must be CLAIMED — by an ecosystem entry,
// or by a declared void in the coverage manifest, or by an explicit exemption with a reason here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ECOSYSTEMS, classify, classifyTree, verdictFor } from '../preflight-build.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
const osv = manifest.checks.find((c) => c.id === 'deps-osv');

// Markers the lane starts on that deliberately have no ecosystem entry, each with the reason.
// An entry here is a CLAIM that the gap is understood — not a way to silence the test.
const EXEMPT = new Map([
  ['go.sum', 'the lock half of the go pair; the manifest (go.mod) carries the entry'],
  ['package-lock.json', 'a node lock; the manifest (package.json) carries the entry'],
  ['pnpm-lock.yaml', 'a node lock; the manifest (package.json) carries the entry'],
  ['yarn.lock', 'a node lock; the manifest (package.json) carries the entry'],
  ['Pipfile.lock', 'a python lock; the manifest (pyproject.toml/requirements.txt) carries the entry'],
  ['composer.lock', 'a php lock; the manifest (composer.json) carries the entry'],
  ['Gemfile.lock', 'a ruby lock; the manifest (Gemfile) carries the entry'],
  ['Cargo.lock', 'a rust lock; the manifest (Cargo.toml) carries the entry'],
  ['build.gradle', 'jvm-gradle'], ['build.gradle.kts', 'jvm-gradle'], ['pom.xml', 'jvm-maven'],
]);

test('every marker deps-osv starts on is claimed by an ecosystem entry or an explicit exemption', () => {
  const known = new Set();
  for (const eco of ECOSYSTEMS) for (const n of [...eco.manifest, ...eco.lock]) known.add(n);
  const unclaimed = (osv.appliesIfExists || [])
    .map((m) => m.replace(/^\.\//, ''))
    .filter((m) => !known.has(m) && !EXEMPT.has(m));
  assert.deepEqual(unclaimed, [],
    `deps-osv starts on ${JSON.stringify(unclaimed)} but preflight has no ecosystem entry for it, so every repo whose ONLY dependency surface is that file is published as "no dependency manifest of any known ecosystem" while the lane scans it. Add an ECOSYSTEMS entry (manifest + lock pair) or an EXEMPT line stating why the gap is correct.`);
});

test('every ecosystem declares a manifest/lock pair, and build:null says WHY rather than looking unhandled', () => {
  for (const eco of ECOSYSTEMS) {
    assert.ok(eco.manifest.length && eco.lock.length, `${eco.id} must name both a manifest and a lock`);
    assert.ok(eco.why && eco.why.length > 40, `${eco.id} must say what blindness costs`);
    if (eco.build === null && eco.id !== 'jvm-maven') {
      assert.match(eco.why, /Not built here/,
        `${eco.id} has build:null — the why must say it is a POLICY refusal (resolution executes package-author code on the host), or a reader files "add ${eco.id} support" against a capability gap that is not one`);
    }
    for (const n of [...eco.manifest, ...eco.lock]) {
      assert.ok(!n.includes('*'), `${eco.id}: '${n}' is a glob, and presence() stats — a glob here never matches and the ecosystem silently disappears`);
    }
  }
});

// ── the walk, and the collapse it must not feed ─────────────────────────────────────────────────

test('an unlocked subtree does NOT make a locked repo blind — the root decides state', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-pf-'));
  writeFileSync(join(root, 'package.json'), '{"dependencies":{"x":"1"}}');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  mkdirSync(join(root, 'examples'), { recursive: true });
  writeFileSync(join(root, 'examples', 'package.json'), '{"dependencies":{"y":"1"}}'); // no lock, by convention
  const v = verdictFor({ name: 'r', path: root });
  assert.equal(v.state, 'ok',
    'every monorepo has an unlocked examples/ package; a blind-if-ANY collapse over a widened walk would turn that into a repo-wide void and then invite --apply to build it');
  assert.ok(!(v.subtrees || []).some((s) => s.dir === 'examples'), 'examples/ is skipped by the walk entirely');
});

test('a repo with no root manifest but manifests below it is subtree-only — not no-surface', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-pf2-'));
  mkdirSync(join(root, 'core'), { recursive: true });
  writeFileSync(join(root, 'core', 'go.mod'), 'module x');
  writeFileSync(join(root, 'core', 'go.sum'), '');
  const v = verdictFor({ name: 'r', path: root });
  assert.equal(v.state, 'subtree-only',
    '1Panel carries core/go.mod and agent/go.mod, both scanned by osv, and read as "no dependency manifest of any known ecosystem"');
  assert.equal(v.subtrees.length, 1);
  assert.match(v.note, /no dependency manifest at the root/);
});

test('the walk is bounded and skips vendored and fixture trees', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-pf3-'));
  for (const d of ['node_modules/pkg', 'vendor/lib', 'spec/fixtures/proj', 'a/b/c']) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, 'package.json'), '{"dependencies":{"z":"1"}}');
  }
  const dirs = classifyTree(root).map((s) => s.dir);
  assert.ok(!dirs.some((d) => d.startsWith('node_modules')), 'a vendored dependency tree is not this repo declaring dependencies');
  assert.ok(!dirs.some((d) => d.startsWith('vendor')), 'same for vendor/');
  assert.ok(!dirs.some((d) => d.includes('fixtures')), 'fixtures are deliberately broken by design; they never describe the shipped tree');
  assert.ok(!dirs.some((d) => d.split('/').length > 2), `the walk is bounded at depth 2, saw ${JSON.stringify(dirs)}`);
});

test('rust, ruby and php resolve as ok when locked and blind when not — the states that were missing entirely', () => {
  for (const [eco, mf, lock] of [['rust', 'Cargo.toml', 'Cargo.lock'], ['ruby', 'Gemfile', 'Gemfile.lock'], ['php', 'composer.json', 'composer.lock']]) {
    const locked = mkdtempSync(join(tmpdir(), `cw-${eco}-ok-`));
    writeFileSync(join(locked, mf), ''); writeFileSync(join(locked, lock), '');
    assert.deepEqual(classify(locked).map((e) => [e.eco, e.state]), [[eco, 'ok']]);
    const bare = mkdtempSync(join(tmpdir(), `cw-${eco}-blind-`));
    writeFileSync(join(bare, mf), '');
    const c = classify(bare);
    assert.equal(c[0].state, 'blind', `${mf} without ${lock} has no resolved version set`);
    assert.equal(c[0].buildable, false, `${eco} must not be buildable here — resolution runs package-author code on the host`);
  }
});

// ── WHERE RESOLUTION IS ALLOWED TO RUN ──────────────────────────────────────────────────────────
// --apply is the one path in this file that MUTATES, and resolving a dependency tree means running
// that tree's own resolver. The thirdParty refusal stops it being pointed at a corpus nobody here
// owns; this decides what happens for the repos it does cover, and the three answers differ.
import { buildOne } from '../preflight-build.mjs';
import { existsSync, rmSync } from 'node:fs';

test('gradle is REFUSED on the host by default, and the repo\'s own script never runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-gradle-'));
  writeFileSync(join(root, 'build.gradle'), 'apply plugin: "java"');
  // A gradlew that would prove execution if it ever ran.
  const marker = join(tmpdir(), `cw-hostexec-${process.pid}`);
  rmSync(marker, { force: true });
  writeFileSync(join(root, 'gradlew'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });

  const r = buildOne(root, 'jvm-gradle', { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.hostExecRefused, true);
  assert.match(r.reason, /evaluates this repository's build script as code on the host/);
  assert.equal(existsSync(marker), false,
    'the repository\'s gradlew executed — this is arbitrary code as the operator, on a box holding the keychain and every fleet git remote');
});

test('the host-exec override is exact — a truthy-looking value is not consent', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-gradle2-'));
  writeFileSync(join(root, 'build.gradle'), 'x');
  for (const v of ['', '0', 'yes', 'true', 'YES']) {
    assert.equal(buildOne(root, 'jvm-gradle', { env: { CW_PREFLIGHT_ALLOW_HOST_EXEC: v } }).hostExecRefused, true,
      `CW_PREFLIGHT_ALLOW_HOST_EXEC=${JSON.stringify(v)} must not be read as consent — only '1' is`);
  }
});

test('node and python are routed to the container lane, not execFileSync on the host', () => {
  const src = readFileSync(new URL('../preflight-build.mjs', import.meta.url), 'utf8');
  assert.match(src, /const CONTAINER_LANE = \{ node: 'npm', python: 'python' \}/,
    'the two ecosystems bin/lockfile-synth.sh covers must be declared as delegating to it');
  assert.match(src, /lockfile-synth\.sh/,
    'buildOne must invoke the container script rather than resolving on the host');
  // go stays on the host DELIBERATELY. Asserted structurally rather than by matching prose, which
  // rewraps: it is in neither table, which is what "host, on purpose" looks like in this design.
  assert.match(src, /const HOST_EXECUTES_REPO_CODE = new Set\(\['jvm-gradle'\]\)/,
    'the ecosystems whose resolution runs repo code on the host must be declared, not inferred');
  const lanes = src.match(/const CONTAINER_LANE = \{([^}]*)\}/)[1];
  assert.ok(!/\bgo\b/.test(lanes), 'go does not go through the container lane');
  assert.ok(!/'go'/.test(src.match(/HOST_EXECUTES_REPO_CODE = new Set\(\[([^\]]*)\]/)[1]),
    'go is not refused either — it downloads and checksums without executing package code, and is '
    + 'the one ecosystem deliberately left on the host');
});
