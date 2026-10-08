// Untrusted by default, for content the scanned tree supplies to a BUNDLED manifest: a lane that
// runs a repo-supplied script (`requiresRepoTrust`) and the repo's own `commitwork.url` DAST target
// are both refused without --trust-repo-manifest. Asserted through the real runner on fixtures: the
// script's side effect is the witness that it did or did not run, not the row's status alone.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRepoUrl, repoTrusted, untrustedScriptVoid, UNTRUSTED_SCRIPT_REASON } from '../commitwork.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'bin', 'commitwork.mjs');

const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

// A tree that ships the script and a commitwork.url, and a manifest that runs the script and echoes
// the target URL it was handed.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-repo-trust-'));
  const root = join(dir, 'root'); const repo = join(root, 'tree');
  mkdirSync(join(repo, 'security'), { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'security', 'probe.sh'),
    'touch "$CW_REPORT_DIR/script-ran"\nprintf \'{"tool":"probe","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}\' > "$CW_REPORT_DIR/probe.json"\n');
  writeFileSync(join(repo, 'commitwork.url'), 'http://127.0.0.1:7878\n');
  const manifest = join(dir, 'm.json');
  writeFileSync(manifest, JSON.stringify({
    repo: 'fixture',
    groups: { probe: ['repo-script', 'target-echo'] },
    checks: [
      { id: 'repo-script', description: 'fixture: runs the tree\'s script', egress: 'none', executesRepoCode: true, requiresRepoTrust: true,
        appliesIfExists: ['security/probe.sh'], local: ['bash security/probe.sh'], report: { file: 'probe.json', format: 'rule-counts' }, groups: ['probe'] },
      { id: 'target-echo', description: 'fixture: records the DAST target it was given', egress: 'none', requiresUrl: true,
        local: ['printf %s "$CW_TARGET_URL" > "$CW_REPORT_DIR/target.txt"; printf \'{"tool":"t","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}\' > "$CW_REPORT_DIR/target.json"'],
        report: { file: 'target.json', format: 'rule-counts' }, groups: ['probe'] },
    ],
  }));
  return { dir, root, repo, manifest };
}

function cliEnv(extra = {}) {
  const env = { ...process.env, CW_SKIP_SETUP: '1', CW_DOCKER: 'false', CW_SCAN_CONFIG: '/nonexistent/cw-scan-config.json', ...extra };
  for (const k of ['COMMITWORK_TRUST_REPO_MANIFEST', 'CW_TARGET_URL', 'COMMITWORK_MANIFEST', 'COMMITWORK_REPO', 'CW_SANDBOX']) if (!(k in extra)) delete env[k];
  return env;
}

