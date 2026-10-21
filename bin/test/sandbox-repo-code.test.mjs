// node --test bin/test/sandbox-repo-code.test.mjs
//
// Threat model R5: with no host sandbox, a lane that executes repository code is refused as noscan
// and its command never runs, unless the operator sets CW_SANDBOX=off. A lane that only analyses
// still runs unconfined and says so. The probe is made to fail by stub sandbox-exec and bwrap
// earlier on PATH, so both directions are measured on any POSIX host, including one whose real
// sandbox works.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runsRepoCode, buildsScannedTree, REPO_CODE_NO_SANDBOX_REASON, REPO_CODE_NO_EGRESS_REASON } from '../commitwork.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'bin', 'commitwork.mjs');
const skip = process.platform === 'win32' ? 'the stubs are POSIX sh; Windows has no host sandbox to make unavailable' : false;
const manifest = (name) => JSON.parse(readFileSync(join(ROOT, 'manifests', name), 'utf8'));

describe('runsRepoCode reads the declarations that already exist', () => {
  test('in the bundled manifests it is exactly executesRepoCode, requiresRepoTrust and buildsScannedTree', () => {
    const got = []; const want = [];
    for (const f of ['security-baseline.json', 'build-health.json', 'hermetic-tests.json']) {
      for (const c of manifest(f).checks || []) {
        if (runsRepoCode(c)) got.push(`${f}:${c.id}`);
        if (c.executesRepoCode === true || c.requiresRepoTrust === true || buildsScannedTree(c)) want.push(`${f}:${c.id}`);
      }
    }
    assert.deepEqual(got, want);
    for (const id of ['authz-test', 'sast-php-psalm', 'deps-reachability', 'lint-rust-clippy', 'sast-codeql-swift', 'sast-codeql-go']) {
      assert.ok(got.includes(`security-baseline.json:${id}`), `${id} is not held to the sandbox`);
    }
    const ids = new Set(manifest('security-baseline.json').checks.map((c) => c.id));
    for (const id of ['deps-retire', 'sbom', 'sast', 'secrets']) {
      assert.ok(ids.has(id), `${id} is no longer a bundled lane; pick another analyser`);
      assert.ok(!got.includes(`security-baseline.json:${id}`), `${id} only analyses, so it is not held`);
    }
  });

  test('each declaration counts on its own', () => {
    assert.equal(runsRepoCode({ executesRepoCode: true }), true);
    assert.equal(runsRepoCode({ requiresRepoTrust: true }), true);
    assert.equal(runsRepoCode({ local: ['cargo clippy --all-targets'] }), true);
    assert.equal(runsRepoCode({ local: ['semgrep scan .'] }), false);
    assert.equal(runsRepoCode({ executesRepoCode: false, local: ['true'] }), false);
    assert.equal(runsRepoCode(null), false);
  });
});

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cw-sandbox-repo-code-')));
  const root = join(dir, 'root'); const repo = join(root, 'tree'); const reports = join(dir, 'reports'); const stubs = join(dir, 'stubs');
  for (const d of [repo, reports, stubs]) mkdirSync(d, { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  for (const tool of ['sandbox-exec', 'bwrap']) {
    writeFileSync(join(stubs, tool), '#!/bin/sh\necho "stub: no sandbox here" >&2\nexit 1\n');
    chmodSync(join(stubs, tool), 0o755);
  }
  // The build lane's tool: it marks that it was called, so "never spawned" is a measurement.
  writeFileSync(join(stubs, 'cargo'), `#!/bin/sh\ntouch "$CW_REPORT_DIR/ran-build-lane"\n`);
  chmodSync(join(stubs, 'cargo'), 0o755);
  const emit = (id) => `printf '{"tool":"${id}","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}' > "$CW_REPORT_DIR/${id}.json"; echo 0 > "$CW_REPORT_DIR/${id}.json.exit"`;
  const lane = (id, extra, cmd = `touch "$CW_REPORT_DIR/ran-${id}"`) => ({
    id, description: `fixture: ${id}`, groups: ['probe'], local: [`${cmd}; ${emit(id)}`],
    report: { file: `${id}.json`, format: 'rule-counts' }, ...extra,
  });
  const checks = [
    lane('exec-lane', { executesRepoCode: true, egress: 'none' }),
    lane('trust-lane', { requiresRepoTrust: true, egress: 'none' }),
    lane('build-lane', { egress: 'none' }, 'cargo clippy --all-targets'),
    lane('bare-exec-lane', { executesRepoCode: true }),
    lane('analyser-lane', { egress: 'none' }),
  ];
  const m = join(dir, 'm.json');
  writeFileSync(m, JSON.stringify({ repo: 'fixture', groups: { probe: checks.map((c) => c.id) }, checks }));
  const env = (sandbox, extra = {}) => {
    const e = { ...process.env, PATH: `${stubs}${delimiter}${process.env.PATH}`, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1',
      CW_SELF_SWEEP: '0', CW_DOCKER: 'false', CW_SCAN_CONFIG: join(dir, 'none.json'), ...extra };
    for (const k of ['CW_SANDBOX', 'COMMITWORK_TRUST_REPO_MANIFEST', 'COMMITWORK_MANIFEST', 'COMMITWORK_REPO', 'CW_TARGET_URL']) delete e[k];
    if (sandbox) e.CW_SANDBOX = sandbox;
    return e;
  };
  const cli = (args, sandbox, extra) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: env(sandbox, extra), cwd: repo, timeout: 120_000 });
  const run = (sandbox) => {
    rmSync(reports, { recursive: true, force: true }); mkdirSync(reports);
    const r = cli(['run', 'probe', '--manifest', m, '--repo', repo, '--no-fail-fast', '--trust-repo-manifest'], sandbox);
    let rows;
    try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
    catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    return { r, rows: Object.fromEntries(rows.map((x) => [x.check, x])), ran: (id) => existsSync(join(reports, `ran-${id}`)) };
  };
  const scan = (sandbox) => {
    const out = join(dir, `scan-${sandbox || 'default'}`);
    const r = cli(['scan', '--manifest', m, '--root', root, '--out', out, '--allow-build', '--trust-repo-manifest'], sandbox, { CW_REPORT_DIR: '' });
    let doc;
    try { doc = JSON.parse(readFileSync(join(out, 'scan.json'), 'utf8')); }
    catch (e) { assert.fail(`scan.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    const { cells, slug } = doc.repos[0];
    return { r, cells, ran: (id) => existsSync(join(out, slug, `ran-${id}`)) };
  };
  return { dir, repo, m, cli, run, scan, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const HELD = ['exec-lane', 'trust-lane', 'build-lane'];

describe('with no host sandbox', { skip }, () => {
  test('run: each repository-code lane is noscan with the reason and never spawned; the analyser runs unconfined', () => {
    const fx = fixture();
    try {
      const { r, rows, ran } = fx.run(null);
      const why = `${r.stdout}\n${r.stderr}`;
      for (const id of HELD) {
        assert.equal(rows[id].status, 'noscan', `${id}: ${JSON.stringify(rows[id])}\n${why}`);
        assert.equal(rows[id].reason, REPO_CODE_NO_SANDBOX_REASON, id);
        assert.equal(rows[id].coverage, 'unknown', id);
        assert.equal(ran(id), false, `${id} ran with no sandbox`);
      }
      assert.equal(REPO_CODE_NO_SANDBOX_REASON, 'executes repository code and no sandbox is available; CW_SANDBOX=off runs it unconfined');
      assert.equal(rows['bare-exec-lane'].status, 'noscan');
      assert.equal(rows['bare-exec-lane'].reason, REPO_CODE_NO_EGRESS_REASON);
      assert.equal(ran('bare-exec-lane'), false, 'a repository-code lane with no egress class ran unconfined');
      assert.equal(ran('analyser-lane'), true, `the analyser did not run\n${why}`);
      assert.equal(rows['analyser-lane'].isolation, 'none');
      assert.match(rows['analyser-lane'].isolationReason, /host sandbox unavailable: .*stub: no sandbox here/);
      assert.match(r.stderr, /lanes that execute repository code are refused as noscan, the rest run unconfined/);
    } finally { fx.cleanup(); }
  });

  test('run with CW_SANDBOX=off: every lane runs, and a repository-code lane says its coverage is reduced', () => {
    const fx = fixture();
    try {
      const { r, rows, ran } = fx.run('off');
      for (const id of [...HELD, 'bare-exec-lane', 'analyser-lane']) {
        assert.equal(ran(id), true, `${id} did not run under CW_SANDBOX=off: ${JSON.stringify(rows[id])}\n${r.stdout}\n${r.stderr}`);
        assert.equal(rows[id].isolation, 'none', id);
      }
      assert.equal(rows['exec-lane'].coverage, 'reduced');
      assert.match(rows['exec-lane'].coverageReason, /ran unsandboxed/);
    } finally { fx.cleanup(); }
  });

  test('scan holds the same lanes, after consent, for the same reason', () => {
    const fx = fixture();
    try {
      const held = fx.scan(null);
      const why = `${held.r.stdout}\n${held.r.stderr}`;
      for (const id of HELD) {
        assert.equal(held.cells[id] && held.cells[id].sev, 'noscan', `${id}: ${JSON.stringify(held.cells[id])}\n${why}`);
        assert.equal(held.cells[id].summary, REPO_CODE_NO_SANDBOX_REASON, id);
        assert.equal(held.ran(id), false, `${id} ran on scan with no sandbox`);
      }
      assert.equal(held.ran('analyser-lane'), true, `the analyser did not run on scan\n${why}`);
      const off = fx.scan('off');
      for (const id of HELD) assert.equal(off.ran(id), true, `${id} did not run on scan under CW_SANDBOX=off: ${JSON.stringify(off.cells[id])}`);
    } finally { fx.cleanup(); }
  });

  test('doctor names the refused lanes, and what CW_SANDBOX=off does', () => {
    const fx = fixture();
    try {
      const plain = fx.cli(['doctor', '--manifest', fx.m, '--repo', fx.repo], null);
      assert.match(plain.stdout, /✗ host sandbox\s+\(\S+ exited 1: stub: no sandbox here\)/);
      assert.match(plain.stdout, /refused as noscan, they execute repository code \(CW_SANDBOX=off runs them\): exec-lane, trust-lane, build-lane, bare-exec-lane\n/);
      assert.match(plain.stdout, /other lanes run unconfined and each row records isolation: none/);
      const off = fx.cli(['doctor', '--manifest', fx.m, '--repo', fx.repo], 'off');
      assert.match(off.stdout, /CW_SANDBOX=off: every lane runs unconfined, repository-code lanes included/);
      assert.doesNotMatch(off.stdout, /refused as noscan/);
    } finally { fx.cleanup(); }
  });
});
