// Lanes that build the scanned tree, on `scan` and `brief` (threat model R2). `run` keeps them out of
// its default groups and records a void (containedVoids); `scan` runs every check, so it holds the
// same lanes behind consent instead, keyed on the same predicate. The CLI tests use the three bundled
// lane definitions verbatim, with stub tools first on PATH that log their argv: a lane ran exactly
// when its tool was called, and its own log files in the report directory are the second witness.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildsScannedTree, containedVoids, groupMembers, repoTrusted,
  buildLaneVoid, buildConsented, BUILD_CONSENT_REASON, BUILD_WHOLE_MACHINE_REASON,
} from '../commitwork.mjs';
import { probeHostSandbox } from '../lib/sandbox.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'bin', 'commitwork.mjs');
const baseline = () => JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
const BUILD_LANES = ['lint-rust-clippy', 'sast-codeql-go', 'sast-codeql-swift'];
const STUBS = ['codeql', 'xcodebuild', 'go', 'cargo', 'cargo-clippy'];
// What each lane writes to its report directory before or while calling its tool.
const LANE_LOGS = { 'sast-codeql-swift': 'codeql-swift.log', 'sast-codeql-go': 'codeql-go.log', 'lint-rust-clippy': 'clippy.log' };

const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

// A home holding one repository with Swift, Go and Rust sources, stub tools outside it, and a
// manifest of the three bundled build lanes exactly as they ship.
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cw-build-consent-')));
  const home = join(dir, 'home');
  const root = join(home, 'src');
  const repo = join(root, 'tree');
  const marks = join(dir, 'marks');
  const bin = join(dir, 'bin');
  for (const d of [repo, marks, bin]) mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'App.swift'), 'import Foundation\n');
  writeFileSync(join(repo, 'main.go'), 'package main\n\nfunc main() {}\n');
  writeFileSync(join(repo, 'Cargo.toml'), '[package]\nname = "tree"\nversion = "0.0.0"\n');
  for (const t of STUBS) {
    writeFileSync(join(bin, t), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(marks, `${t}.log`)}'\nexit 0\n`);
    chmodSync(join(bin, t), 0o755);
  }
  const manifest = join(dir, 'm.json');
  const checks = baseline().checks.filter((c) => BUILD_LANES.includes(c.id));
  assert.deepEqual(checks.map((c) => c.id).sort(), BUILD_LANES, 'a bundled build lane was renamed or removed');
  writeFileSync(manifest, JSON.stringify({ repo: 'fixture', checks }));
  return { dir, home, root, repo, marks, bin, manifest };
}

function cliEnv(f, extra = {}) {
  const env = { ...process.env, HOME: f.home, PATH: `${f.bin}:${process.env.PATH}`, CW_SKIP_SETUP: '1', CW_SELF_SWEEP: '0',
    CW_DOCKER: 'false', CW_CARGO_TARGET_ROOT: join(f.dir, 'cargo-target'), CW_SCAN_CONFIG: join(f.dir, 'none.json'), ...extra };
  for (const k of ['COMMITWORK_TRUST_REPO_MANIFEST', 'CW_TARGET_URL', 'COMMITWORK_MANIFEST', 'COMMITWORK_REPO', 'CW_SANDBOX']) if (!(k in extra)) delete env[k];
  // With no host sandbox a build lane is refused whatever the consent (sandbox-repo-code.test.mjs); consent is the subject here.
  if (!('CW_SANDBOX' in extra) && !probeHostSandbox().available) env.CW_SANDBOX = 'off';
  return env;
}

