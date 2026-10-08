import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { applyIsolation, ISOLATION, UNSANDBOXED_REASON } from '../lib/isolation.mjs';
import { linkedGitDirs } from '../commitwork.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('an unsandboxed lane that executes repo code is reduced coverage, whatever it found', () => {
  for (const status of ['pass', 'fail']) {
    const r = applyIsolation({ id: 'x', status, isolation: 'none', coverage: 'full', coverageReason: null }, { executesRepoCode: true });
    assert.equal(r.status, status, 'isolation never moves status');
    assert.equal(r.coverage, 'reduced');
    assert.equal(r.coverageReason, UNSANDBOXED_REASON);
    assert.equal(r.coverageBasis, 'isolation');
  }
});

test('an existing reduction is kept and the isolation reason appended', () => {
  const r = applyIsolation({ isolation: 'none', coverage: 'reduced', coverageReason: 'go call analysis skipped' }, { executesRepoCode: true });
  assert.equal(r.coverageReason, `go call analysis skipped; ${UNSANDBOXED_REASON}`);
});

test('lanes that only read the tree, sandboxed lanes, and unknown coverage are untouched', () => {
  assert.deepEqual(applyIsolation({ isolation: 'none', coverage: 'full' }, { executesRepoCode: false }), { isolation: 'none', coverage: 'full' });
  assert.deepEqual(applyIsolation({ isolation: 'none', coverage: 'full' }, {}), { isolation: 'none', coverage: 'full' });
  assert.deepEqual(applyIsolation({ isolation: 'full', coverage: 'full' }, { executesRepoCode: true }), { isolation: 'full', coverage: 'full' });
  assert.equal(applyIsolation({ isolation: 'none', coverage: 'unknown' }, { executesRepoCode: true }).coverage, 'unknown');
  assert.equal(applyIsolation(null, { executesRepoCode: true }), null);
});

test('the vocabulary is closed', () => {
  assert.deepEqual([...ISOLATION], ['none', 'fs-only', 'full']);
  assert.ok(Object.isFrozen(ISOLATION));
});

// guard: the runner declares isolation, applies it, and writes it
test('the runner stamps every executed lane, applies the demotion, and writes the field to the wire', () => {
  const s = src('bin/commitwork.mjs');
  assert.match(s, /from '\.\/lib\/isolation\.mjs'/);
  // The fail row also carries a reason since 2026-10; the guard is about withIsolation wrapping
  // that return, not about the field list, so it tolerates fields after `cmd`.
  assert.match(s, /return withIsolation\(\{ id: check\.id, status: 'fail', cmd[^}]*\}, sb\);/);
  assert.match(s, /return withIsolation\(\{ id: check\.id, status: 'pass' \}, sb\);/);
  assert.match(s, /applyIsolation\(res, check\)/);
  assert.match(s, /\.\.\.\(r\.isolation \? \{ isolation: r\.isolation \} : \{\}\)/);
  assert.match(s, /\.\.\.\(r\.isolationReason \? \{ isolationReason: r\.isolationReason \} : \{\}\)/);
  assert.match(s, /'executesRepoCode'/);
  assert.match(src('schema/manifest.schema.json'), /"executesRepoCode":\s*\{\s*"type":\s*"boolean"/);
});

