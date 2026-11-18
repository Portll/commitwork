// node --test monitor/test/rollup-index-tables.test.mjs — a batch index.md holds the check grid AND,
// whenever any check voided, a second table (## Coverage voids, bin/commitwork.mjs writeIndex) whose
// rows also start with a repo. Only the grid names the batch's repos.
//
// Measured on the 2026-10-21 repo-a batch: the rollup read the voids table's header as a repo named
// `Repo` and each repository's row as that repository a second time, so every scanner finding was extracted twice —
// 14 CodeQL rows for 7 results, 364 taint-lane findings for 182.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

test('the Coverage voids table never adds a repo, and a repo in both tables is rolled up once', () => {
  // Arrange — the shape writeIndex writes: title, grid, legend, then the voids table
  const root = mkdtempSync(join(tmpdir(), 'cw-index-tables-'));
  try {
    const reg = { reportsRoot: join(root, 'reports'), monitorOutput: 'area', defaultManifest: 'security-baseline',
      roots: [], projects: [], areas: [{ slug: 'area', label: 'area', out: 'area', primary: true, members: ['repo-a'] }] };
    writeFileSync(join(root, 'projects.json'), JSON.stringify(reg));
    mkdirSync(join(root, 'reports', 'area'), { recursive: true });
    const batch = join(root, 'reports', 'sweep-20261021023009-area');
    mkdirSync(join(batch, 'repo-a'), { recursive: true });
    writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
      sliceId: 'sweep-20261021023009', kind: 'sweep', group: 'all', only: null, sweptAll: false,
      area: 'area', areaOut: 'reports/area', startedAt: '2026-10-21T02:30:09.000Z',
      scope: { repos: [{ name: 'repo-a', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} }, anchors: {},
    }));
    writeFileSync(join(batch, 'index.md'), [
      '# Security scan — security-baseline (portable)', '',
      '1 repos · baseline checks: sast-codeql, sast-opengrep', '',
      '| Repo | sast-codeql | sast-opengrep |',
      '|---|---|---|',
      '| [repo-a](repo-a/summary.md) | 🟡 1 (0e/1w) | ⬜ no output (tool absent/failed) |', '',
      '🔴 high · 🟡 findings · 🟢 clean · ⬜ in-scope but no output (void) · – not applicable', '',
      '## Coverage voids', '',
      '1 in-scope check(s) produced no output (⬜) across 1 repo(s).', '',
      '| Repo | Voided / skipped checks |',
      '|---|---|',
      '| [repo-a](repo-a/summary.md) | sast-opengrep (tool:opengrep) |', '',
    ].join('\n'));
    writeFileSync(join(batch, 'repo-a', 'checks-status.json'), JSON.stringify([
      { check: 'sast-codeql', status: 'pass', durationMs: 30, at: '2026-10-21T02:30:09.000Z', coverage: 'full', coverageReason: null }]));
    writeFileSync(join(batch, 'repo-a', 'codeql.sarif'), JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', rules: [{ id: 'js/xss' }] } },
      results: [{ ruleId: 'js/xss', level: 'error', message: { text: 'x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 7 } } }] }] }] }));
    const out = join(root, 'reports', 'area');

    // Act
    const r = spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, batch], {
      cwd: CW, encoding: 'utf8',
      env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: join(root, 'projects.json'), CW_MONITOR_OUT: '' },
    });

    // Assert
    assert.equal(r.status, 0, (r.stderr || '').slice(0, 800));
    const rollup = JSON.parse(readFileSync(join(out, 'rollup.json'), 'utf8'));
    assert.deepEqual(rollup.repos.map((x) => x.name), ['repo-a'], 'the voids table\'s header is not a repo, and its rows are not a second copy');
    assert.equal(rollup.scannerFindings.sastCodeql.length, 1, 'one SARIF result is one finding');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
