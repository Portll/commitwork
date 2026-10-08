// F1: the scheduled `run` path is honest about provenance. Pins: (1) classifyReport downgrades an
// exit-0 pass with an empty/missing report to `noscan`; (2) `run` records `skip` for an absent
// appliesIfExists file and `noscan` for an applicable check with an empty report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { classifyReport } from '../commitwork.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'commitwork.mjs');

// ── unit: the shared classifier ──────────────────────────────────────────────
test('classifyReport: a present report with findings keeps its severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f1-'));
  writeFileSync(join(dir, 'gitleaks.json'), JSON.stringify([{ RuleID: 'x', File: 'a', StartLine: 1 }]));
  const r = classifyReport({ id: 'g', report: { file: 'gitleaks.json', format: 'gitleaks' } }, dir, dir);
  assert.equal(r.sev, 'high');
});

test('classifyReport: an exit-0 check with a MISSING report is noscan, not ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f1-'));
  const r = classifyReport({ id: 'a', report: { file: 'authz.json', format: 'generic' } }, dir, dir);
  assert.equal(r.sev, 'noscan');
  assert.match(r.summary, /no output/);
});

test('classifyReport: a genuinely clean report with content is ok, not noscan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f1-'));
  writeFileSync(join(dir, 'gitleaks.json'), '[]');
  // An empty array is what a clean run writes AND what a run killed on its first syscall writes,
  // so gitleaks' own statement of work is required before the empty path is believed — the same
  // receipt rule trufflehog carries. Writing the sidecar is what makes this fixture CLEAN rather
  // than merely empty, which is the distinction this test is asserting. Direction pinned both ways
  // in bin/test/parse-report.test.mjs.
  writeFileSync(join(dir, 'gitleaks.log'), '9:41PM INF scanned ~1048576 bytes (1.00 MB) in 90ms\n');
  const r = classifyReport({ id: 'g', report: { file: 'gitleaks.json', format: 'gitleaks' } }, dir, dir);
  assert.equal(r.sev, 'ok');
});

// ── integration: the real `run` CLI records honest status ────────────────────
// Two checks against a repo LACKING the appliesIfExists file: needs-file must be `skip`,
// empty-report must be `noscan`.
function runManifest() {
  const T = mkdtempSync(join(tmpdir(), 'f1-run-'));
  const repo = join(T, 'repo'); mkdirSync(repo);
  const reportDir = join(T, 'reports'); mkdirSync(reportDir);
  const manifest = {
    repo: 'fixture', repoPath: repo,
    groups: { all: ['needs-file', 'empty-report'] },
    checks: [
      { id: 'needs-file', appliesIfExists: ['security/does-not-exist.sh'],
        local: ['true'], report: { file: 'nf.json', format: 'generic' } },
      { id: 'empty-report',
        local: ['true'], report: { file: 'er.json', format: 'generic' } },
    ],
  };
  const mfPath = join(T, 'manifest.json');
  writeFileSync(mfPath, JSON.stringify(manifest));
  const r = spawnSync('node', [CLI, 'run', 'all', '--manifest', mfPath, '--repo', repo], {
    encoding: 'utf8',
    env: { ...process.env, CW_REPORT_DIR: reportDir, COMMITWORK_TRUST_REPO_MANIFEST: '1' },
  });
  const status = JSON.parse(readFileSync(join(reportDir, 'checks-status.json'), 'utf8'));
  return { r, status };
}

test('run: a check whose appliesIfExists file is absent records skip, not pass', () => {
  const { status } = runManifest();
  const nf = status.find((s) => s.check === 'needs-file');
  assert.ok(nf, 'needs-file must appear in checks-status.json');
  assert.equal(nf.status, 'skip', `expected skip (n/a), got ${nf.status}`);
  assert.notEqual(nf.status, 'pass');
});

test('run: an applicable check that produces an empty report records noscan, not pass', () => {
  const { status } = runManifest();
  const er = status.find((s) => s.check === 'empty-report');
  assert.ok(er, 'empty-report must appear in checks-status.json');
  assert.equal(er.status, 'noscan', `expected noscan (void), got ${er.status}`);
  assert.notEqual(er.status, 'pass');
});

// ── appliesIfSourceExt: the gate is the SOURCES, never a build-manifest proxy ─────────────────
function runSourceExtManifest() {
  const T = mkdtempSync(join(tmpdir(), 'f1-srcext-'));
  const repo = join(T, 'repo');
  // the JS lives DEEP and with no package.json anywhere — the exact shape the old proxy missed
  mkdirSync(join(repo, 'server', 'lib'), { recursive: true });
  writeFileSync(join(repo, 'server', 'lib', 'app.mjs'), 'export const x = 1;\n');
  // decoy: vendored JS must not satisfy the gate on a repo with no real sources
  const repo2 = join(T, 'repo2'); mkdirSync(join(repo2, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(repo2, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  const reportDir = join(T, 'reports'); mkdirSync(reportDir);
  const reportDir2 = join(T, 'reports2'); mkdirSync(reportDir2);
  const manifest = (rp) => ({
    repo: 'fixture', repoPath: rp,
    groups: { all: ['wants-js'] },
    checks: [{ id: 'wants-js', appliesIfSourceExt: ['.js', '.mjs', '.ts'],
      local: ['sh -c "echo [] > \\"$CW_REPORT_DIR/wj.json\\""'], report: { file: 'wj.json', format: 'json' } }],
  });
  const run = (rp, rd) => {
    const mfPath = join(T, `manifest-${rd === reportDir ? 'a' : 'b'}.json`);
    writeFileSync(mfPath, JSON.stringify(manifest(rp)));
    spawnSync('node', [CLI, 'run', 'all', '--manifest', mfPath, '--repo', rp], {
      encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: rd, COMMITWORK_TRUST_REPO_MANIFEST: '1' } });
    return JSON.parse(readFileSync(join(rd, 'checks-status.json'), 'utf8'));
  };
  return { deepJs: run(repo, reportDir), vendoredOnly: run(repo2, reportDir2) };
}

test('run: appliesIfSourceExt finds deep sources with no build manifest — the check RUNS', () => {
  const { deepJs } = runSourceExtManifest();
  const wj = deepJs.find((s) => s.check === 'wants-js');
  assert.ok(wj, 'wants-js must appear in checks-status.json');
  assert.notEqual(wj.status, 'skip', 'a repo with real .mjs sources must not read as n/a');
});

test('run: vendored-only JS does not satisfy appliesIfSourceExt — the check is skip (n/a)', () => {
  const { vendoredOnly } = runSourceExtManifest();
  const wj = vendoredOnly.find((s) => s.check === 'wants-js');
  assert.equal(wj.status, 'skip', 'node_modules must not make a repo read as a JS project');
  assert.match(wj.reason || '', /no .*sources found/);
});
