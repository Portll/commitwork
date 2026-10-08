// Does a CodeQL lane that read only PART of its language still publish as a clean zero?
//
// This is the consumption half of monitor/codeql-coverage.mjs. The guard itself was landed with 13
// unit tests, and then set a field — `scanners[key].coverage` — that nothing read. A marker set with
// nothing obeying it is the exact class the guard was built to close, so it is worth stating plainly
// what this file asserts: not that the flag is SET, but that a partial lane CHANGES THE PUBLISHED
// ROLLUP. If `agg.coverage` did not move, the guard would be decoration.
//
// Every case is a PAIR differing in one fact — the SARIF's extraction notifications — so a test that
// only fed a healthy artifact could not pass while proving nothing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');

/** A CodeQL SARIF carrying nothing but the extraction notifications the guard reads. */
function codeqlSarif({ extracted, expected, results = [] }) {
  const note = (id, uri) => ({
    descriptor: { id },
    locations: [{ physicalLocation: { artifactLocation: { uri } } }],
  });
  return JSON.stringify({
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'CodeQL', rules: [{ id: 'cpp/uninitialized-local' }] } },
      invocations: [{
        executionSuccessful: true,
        toolExecutionNotifications: [
          ...extracted.map((u) => note('cpp/diagnostics/successfully-extracted-files', u)),
          ...expected.map((u) => note('cpp/baseline/expected-extracted-files', u)),
        ],
      }],
      results,
    }],
  });
}

function fixture({ sarif }) {
  const root = mkdtempSync(join(tmpdir(), 'cw-cqcov-'));
  const areas = [{ slug: 'a1', label: 'a1', out: 'a1', primary: true }];
  const reg = {
    reportsRoot: join(root, 'reports'), monitorOutput: 'a1',
    defaultManifest: 'security-baseline', roots: [], projects: [], areas,
  };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  mkdirSync(join(root, 'reports', 'a1'), { recursive: true });

  const batch = join(root, 'reports', 'sweep-20260801120000-a1');
  mkdirSync(batch, { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260801120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    startedAt: '2026-08-01T12:00:00.000Z', area: 'a1', areaOut: 'reports/a1',
    scope: { repos: [{ name: 'a1', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
    anchors: {},
  }));
  const d = join(batch, 'a1');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'codeql-cpp.sarif'), sarif);
  // The runner recorded a clean PASS and carried no coverage opinion of its own — which is the
  // case that matters: without the artifact-derived source, this repo counts as covered by default.
  writeFileSync(join(d, 'checks-status.json'), JSON.stringify(
    [{ check: 'sast-codeql-cpp', status: 'pass', durationMs: 5, at: '2026-08-01T12:00:01.000Z' }]));
  return { root, batch, regPath };
}

function rollupOf(fx) {
  const r = spawnSync(process.execPath, [ROLLUP, fx.batch], {
    cwd: CW, encoding: 'utf8',
    env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: fx.regPath, CW_MONITOR_OUT: '' },
  });
  assert.equal(r.status, 0, `rollup failed:\n${r.stderr || r.stdout}`);
  const out = join(fx.root, 'reports', 'a1', 'rollup.json');
  return JSON.parse(readFileSync(out, 'utf8'));
}

const CPP = (n, pre = 'src/f') => Array.from({ length: n }, (_, i) => `${pre}${i}.cpp`);

describe('a partial CodeQL lane cannot publish a clean zero', () => {
  test('the fully-extracted twin publishes coverage `full`', () => {
    const files = CPP(10);
    const fx = fixture({ sarif: codeqlSarif({ extracted: files, expected: files }) });
    const agg = rollupOf(fx).scanners?.sastCodeqlCpp;
    assert.ok(agg, 'sastCodeqlCpp missing from rollup.scanners');
    assert.equal(agg.total, 0, 'this fixture plants no findings — the zero is the point');
    assert.equal(agg.coverage, 'full');
    assert.deepEqual(agg.coverageChecks, { full: 1, reduced: 0, unknown: 0 });
  });

  test('the SAME zero, with 3 of 10 files read, publishes coverage `reduced` and says why', () => {
    const files = CPP(10);
    const fx = fixture({ sarif: codeqlSarif({ extracted: files.slice(0, 3), expected: files }) });
    const agg = rollupOf(fx).scanners?.sastCodeqlCpp;
    assert.ok(agg);
    assert.equal(agg.total, 0, 'the finding count is identical to the covered twin');
    assert.equal(agg.coverage, 'reduced',
      'a lane that read 3 of 10 files must not publish the same coverage claim as one that read all 10');
    assert.deepEqual(agg.coverageChecks, { full: 0, reduced: 1, unknown: 0 });
    assert.match(String(agg.coverageReason || ''), /3 of 10/,
      'the gap must ship its size — `reduced` with no number is a word, not evidence');
  });

  test('a SARIF with no extraction baseline publishes `unknown`, not `full`', () => {
    const fx = fixture({ sarif: codeqlSarif({ extracted: CPP(3), expected: [] }) });
    const agg = rollupOf(fx).scanners?.sastCodeqlCpp;
    assert.ok(agg);
    assert.equal(agg.coverage, 'unknown',
      'coverage that could not be established is not coverage that was established as complete');
    assert.deepEqual(agg.coverageChecks, { full: 0, reduced: 0, unknown: 1 });
  });

  test('a repo with no C++ at all is `full` — nothing to read is not a gap', () => {
    const fx = fixture({ sarif: codeqlSarif({ extracted: [], expected: ['main.go', 'x.rs'] }) });
    const agg = rollupOf(fx).scanners?.sastCodeqlCpp;
    assert.ok(agg);
    assert.equal(agg.coverage, 'full',
      'reporting every polyglot repo as half-blind would be the over-reporting direction');
  });

  test('findings that WERE found are still counted under partial coverage', () => {
    const files = CPP(10);
    const results = [{
      ruleId: 'cpp/uninitialized-local',
      level: 'error',
      message: { text: 'planted' },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/f0.cpp' }, region: { startLine: 4 } } }],
    }];
    const fx = fixture({ sarif: codeqlSarif({ extracted: files.slice(0, 3), expected: files, results }) });
    const agg = rollupOf(fx).scanners?.sastCodeqlCpp;
    assert.ok(agg);
    assert.equal(agg.total, 1,
      'partial coverage must not suppress real findings — only the SILENCE about unread files is undetermined');
    assert.equal(agg.coverage, 'reduced');
  });
});