describe('requiresRepoTrust: a repo-supplied script runs only with --trust-repo-manifest', () => {
  test('the void says why, and is neither a pass nor a finding', () => {
    const v = untrustedScriptVoid({ id: 'x' });
    assert.equal(v.status, 'noscan');
    assert.equal(v.reason, 'repo-supplied script; pass --trust-repo-manifest to run it');
    assert.equal(v.reason, UNTRUSTED_SCRIPT_REASON);
    assert.equal(v.coverage, 'unknown');
  });

  test('trust is read from the flag or the env at call time', () => {
    withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined }, () => {
      assert.equal(repoTrusted({}), false);
      assert.equal(repoTrusted({ trustRepoManifest: true }), true);
    });
    withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: '1' }, () => assert.equal(repoTrusted({}), true));
  });

  for (const trusted of [false, true]) {
    test(`run: ${trusted ? 'with' : 'without'} the flag`, () => {
      const f = fixture();
      try {
        const reports = join(f.dir, 'reports'); mkdirSync(reports);
        const args = [CLI, 'run', 'repo-script', '--manifest', f.manifest, '--repo', f.repo, '--no-fail-fast', ...(trusted ? ['--trust-repo-manifest'] : [])];
        const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: cliEnv({ CW_REPORT_DIR: reports }) });
        let rows;
        try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
        catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
        const row = rows.find((x) => x.check === 'repo-script');
        assert.ok(row, JSON.stringify(rows));
        assert.equal(existsSync(join(reports, 'script-ran')), trusted, `${r.stdout}\n${r.stderr}`);
        if (trusted) assert.notEqual(row.status, 'noscan', JSON.stringify(row));
        else {
          assert.equal(row.status, 'noscan', JSON.stringify(row));
          assert.equal(row.reason, UNTRUSTED_SCRIPT_REASON);
        }
      } finally { rmSync(f.dir, { recursive: true, force: true }); }
    });
  }

  test('a tree without the script is n/a, not held', () => {
    const f = fixture();
    try {
      rmSync(join(f.repo, 'security'), { recursive: true });
      const reports = join(f.dir, 'reports'); mkdirSync(reports);
      spawnSync(process.execPath, [CLI, 'run', 'repo-script', '--manifest', f.manifest, '--repo', f.repo], { encoding: 'utf8', env: cliEnv({ CW_REPORT_DIR: reports }) });
      const row = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')).find((x) => x.check === 'repo-script');
      assert.notEqual(row.reason, UNTRUSTED_SCRIPT_REASON, JSON.stringify(row));
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('every bundled lane that runs a script from the tree declares requiresRepoTrust', () => {
    // A command that hands a repo-relative path to a shell, or executes one directly. Paths under
    // $CW_ROOT are commitwork's own scripts and are excluded.
    const repoScript = /(?:^|[;&|(]\s*|\b(?:bash|sh|zsh|source)\s+)(?:\.\/)?(?![$/~])[\w.-]+\/[\w./-]*\.(?:sh|bash|py|rb|pl)\b|(?:^|[;&|(\s])\.\/[\w.-]/;
    const missing = [];
    for (const f of readdirSync(join(ROOT, 'manifests')).filter((n) => n.endsWith('.json'))) {
      const doc = JSON.parse(readFileSync(join(ROOT, 'manifests', f), 'utf8'));
      for (const c of Array.isArray(doc.checks) ? doc.checks : []) {
        const cmd = (c.local || []).join('\n').replace(/"?\$CW_ROOT[^\s"]*"?/g, '');
        if (repoScript.test(cmd) && c.requiresRepoTrust !== true) missing.push(`${f}:${c.id}`);
      }
    }
    assert.deepEqual(missing, []);
    const sb = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
    assert.equal(sb.checks.find((c) => c.id === 'authz-test').requiresRepoTrust, true);
  });
});

describe('commitwork.url: the tree does not choose its own DAST target without trust', () => {
  test('ignored without the flag, said once, and the operator\'s --url still applies', () => {
    const f = fixture();
    try {
      const warned = [];
      const u = withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined, CW_TARGET_URL: undefined },
        () => resolveRepoUrl(f.repo, 'tree', {}, { url: 'https://staging.example' }, (m) => warned.push(m)));
      assert.equal(u, 'https://staging.example');
      assert.equal(warned.length, 1);
      assert.match(warned[0], /commitwork\.url ignored.*--trust-repo-manifest/);
      const none = withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined, CW_TARGET_URL: undefined },
        () => resolveRepoUrl(f.repo, 'tree', {}, {}, () => {}));
      assert.equal(none, '');
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  test('honoured with the flag; an operator map still wins; no file, no warning', () => {
    const f = fixture();
    try {
      const warned = [];
      const w = (m) => warned.push(m);
      withEnv({ COMMITWORK_TRUST_REPO_MANIFEST: undefined, CW_TARGET_URL: undefined }, () => {
        assert.equal(resolveRepoUrl(f.repo, 'tree', {}, { trustRepoManifest: true, url: 'https://x.example' }, w), 'http://127.0.0.1:7878');
        assert.equal(resolveRepoUrl(f.repo, 'tree', { tree: 'https://mapped.example' }, {}, w), 'https://mapped.example');
        rmSync(join(f.repo, 'commitwork.url'));
        assert.equal(resolveRepoUrl(f.repo, 'tree', {}, {}, w), '');
      });
      assert.deepEqual(warned, []);
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });

  for (const trusted of [false, true]) {
    test(`scan: ${trusted ? 'with' : 'without'} the flag, both gates end to end`, () => {
      const f = fixture();
      try {
        const out = join(f.dir, 'out');
        const args = [CLI, 'scan', '--manifest', f.manifest, '--root', f.root, '--out', out, ...(trusted ? ['--trust-repo-manifest'] : [])];
        const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: cliEnv() });
        let scan;
        try { scan = JSON.parse(readFileSync(join(out, 'scan.json'), 'utf8')); }
        catch (e) { assert.fail(`scan.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
        const cells = scan.repos[0].cells;
        const repoDir = join(out, scan.repos[0].slug);
        assert.equal(existsSync(join(repoDir, 'script-ran')), trusted, `${r.stdout}\n${r.stderr}`);
        const ignoredMsg = (r.stderr.match(/commitwork\.url ignored/g) || []).length;
        if (trusted) {
          assert.notEqual(cells['repo-script'].sev, 'noscan', JSON.stringify(cells['repo-script']));
          assert.equal(readFileSync(join(repoDir, 'target.txt'), 'utf8'), 'http://127.0.0.1:7878');
          assert.equal(ignoredMsg, 0);
        } else {
          assert.equal(cells['repo-script'].sev, 'noscan');
          assert.equal(cells['repo-script'].summary, UNTRUSTED_SCRIPT_REASON);
          assert.equal(existsSync(join(repoDir, 'target.txt')), false, 'no URL given, so the runtime lane must not run');
          assert.equal(cells['target-echo'].sev, 'noscan');
          assert.equal(ignoredMsg, 1, r.stderr);
        }
      } finally { rmSync(f.dir, { recursive: true, force: true }); }
    });
  }
});
