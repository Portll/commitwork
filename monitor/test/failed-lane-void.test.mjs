// node --test monitor/test/failed-lane-void.test.mjs — a lane that fails before writing its report
// is a void at every layer: the extractor, the runner's coverage and the rollup's per-repo reasons.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCANNER_SPECS } from '../extractors.mjs';
import { laneCoverage } from '../../bin/commitwork.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

const withDir = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-failed-lane-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};
const rustAudit = SCANNER_SPECS.find(([k]) => k === 'depsRustAudit')[2];

describe('extractor: an empty artifact is read with its exit sidecar', () => {
  test('empty cargo-audit.json beside exit 127 is toolfailed, never no-subject', () => withDir((d) => {
    writeFileSync(join(d, 'cargo-audit.json'), '');
    writeFileSync(join(d, 'cargo-audit.json.exit'), '127\n');
    const c = rustAudit(d);
    assert.equal(c.toolfailed, true);
    assert.equal(c.nosrc, undefined);
  }));

  test('empty artifact with exit 0, exit 1 or no sidecar stays nosrc', () => {
    for (const exit of ['0', '1', null]) {
      withDir((d) => {
        writeFileSync(join(d, 'cargo-audit.json'), '');
        if (exit !== null) writeFileSync(join(d, 'cargo-audit.json.exit'), exit);
        const c = rustAudit(d);
        assert.equal(c.nosrc, true, `exit ${exit}`);
        assert.equal(c.toolfailed, undefined, `exit ${exit}`);
      });
    }
  });
});

describe('runner: coverage of a lane that wrote nothing', () => {
  const check = { id: 'sast-codeql-python', report: { file: 'codeql-python.sarif', format: 'sarif' } };

  test('no report and no exit sidecar is unknown coverage', () => withDir((d) => {
    const r = laneCoverage(check, d);
    assert.equal(r.coverage, 'unknown');
    assert.equal(r.coverageBasis, 'report-absent');
  }));

  test('an exit sidecar alone is still read by its code', () => withDir((d) => {
    writeFileSync(join(d, 'codeql-python.sarif.exit'), '2');
    assert.equal(laneCoverage(check, d).coverage, 'reduced');
  }));
});

describe('rollup: a fail with no report is listed as a void', () => {
  const REPOS = ['nosarif', 'marked', 'findings'];
  const AT = '2026-09-13T19:58:08.898Z';
  const root = mkdtempSync(join(tmpdir(), 'cw-failed-lane-rollup-'));
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: 'area', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'area', label: 'area', out: 'area', primary: true, members: REPOS }] };
  writeFileSync(join(root, 'projects.json'), JSON.stringify(reg));
  mkdirSync(join(root, 'reports', 'area'), { recursive: true });
  const batch = join(root, 'reports', 'sweep-20260913181517-area');
  for (const n of REPOS) mkdirSync(join(batch, n), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260913181517', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'area', areaOut: 'reports/area', startedAt: AT,
    scope: { repos: REPOS.map((n) => ({ name: n, manifests: ['security-baseline'] })), excluded: [], lifecycle: {} },
    anchors: {},
  }));
  const failRow = (extra = {}) => [{ check: 'sast-codeql-python', status: 'fail', durationMs: 30, at: AT, coverage: 'full', coverageReason: null, ...extra }];
  // the 2026-09-13 shape: fail, coverage full, no sarif, no log, no noReport field
  writeFileSync(join(batch, 'nosarif', 'checks-status.json'), JSON.stringify(failRow()));
  writeFileSync(join(batch, 'marked', 'checks-status.json'), JSON.stringify(failRow({ noReport: true, reason: 'exited non-zero and wrote no codeql-python.sarif — nothing was scanned' })));
  writeFileSync(join(batch, 'findings', 'checks-status.json'), JSON.stringify(failRow()));
  writeFileSync(join(batch, 'findings', 'codeql-python.sarif'), JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', rules: [{ id: 'py/command-line-injection' }] } },
    results: [{ ruleId: 'py/command-line-injection', level: 'error', message: { text: 'x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'app.py' }, region: { startLine: 7 } } }] }] }] }));

  const run = (manifest) => spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, batch], {
    cwd: CW, encoding: 'utf8',
    env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: join(root, 'projects.json'), CW_MONITOR_OUT: '', ...(manifest ? { CW_BASELINE_MANIFEST: manifest } : {}) },
  });
  const repo = (n) => JSON.parse(readFileSync(join(root, 'reports', 'area', 'rollup.json'), 'utf8')).repos.find((r) => r.name === n);
  const voidFor = (n) => (repo(n).noscanReasons || []).find((v) => v.check === 'sast-codeql-python');

  test('the rollup runs', () => {
    const r = run();
    assert.equal(r.status, 0, (r.stderr || '').slice(0, 800));
  });

  test('a pre-noReport fail row with no sarif on disk is a void with a reason', () => {
    const v = voidFor('nosarif');
    assert.ok(v, 'the failed lane is absent from noscanReasons');
    assert.match(v.reason, /wrote no report/);
    assert.equal(repo('nosarif').noscan, 1);
  });

  test('a noReport row carries the runner`s own reason', () => {
    assert.match(voidFor('marked').reason, /wrote no codeql-python\.sarif/);
  });

  test('a fail that wrote its report is a result, not a void', () => {
    assert.equal(voidFor('findings'), undefined);
    assert.equal(repo('findings').noscan || 0, 0);
  });

  test('with the manifest unreadable, noReport still counts and nothing else is guessed', () => {
    const r = run(join(root, 'absent-manifest.json'));
    assert.equal(r.status, 0, (r.stderr || '').slice(0, 800));
    assert.match(r.stderr, /unreadable/);
    assert.ok(voidFor('marked'));
    assert.equal(voidFor('nosarif'), undefined);
  });
});
