// run_checks makes one report directory per call and must not leave it behind. trust-boundary.test
// is non-executing by charter, so the one call here that reaches the runner lives in its own file:
// quality-gates/boot-pass against an empty repo skips its single check in under a second and still
// writes checks-status.json, which is exactly the path the cleanup sits on.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO, 'mcp', 'server.mjs');

function call(name, args, env) {
  const out = execFileSync(process.execPath, [SERVER], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024, env,
  });
  for (const line of out.split('\n').filter(Boolean)) {
    try {
      const m = JSON.parse(line);
      if (m.id === 1) return { isError: !!m.result?.isError, text: m.result?.content?.[0]?.text ?? '', error: m.error };
    } catch { /* not a frame */ }
  }
  throw new Error(`no response frame: ${out.slice(0, 300)}`);
}

// A fresh root per call: an inherited CW_REPORT_DIR would put the per-call directory somewhere a
// concurrent test could also be writing, and a shared tmpdir would let a stale cw-mcp-* from
// another run satisfy the "kept" assertion.
function withRoot(fn) {
  const base = mkdtempSync(join(tmpdir(), 'cw-mcp-root-'));
  const root = join(base, 'reports');
  const repo = join(base, 'repo');
  mkdirSync(repo);
  // run_checks takes only the top of a git work tree (review 2026-10-07 D7)
  execFileSync('git', ['init', '-q', repo]);
  try { return fn({ root, repo: realpathSync(repo) }); } finally { rmSync(base, { recursive: true, force: true }); }
}

const baseEnv = () => { const e = { ...process.env }; delete e.CW_KEEP_REPORTS; delete e.CW_REPORT_DIR; return e; };

describe('run_checks report directory', () => {
  test('is created under CW_REPORT_DIR and removed after the report is read', () => {
    withRoot(({ root, repo }) => {
      const r = call('run_checks', { repo, manifest: 'quality-gates', group: 'boot-pass' }, { ...baseEnv(), CW_REPORT_DIR: root });
      assert.equal(r.isError, false, r.text);
      const res = JSON.parse(r.text);
      assert.equal(res.checkCount, 1, 'the runner must have run and written checks-status.json, or the cleanup path was never reached');
      assert.deepEqual(res.skipped, ['qg-boot-test-pass']);
      assert.ok(res.reports.dir.startsWith(root + '/cw-mcp-'), `report dir ${res.reports.dir} is not under the CW_REPORT_DIR root`);
      assert.equal(res.reports.kept, false);
      assert.equal(res.reports.removed, true);
      assert.equal(res.reports.why, undefined);
      assert.equal(existsSync(res.reports.dir), false, 'the report dir is still on disk');
      assert.deepEqual(readdirSync(root), [], 'the root should hold nothing after cleanup');
    });
  });

  test('is kept, and the response says so and where, under CW_KEEP_REPORTS=1', () => {
    withRoot(({ root, repo }) => {
      const r = call('run_checks', { repo, manifest: 'quality-gates', group: 'boot-pass' }, { ...baseEnv(), CW_REPORT_DIR: root, CW_KEEP_REPORTS: '1' });
      assert.equal(r.isError, false, r.text);
      const res = JSON.parse(r.text);
      assert.equal(res.checkCount, 1);
      assert.equal(res.reports.kept, true);
      assert.equal(res.reports.removed, false);
      assert.equal(res.reports.why, 'CW_KEEP_REPORTS=1');
      assert.ok(existsSync(join(res.reports.dir, 'checks-status.json')), `kept dir ${res.reports.dir} has no checks-status.json`);
      assert.deepEqual(readdirSync(root).length, 1, 'exactly the one kept directory remains under the root');
    });
  });

  test('CW_KEEP_REPORTS is read at call time: any value but "1" removes', () => {
    withRoot(({ root, repo }) => {
      const r = call('run_checks', { repo, manifest: 'quality-gates', group: 'boot-pass' }, { ...baseEnv(), CW_REPORT_DIR: root, CW_KEEP_REPORTS: 'yes' });
      const res = JSON.parse(r.text);
      assert.equal(res.reports.kept, false);
      assert.equal(res.reports.removed, true);
      assert.deepEqual(readdirSync(root), []);
    });
  });
});