test('a linked worktree declares its gitdir and commondir as reads; a directory .git or none declares nothing', () => {
  const dir = realpathSync(mkdtempSync(resolve(tmpdir(), 'cw-gitdir-')));
  try {
    const main = resolve(dir, 'main', '.git'); mkdirSync(resolve(main, 'worktrees', 'wt'), { recursive: true });
    writeFileSync(resolve(main, 'worktrees', 'wt', 'commondir'), '../..\n');
    const wt = resolve(dir, 'wt'); mkdirSync(wt);
    writeFileSync(resolve(wt, '.git'), `gitdir: ${resolve(main, 'worktrees', 'wt')}\n`);
    assert.deepEqual(linkedGitDirs(wt), [resolve(main, 'worktrees', 'wt'), main]);
    const plain = resolve(dir, 'plain'); mkdirSync(resolve(plain, '.git'), { recursive: true });
    assert.deepEqual(linkedGitDirs(plain), []);
    assert.deepEqual(linkedGitDirs(resolve(dir, 'absent')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the host wrapper is applied through runShell on both spawn paths, and its absence is written', () => {
  const s = src('bin/commitwork.mjs');
  assert.match(s, /argv = hostSandboxArgv\(\{ \.\.\.bound\.sandbox, cmd \}\)\.argv/);
  assert.match(s, /spawnSync\(argv\[0\], argv\.slice\(1\)/);
  assert.match(s, /hostSandboxFor\(check, repoPath, process\.env\.CW_REPORT_DIR, cargo\.writes\)/, 'the run path decides the wrapper, with the lane\'s own cargo folder writable');
  assert.match(s, /hostSandboxFor\(check, repo, repoDir, cargo\.writes, \{ CW_TARGET_URL: repoUrl, CW_OPENAPI: openapiFile, CW_TLS_URL: process\.env\.CW_TLS_URL \}\)/, 'the scan path decides the wrapper, with the lane\'s own cargo folder writable and its own target URLs');
  assert.match(s, /CW_SANDBOX=off: host sandbox disabled by the operator/);
  assert.match(s, /host sandbox unavailable: \$\{probe\.why\}/);
  assert.match(s, /check declares no egress class; ran unconfined/);
  assert.match(s, /preflightHostSandbox\(wrap\)/);
});

// guard: the demotion is visible on the wire, from a fixture manifest through the real runner
test('a fixture run: an executing lane with no egress class runs unconfined and reports reduced coverage; a read-only lane is untouched; a declared class is confined where the host sandbox exists', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(resolve(tmpdir(), 'cw-isolation-cli-'));
  const repo = resolve(dir, 'repo'); const reports = resolve(dir, 'reports');
  mkdirSync(repo); mkdirSync(reports);
  const emit = (name) => `printf '{"tool":"${name}","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}' > "$CW_REPORT_DIR/${name}.json"; echo 0 > "$CW_REPORT_DIR/${name}.json.exit"`;
  const manifest = resolve(dir, 'm.json');
  writeFileSync(manifest, JSON.stringify({
    repo: 'fixture',
    groups: { probe: ['exec-lane', 'read-lane', 'declared-lane'] },
    checks: [
      { id: 'exec-lane', description: 'fixture: executes repo code, declares no egress', local: [emit('exec-lane')], report: { file: 'exec-lane.json', format: 'rule-counts' }, groups: ['probe'], executesRepoCode: true },
      { id: 'read-lane', description: 'fixture: reads the tree, declares no egress', local: [emit('read-lane')], report: { file: 'read-lane.json', format: 'rule-counts' }, groups: ['probe'] },
      { id: 'declared-lane', description: 'fixture: executes repo code under egress none', local: [emit('declared-lane')], report: { file: 'declared-lane.json', format: 'rule-counts' }, groups: ['probe'], executesRepoCode: true, egress: 'none' },
    ],
  }));
  const env = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_DOCKER: 'false' }; // no container to reap: docker is a fake that exits 1
  delete env.CW_SANDBOX;
  const r = spawnSync('node', [resolve(ROOT, 'bin', 'commitwork.mjs'), 'run', 'probe', '--manifest', manifest, '--repo', repo, '--no-fail-fast'], { encoding: 'utf8', env });
  let rows;
  try { rows = JSON.parse(readFileSync(resolve(reports, 'checks-status.json'), 'utf8')); }
  catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); runner exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
  const row = Object.fromEntries(rows.map((x) => [x.check, x]));
  assert.equal(row['exec-lane'].isolation, 'none');
  assert.match(row['exec-lane'].isolationReason, /declares no egress class/);
  assert.equal(row['exec-lane'].coverage, 'reduced', JSON.stringify(row['exec-lane']));
  assert.equal(row['exec-lane'].coverageBasis, 'isolation');
  assert.match(row['exec-lane'].coverageReason, /ran unsandboxed/);
  assert.equal(row['read-lane'].isolation, 'none');
  assert.notEqual(row['read-lane'].coverage, 'reduced', JSON.stringify(row['read-lane']));
  const d = row['declared-lane'];
  if (d.isolation === 'none') {
    assert.ok(d.isolationReason, 'an unconfined declared lane must say why');
    assert.equal(d.coverage, 'reduced', JSON.stringify(d));
  } else {
    assert.equal(d.isolation, 'full', JSON.stringify(d));
    assert.notEqual(d.coverage, 'reduced', 'confined, so the demotion must not fire');
  }
  rmSync(dir, { recursive: true, force: true });
});
