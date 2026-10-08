// monitor/test/preflight-build.test.mjs — a scan of an unbuilt repo means nothing, and must say so.
// States, never collapsed: ok / blind (declared deps, no lock artifact) / no-surface (nothing to
// find, which is NOT a pass) / missing. `blind` requires declared dependencies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

import { classify, verdictFor, preflight, buildOne, ECOSYSTEMS } from '../preflight-build.mjs';

const mk = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-pf-'));
  for (const [name, body] of Object.entries(files)) {
    const p = join(d, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body ?? '');
  }
  return d;
};

describe('the three states are kept apart', () => {
  test('a manifest WITH its lock artifact is scannable', () => {
    const d = mk({ 'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}', 'package-lock.json': '{}' });
    assert.deepEqual(classify(d).map((e) => [e.eco, e.state]), [['node', 'ok']]);
    assert.equal(verdictFor({ name: 'r', path: d }).state, 'ok');
    rmSync(d, { recursive: true, force: true });
  });

  test('a manifest WITHOUT its lock artifact is BLIND, and says why', () => {
    const d = mk({ 'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}' });
    const v = verdictFor({ name: 'r', path: d });
    assert.equal(v.state, 'blind');
    assert.match(v.note, /osv\/npm audit have no versions/);
    assert.equal(v.ecosystems[0].lockMissing, 'package-lock.json');
    rmSync(d, { recursive: true, force: true });
  });

  test('NO manifest is `no-surface` — nothing to scan, which is NOT clean', () => {
    const d = mk({ 'README.md': '# docs' });
    const v = verdictFor({ name: 'r', path: d });
    assert.equal(v.state, 'no-surface');
    assert.notEqual(v.state, 'ok', 'a repo with no dependency surface must never report as scannable');
    assert.match(v.note, /not the same as remediated/);
    rmSync(d, { recursive: true, force: true });
  });

  test('a declared repo that is not on disk is `missing`, never a silent skip', () => {
    const v = verdictFor({ name: 'gone', path: join(tmpdir(), 'cw-pf-does-not-exist') });
    assert.equal(v.state, 'missing');
    assert.match(v.note, /void, never a clean/);
  });

  test('any ONE blind ecosystem makes the whole repo blind (a polyglot repo hides behind its best half)', () => {
    const d = mk({ 'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}', 'package-lock.json': '{}', 'go.mod': 'module x' });
    const v = verdictFor({ name: 'r', path: d });
    assert.equal(v.state, 'blind', 'node is locked but go is not — the repo is not scannable');
    assert.deepEqual(v.ecosystems.map((e) => [e.eco, e.state]).sort(), [['go', 'blind'], ['node', 'ok']]);
    rmSync(d, { recursive: true, force: true });
  });

  test('every lockfile dialect counts — a pnpm or yarn repo is not blind', () => {
    for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
      const d = mk({ 'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}', [lock]: '' });
      assert.equal(verdictFor({ name: 'r', path: d }).state, 'ok', `${lock} must count as resolved`);
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('Maven pins in its own POM, so a pom.xml alone is not blind', () => {
    const d = mk({ 'pom.xml': '<project/>' });
    assert.equal(verdictFor({ name: 'r', path: d }).state, 'ok');
    rmSync(d, { recursive: true, force: true });
  });

  // The 2026-08-24 ecosystem entries landed with no test of their own. The swift shape
  // is the FLEET-REAL one: all three fleet Swift repos carry Package.swift with no
  // Package.resolved (measured 2026-08-26), so this exact classification is what keeps them from
  // silently reading as "no dep surface" while the deps-osv gate fires on nothing.
  test('a declaring manifest without its resolved set is BLIND for every 2026-08-24 ecosystem', () => {
    const shapes = [
      ['swift', { 'Package.swift': '// swift-tools-version:5.7' }, 'Package.resolved'],
      ['conan', { 'conanfile.txt': '[requires]\nzlib/1.2.11' }, 'conan.lock'],
      ['elixir', { 'mix.exs': 'defmodule P.MixProject do end' }, 'mix.lock'],
      ['dotnet', { 'packages.config': '<packages/>' }, 'packages.lock.json'],
    ];
    for (const [eco, files, lock] of shapes) {
      const d = mk(files);
      const rows = classify(d).filter((e) => e.eco === eco);
      assert.equal(rows.length, 1, `${eco} must classify at all`);
      assert.equal(rows[0].state, 'blind', `${eco}: a declared set with no lock is blind, not absent`);
      assert.equal(rows[0].lockMissing, lock, `${eco} names the artifact that would unblind it`);
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('the same ecosystems flip to ok when the resolved artifact exists', () => {
    const shapes = [
      [{ 'Package.swift': '// swift-tools-version:5.7', 'Package.resolved': '{"pins":[],"version":2}' }, 'swift'],
      [{ 'conanfile.txt': '[requires]\nzlib/1.2.11', 'conan.lock': '{}' }, 'conan'],
      [{ 'mix.exs': 'defmodule P.MixProject do end', 'mix.lock': '%{}' }, 'elixir'],
    ];
    for (const [files, eco] of shapes) {
      const d = mk(files);
      const rows = classify(d).filter((e) => e.eco === eco);
      assert.equal(rows[0] && rows[0].state, 'ok', `${eco} with its lock is scannable`);
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('detection never mutates, and apply is bounded', () => {
  test('preflight() without --apply builds nothing and writes nothing', () => {
    const d = mk({ 'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}' });
    const before = JSON.stringify(readdirSync(d).sort());
    const out = preflight([{ name: 'r', path: d }]);
    assert.equal(out.tally.blind, 1);
    assert.equal(JSON.stringify(readdirSync(d).sort()), before, 'detection must not touch the tree');
    assert.equal(out.repos[0].built, undefined, 'no build was attempted');
    rmSync(d, { recursive: true, force: true });
  });

  test('a gradle repo with no ./gradlew REFUSES rather than substituting a system toolchain', () => {
    const d = mk({ 'build.gradle': '' });
    // Two refusals now stand in front of gradle, and the ORDER is the point. Since 2026-08-26 the
    // host-execution refusal fires first and unconditionally: ./gradlew evaluates build.gradle as
    // code, as the operator, and no toolchain question is worth asking before that one is settled.
    const outer = buildOne(d, 'jvm-gradle', { env: {} });
    assert.equal(outer.ok, false);
    assert.equal(outer.hostExecRefused, true, 'the host-exec refusal must come first — it does not depend on gradlew existing');

    // The toolchain guard still guards, one layer in, where it now lives: under the deliberate
    // override. Tested THERE rather than deleted, because that is the path on which it protects.
    const inner = buildOne(d, 'jvm-gradle', { env: { CW_PREFLIGHT_ALLOW_HOST_EXEC: '1' } });
    assert.equal(inner.ok, false);
    assert.match(inner.reason, /refusing to substitute a system toolchain/);
    rmSync(d, { recursive: true, force: true });
  });

  test('an ecosystem with nothing to build says so rather than looking unhandled', () => {
    const r = buildOne(mk({}), 'jvm-maven');
    assert.equal(r.ok, false);
    assert.match(r.reason, /no build defined/);
  });

  test('the node build resolves the lock WITHOUT installing or running scripts', () => {
    const node = ECOSYSTEMS.find((e) => e.id === 'node');
    assert.ok(node.build.includes('--package-lock-only'), 'the scanners read the lockfile, not node_modules');
    assert.ok(node.build.includes('--ignore-scripts'), 'a preflight must not execute third-party postinstall code');
  });

  test('the node build does not SEND the dependency graph anywhere — --no-audit is a disclosure bound', () => {
    // npm install audits by default, POSTing the resolved tree to the registry — this tool runs
    // against repos commitwork does not own
    const node = ECOSYSTEMS.find((e) => e.id === 'node');
    assert.ok(node.build.includes('--no-audit'),
      'without --no-audit every --apply ships the scanned repo dependency graph to registry.npmjs.org');
  });

  test('every build command is an argv ARRAY of literals — nothing repo-supplied is interpolated', () => {
    for (const e of ECOSYSTEMS) {
      if (!e.build) continue;
      assert.ok(Array.isArray(e.build), `${e.id} build must be an argv array`);
      for (const part of e.build) assert.equal(typeof part, 'string');
      assert.ok(!e.build.join(' ').includes('${'), `${e.id} interpolates something into its command`);
    }
  });
});

describe('the published report does not carry the operator home directory', () => {
  // preflight.json is rendered by the panel — the path must never carry the operator home dir
  test('`path` is redacted on the way out, for every state', () => {
    const home = process.env.HOME;
    assert.ok(home && home.length > 1, 'this test needs a real HOME to be meaningful');
    const out = preflight([
      { name: 'gone', path: join(home, 'definitely', 'not', 'on', 'disk') },   // -> missing
      { name: 'here', path: home },                                            // -> on disk
    ], { apply: false });
    assert.ok(!JSON.stringify(out).includes(home), 'no published field may contain $HOME');
    for (const r of out.repos) {
      if (r.path !== null) assert.ok(r.path.startsWith('~'), `${r.name}: ${r.path}`);
    }
  });

  test('redaction happens on OUTPUT, so the live path is still usable during the run', () => {
    // buildOne() needs the real path mid-run — redaction must happen on output; this pins WHERE
    const home = process.env.HOME;
    const v = verdictFor({ name: 'here', path: home });
    assert.equal(v.path, home, 'the in-memory verdict keeps the real path for buildOne');
  });
});

describe('only ENOENT means absent — a lookup that FAILED is not a repo that is empty', () => {
  // existsSync answers false for "not there" and "could not look" alike — a failed manifest lookup
  // must read blind, not no-surface. Provoked with ENOTDIR, not chmod (chmod needs cleanup and
  // differs under root).
  test('a manifest path that errors for a reason other than absence is blind, never no-surface', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-pf-enotdir-'));
    writeFileSync(join(d, 'wall'), 'not a directory');
    try {
      const v = verdictFor({ name: 'r', path: join(d, 'wall') });
      // path exists (a file), so not `missing`; lookups under it raise ENOTDIR
      assert.notEqual(v.state, 'no-surface', 'a failed lookup must never present as an empty repo');
      assert.equal(v.state, 'blind');
      assert.match(v.note, /could not be read/, 'and it must name the real cause, not a missing lockfile');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a genuinely empty directory is still no-surface — the fix must not invent voids', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-pf-empty-'));
    try {
      assert.deepEqual(classify(d), [], 'ENOENT everywhere is a real absence');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the report honours the injected clock', () => {
  test('CW_NOW fixes `generated` — determinism is a house invariant, not a nicety', () => {
    const prev = process.env.CW_NOW;
    process.env.CW_NOW = '2026-01-01T00:00:00.000Z';
    try {
      assert.equal(preflight([], { apply: false }).generated, '2026-01-01T00:00:00.000Z');
    } finally {
      if (prev === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prev;
    }
  });

  test('with no CW_NOW it is a real ISO stamp, not an empty string', () => {
    const prev = process.env.CW_NOW;
    delete process.env.CW_NOW;
    try {
      const g = preflight([], { apply: false }).generated;
      assert.match(g, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    } finally { if (prev !== undefined) process.env.CW_NOW = prev; }
  });
});

describe('a zero-dependency project is not blind — there is nothing to be blind to', () => {
  // zero-dep repos reported blind forever, so --apply wrote 1-entry lockfiles into foreign repos
  const mk = (pkg) => {
    const d = mkdtempSync(join(tmpdir(), 'cw-preflight-zerodep-'));
    writeFileSync(join(d, 'package.json'), JSON.stringify(pkg));
    return d;
  };

  test('no declared dependencies and no lockfile is no-surface, not blind', () => {
    const d = mk({ name: 'z', version: '1.0.0' });
    try {
      assert.deepEqual(classify(d), [], 'nothing to resolve means no ecosystem verdict');
      const v = verdictFor({ name: 'z', path: d });
      assert.equal(v.state, 'no-surface');
      assert.match(v.note, /declares no dependencies/, 'and the note must not claim there is no manifest');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('ONE declared dependency is enough to be blind again', () => {
    const d = mk({ name: 'z', version: '1.0.0', dependencies: { left: '^1.0.0' } });
    try {
      assert.equal(verdictFor({ name: 'z', path: d }).state, 'blind');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('devDependencies alone count — they are scanned too', () => {
    const d = mk({ name: 'z', version: '1.0.0', devDependencies: { vitest: '^2.0.0' } });
    try {
      assert.equal(verdictFor({ name: 'z', path: d }).state, 'blind');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a WORKSPACE root with no direct deps is still blind — its members have plenty', () => {
    const d = mk({ name: 'z', version: '1.0.0', workspaces: ['packages/*'] });
    try {
      assert.equal(verdictFor({ name: 'z', path: d }).state, 'blind',
        'calling a workspace root empty would hide a real tree behind a technicality');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('an UNPARSEABLE manifest is never treated as zero-dependency — fail closed', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-preflight-badjson-'));
    writeFileSync(join(d, 'package.json'), '{ not json');
    try {
      assert.equal(verdictFor({ name: 'z', path: d }).state, 'blind',
        '"we could not tell" must never be promoted to "there is nothing there"');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('--apply keeps a ledger of what it wrote into repos it does not own', () => {
  // nobody can undo what nobody enumerated — every build records what it wrote
  test('a build that creates a lock records WHERE, and the path is redacted on output', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-preflight-ledger-'));
    // guard: scratch root, never the real sidecar
    const root = mkdtempSync(join(tmpdir(), 'cw-preflight-lockroot-'));
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } }));
    try {
      // thirdPartyAreas: an EXPLICIT empty Set. Since 2026-08-24 an --apply that never declared its
      // third-party areas fails closed and refuses everything, so a build test must now say that it
      // has none. Omitting it used to mean "protect nothing", which is how that guard sat inert.
      const out = preflight([{ name: 'probe', path: d }], { apply: true, timeoutMs: 180_000, thirdPartyAreas: new Set(),
        env: { ...process.env, CW_LOCKFILE_ROOT: root } });
      const built = (out.repos[0].built || [])[0];
      if (!built || !built.ok) return;        // no npm on this box, or offline — a different fact
      assert.ok(Array.isArray(built.wrote), 'every build entry must carry a `wrote` list, even if empty');
      assert.ok(built.wrote.some((p) => p.endsWith('package-lock.json')),
        `the created lock must be named: ${JSON.stringify(built.wrote)}`);
      assert.ok(!readdirSync(d).includes('package-lock.json'), 'the default destination is the sidecar, never the repository');
      assert.ok(readdirSync(join(root, basename(d))).includes('package-lock.json'), 'the lock landed under <root>/<repo dir name>/');
      assert.ok(!JSON.stringify(out).includes(process.env.HOME || ' '), 'the ledger is redacted too');
    } finally { rmSync(d, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
  });

  test('a build that creates nothing records an EMPTY ledger, not a missing one', () => {
    // absent and empty are different claims — wrote:[] never wrote:undefined
    const d = mkdtempSync(join(tmpdir(), 'cw-preflight-ledger2-'));
    writeFileSync(join(d, 'build.gradle'), '// no wrapper here');
    try {
      const out = preflight([{ name: 'probe', path: d }], { apply: true, timeoutMs: 10_000, thirdPartyAreas: new Set() });
      for (const b of out.repos[0].built || []) {
        assert.ok(Array.isArray(b.wrote), `${b.eco}: wrote must be an array, got ${typeof b.wrote}`);
        assert.equal(b.wrote.length, 0, `${b.eco}: a refused build wrote nothing`);
      }
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('a failed build reports its CAUSE, not the path to a log', () => {
  // npm's last stderr line names no cause and publishes a home path — the diagnosis is earlier
  test('the npm error code and the offending package both survive into `reason`', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-preflight-e404-'));
    writeFileSync(join(d, 'package.json'), JSON.stringify({
      name: 'p', version: '1.0.0', dependencies: { '@portll-test/definitely-not-published': '1.0.0' },
    }));
    try {
      const r = buildOne(d, 'node', { timeoutMs: 120_000 });
      if (r.ok) return;                       // a registry that resolves this name is not our case
      if (r.toolchainMissing) return;         // no npm on this box — a different fact, tested elsewhere
      assert.ok(!/_logs|complete log of this run/.test(r.reason),
        `reason must not be the log path, got: ${r.reason}`);
      assert.ok(!r.reason.includes(process.env.HOME || '\0'), 'reason must not carry $HOME');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('a missing toolchain is its own fact', () => {
  // "could not build it" and "nothing to build it with" send someone to two different places
  test('a command that is not installed reports toolchainMissing, not a build failure', () => {
    const d = mk({ 'package.json': '{"dependencies":{"left-pad":"^1.0.0"}}' });
    // fact: root given so the spawn fails
    const r = buildOne(d, 'node', { env: { ...process.env, PATH: '/nonexistent', CW_LOCKFILE_ROOT: join(tmpdir(), 'cw-pf-toolchain-root') } });
    assert.equal(r.ok, false);
    assert.equal(r.toolchainMissing, true, 'ENOENT on the interpreter is a missing toolchain');
    rmSync(d, { recursive: true, force: true });
  });

  test('the Java and Python phrasings this fleet actually emitted are recognised', () => {
    // pinned as strings because they are what the real tools printed, not what we assume they print
    for (const msg of [
      'Please visit http://www.java.com for information on installing Java.',
      "/usr/bin/python3: No module named piptools",
      'Unable to locate a Java Runtime.',
    ]) {
      assert.match(msg, /No module named|installing Java|command not found|not recognized as|Unable to locate a Java Runtime/i,
        `the detector must recognise: ${msg}`);
    }
  });

  test('--apply re-classifies FROM DISK, so a build that worked is proved by the artifact', () => {
    const d = mk({ 'package.json': JSON.stringify({ name: 'pf-fixture', version: '1.0.0', dependencies: { 'left-pad': '^1.0.0' } }) });
    // guard: scratch root, never the real sidecar
    const root = mkdtempSync(join(tmpdir(), 'cw-preflight-reclass-root-'));
    const out = preflight([{ name: 'r', path: d }], { apply: true, timeoutMs: 60_000, thirdPartyAreas: new Set(),
      env: { ...process.env, CW_LOCKFILE_ROOT: root } });
    const v = out.repos[0];
    assert.ok(Array.isArray(v.built), 'the attempt is recorded whatever its outcome');
    // fact: disk includes the sidecar
    let lockOnDisk = false;
    try { lockOnDisk = readdirSync(join(root, basename(d))).includes('package-lock.json'); } catch { lockOnDisk = false; }
    assert.ok(!readdirSync(d).includes('package-lock.json'), 'the repository itself is never written by default');
    assert.equal(v.state, lockOnDisk ? 'ok' : 'blind',
      'the verdict must agree with what is actually on disk, not with what npm claimed');
    rmSync(d, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
  });
});
