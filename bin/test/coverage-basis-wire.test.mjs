import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'bin', 'commitwork.mjs');

const emit = (name, rc) => `printf '{"tool":"${name}","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}' > "$CW_REPORT_DIR/${name}.json"; echo ${rc} > "$CW_REPORT_DIR/${name}.json.exit"`;
const lane = (id, rc) => ({ id, description: `fixture: exits ${rc}`, local: [emit(id, rc)], report: { file: `${id}.json`, format: 'rule-counts' }, groups: ['probe'] });

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cw-covbasis-')));
  const home = join(dir, 'home');
  const root = join(home, 'src');
  const repo = join(root, 'tree');
  mkdirSync(repo, { recursive: true });
  spawnSync('git', ['init', '-q', repo]);
  const manifest = join(dir, 'm.json');
  writeFileSync(manifest, JSON.stringify({ repo: 'fixture', groups: { probe: ['clean-lane', 'broken-lane'] }, checks: [lane('clean-lane', 0), lane('broken-lane', 2)] }));
  return { dir, home, root, repo, manifest };
}

const cliEnv = (f, extra) => {
  const env = { ...process.env, HOME: f.home, CW_SKIP_SETUP: '1', CW_SELF_SWEEP: '0', CW_DOCKER: 'false', CW_SCAN_CONFIG: join(f.dir, 'none.json'), ...extra };
  for (const k of ['COMMITWORK_TRUST_REPO_MANIFEST', 'CW_TARGET_URL', 'COMMITWORK_MANIFEST', 'COMMITWORK_REPO', 'CW_SANDBOX']) delete env[k];
  return env;
};

test('run: a row reduced by its exit code says so in coverageBasis, and a full row says none', () => {
  const f = fixture();
  try {
    const reports = join(f.dir, 'reports'); mkdirSync(reports);
    const r = spawnSync(process.execPath, [CLI, 'run', 'probe', '--manifest', f.manifest, '--repo', f.repo, '--no-fail-fast'],
      { encoding: 'utf8', env: cliEnv(f, { CW_REPORT_DIR: reports }), timeout: 120_000 });
    let rows;
    try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
    catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    const row = Object.fromEntries(rows.map((x) => [x.check, x]));
    assert.equal(row['broken-lane'].coverage, 'reduced', JSON.stringify(row['broken-lane']));
    assert.equal(row['broken-lane'].coverageBasis, 'exit-code');
    assert.equal(row['clean-lane'].coverage, 'full', JSON.stringify(row['clean-lane']));
    assert.equal(row['clean-lane'].coverageBasis, 'none');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('scan: a cell reduced by its exit code says so in coverageBasis, and a full cell says none', () => {
  const f = fixture();
  try {
    const out = join(f.dir, 'out');
    const r = spawnSync(process.execPath, [CLI, 'scan', '--manifest', f.manifest, '--root', f.root, '--out', out],
      { encoding: 'utf8', env: cliEnv(f, {}), timeout: 120_000 });
    let doc;
    try { doc = JSON.parse(readFileSync(join(out, 'scan.json'), 'utf8')); }
    catch (e) { assert.fail(`scan.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    const cells = doc.repos[0].cells;
    assert.equal(cells['broken-lane'].coverage, 'reduced', JSON.stringify(cells['broken-lane']));
    assert.equal(cells['broken-lane'].coverageBasis, 'exit-code');
    assert.equal(cells['clean-lane'].coverage, 'full', JSON.stringify(cells['clean-lane']));
    assert.equal(cells['clean-lane'].coverageBasis, 'none');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