const stubCalls = (f, tool) => { try { return readFileSync(join(f.marks, `${tool}.log`), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };

function scan(f, flags) {
  const out = join(f.dir, 'out');
  const r = spawnSync(process.execPath, [CLI, 'scan', '--manifest', f.manifest, '--root', f.root, '--out', out, ...flags],
    { encoding: 'utf8', env: cliEnv(f), timeout: 120_000 });
  let doc;
  try { doc = JSON.parse(readFileSync(join(out, 'scan.json'), 'utf8')); }
  catch (e) { assert.fail(`scan.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
  return { r, cells: doc.repos[0].cells, repoDir: join(out, doc.repos[0].slug) };
}

describe('the gate: a lane that builds the scanned tree needs consent on scan and brief', () => {
  test('without consent each bundled build lane is a void that says why, never a pass or a finding', () => {
    const m = baseline();
    withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined }, () => {
      for (const id of BUILD_LANES) {
        const v = buildLaneVoid(m.checks.find((c) => c.id === id), {});
        assert.ok(v, `${id} is not held without consent`);
        assert.equal(v.status, 'noscan');
        assert.equal(v.reason, 'builds repository code; pass --trust-repo-manifest (or --allow-build) to run it');
        assert.equal(v.reason, BUILD_CONSENT_REASON);
        assert.equal(v.coverage, 'unknown');
      }
    });
  });

  test('consent is --allow-build, --trust-repo-manifest or the trust env var, read at call time', () => {
    withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined }, () => {
      assert.equal(buildConsented({}), false);
      assert.equal(buildConsented({ allowBuild: true }), true);
      assert.equal(buildConsented({ trustRepoManifest: true }), true);
      // narrower: building does not extend to repo scripts or a repo-chosen DAST target
      assert.equal(repoTrusted({ allowBuild: true }), false);
    });
    withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: '1' }, () => assert.equal(buildConsented({}), true));
  });

  test('a whole-machine brief holds them even with every form of consent', () => {
    const m = baseline();
    withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: '1' }, () => {
      for (const id of BUILD_LANES) {
        const v = buildLaneVoid(m.checks.find((c) => c.id === id), { wholeMachine: true, allowBuild: true, trustRepoManifest: true });
        assert.equal(v && v.reason, BUILD_WHOLE_MACHINE_REASON, id);
        assert.equal(v.status, 'noscan');
      }
    });
  });

  test('a lane that does not build is never held', () => {
    const m = baseline();
    const held = m.checks.filter((c) => !buildsScannedTree(c) && buildLaneVoid(c, { wholeMachine: true }));
    assert.deepEqual(held.map((c) => c.id), []);
  });
});

describe('one predicate decides containment on run and consent on scan', () => {
  const contained = (m, repo) => containedVoids(m, groupMembers(m, 'all'), repo, {}).map((r) => r.id).sort();
  const held = (m) => m.checks.filter((c) => buildLaneVoid(c, {})).map((c) => c.id).sort();

  test('scan holds exactly the lanes run all contains', () => {
    const f = fixture();
    try {
      withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined }, () => {
        const m = baseline();
        assert.deepEqual(contained(m, f.repo), BUILD_LANES, 'precondition: run all contains the three on this fixture');
        assert.deepEqual(held(m), contained(m, f.repo));
      });
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('a lane whose command stops building is ordinary on both paths', () => {
    const f = fixture();
    try {
      withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined }, () => {
        const m = baseline();
        const go = m.checks.find((c) => c.id === 'sast-codeql-go');
        const before = go.local.join('\n');
        go.local = go.local.map((s) => s.replace(/--build-mode=manual --command="[^"]*"/, '--build-mode=none'));
        assert.notEqual(go.local.join('\n'), before, 'precondition: the mutation changed the command');
        assert.ok(!contained(m, f.repo).includes('sast-codeql-go'), 'run still contains it');
        assert.equal(buildLaneVoid(go, {}), null, 'scan still holds it');
      });
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  // The declared block is the documented half; the command is what both paths read. Dropping the
  // block alone fails closed here, and build-mode-containment's declared-vs-derived test fails.
  test('removing only the containment block changes neither path', () => {
    const f = fixture();
    try {
      withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined }, () => {
        const m = baseline();
        for (const c of m.checks) delete c.containment;
        assert.deepEqual(contained(m, f.repo), BUILD_LANES);
        assert.deepEqual(held(m), BUILD_LANES);
      });
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
});

describe('through the CLI, with the bundled lanes and stub tools', () => {
  test('scan without consent records all three as noscan with the reason and spawns none of them', () => {
    const f = fixture();
    try {
      const { r, cells, repoDir } = scan(f, []);
      for (const id of BUILD_LANES) {
        assert.equal(cells[id] && cells[id].sev, 'noscan', `${id}: ${JSON.stringify(cells[id])}\n${r.stdout}\n${r.stderr}`);
        assert.equal(cells[id].summary, BUILD_CONSENT_REASON, id);
        assert.equal(existsSync(join(repoDir, LANE_LOGS[id])), false, `${id} wrote its log, so it ran`);
      }
      for (const t of STUBS) assert.equal(stubCalls(f, t), '', `${t} was called without consent`);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  for (const flag of ['--allow-build', '--trust-repo-manifest']) {
    test(`scan with ${flag} runs them`, () => {
      const f = fixture();
      try {
        const { r, cells, repoDir } = scan(f, [flag]);
        const why = `${r.stdout}\n${r.stderr}`;
        for (const id of BUILD_LANES) {
          assert.ok(cells[id], `${id} has no cell\n${why}`);
          assert.notEqual(cells[id].summary, BUILD_CONSENT_REASON, id);
          assert.ok(existsSync(join(repoDir, LANE_LOGS[id])), `${id} wrote no log, so it did not run\n${JSON.stringify(cells[id])}\n${why}`);
        }
        assert.match(stubCalls(f, 'codeql'), /codeql\/swift-queries/, why);
        assert.match(stubCalls(f, 'codeql'), /codeql\/go-queries/, why);
        assert.match(stubCalls(f, 'cargo'), /^clippy /m, why);
      } finally { rmSync(f.dir, { recursive: true, force: true }); }
    });
  }

  test('brief --pc with consent still holds them, and says so', () => {
    const f = fixture();
    try {
      const out = join(f.dir, 'brief-out', 'run');
      const r = spawnSync(process.execPath, [CLI, 'brief', '--pc', '--allow-build', '--trust-repo-manifest', '--manifest', f.manifest, '--out', out],
        { encoding: 'utf8', timeout: 120_000,
          env: cliEnv(f, { COMMITWORK_TRUST_REPO_MANIFEST: '1', CW_SCAN_PATH_OUT: '', CW_SIDECAR: join(f.dir, 'sidecar'),
            CW_KEV_PATH: join(f.dir, 'no-kev.json'), CW_EPSS_PATH: join(f.dir, 'no-epss.json'), CW_NOW: '2026-10-08T00:00:00Z' }) });
      const why = `exit ${r.status}\n${r.stdout}\n${r.stderr}`;
      assert.equal(r.status, 0, why);
      const doc = JSON.parse(readFileSync(join(out, 'scan.json'), 'utf8'));
      assert.deepEqual(doc.repos.map((x) => x.repo), [f.repo], why);
      const { cells, slug } = doc.repos[0];
      for (const id of BUILD_LANES) {
        assert.equal(cells[id] && cells[id].sev, 'noscan', `${id}: ${JSON.stringify(cells[id])}\n${why}`);
        assert.equal(cells[id].summary, BUILD_WHOLE_MACHINE_REASON, id);
        assert.equal(existsSync(join(out, slug, LANE_LOGS[id])), false, `${id} ran under --pc`);
      }
      for (const t of STUBS) assert.equal(stubCalls(f, t), '', `${t} was called under --pc`);
      assert.match(r.stdout, /lanes that build a repository do not run on --pc/);
      const brief = JSON.parse(readFileSync(join(out, 'brief.json'), 'utf8'));
      assert.deepEqual(brief.notMeasured.filter((n) => BUILD_LANES.includes(n.check)).map((n) => `${n.check}:${n.kind}`).sort(),
        BUILD_LANES.map((id) => `${id}:void`), 'the brief lists them as not measured');
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
});
