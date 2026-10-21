// node --test monitor/test/ — sandbox coverage per sweep. Pinned here: a lane that executed a
// repository's own code with isolation 'none' is the finding; absent artifacts are unknown and
// never zero; and — the one that matters most — when no manifest declares `executesRepoCode`, the
// repo-code dimension is UNKNOWN for every lane rather than false. A join that never resolved must
// not print "0 unconfined repo-code lanes"; that is the false clean this repo keeps re-finding.
//
// Fixtures are synthetic: made-up repo and check names, a synthetic reports root under tmp.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  latestSweep, sweepStatusFiles, repoCodeFlags, assessSandboxCoverage, runLens, summaryLine,
} from '../sandbox-coverage.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-sbcov-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

const row = (check, over = {}) => ({ check, status: 'pass', reason: null, durationMs: 10, at: '2026-09-18T00:00:00.000Z', ...over });

/** A reports root with one or more sweep batches, each holding per-repo status files. */
function reportsWith(batches) {
  const root = scratch();
  for (const [batch, repos] of Object.entries(batches)) {
    for (const [repo, rows] of Object.entries(repos)) {
      const dir = repo === '(batch)' ? join(root, batch) : join(root, batch, repo);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'checks-status.json'), JSON.stringify(rows, null, 2));
    }
  }
  return root;
}

/** A manifests directory. `declare` decides whether the executesRepoCode vocabulary exists at all. */
function manifestsWith({ declare = true } = {}) {
  const dir = scratch();
  writeFileSync(join(dir, 'example-baseline.json'), JSON.stringify({
    repo: 'example',
    checks: [
      { id: 'reads-files', egress: 'none' },
      { id: 'builds-the-repo', egress: 'registry', ...(declare ? { executesRepoCode: true } : {}) },
      { id: 'runs-their-tests', egress: 'registry', ...(declare ? { executesRepoCode: true } : {}) },
    ],
  }, null, 2));
  writeFileSync(join(dir, 'example-quality.json'), JSON.stringify({ checks: [{ id: 'lints', egress: 'none' }] }, null, 2));
  writeFileSync(join(dir, 'not-a-manifest.txt'), 'ignored');
  return dir;
}

describe('finding the artifacts', () => {
  test('the latest batch is the newest stamp; an absent root is null, not a throw', () => {
    const root = reportsWith({
      'sweep-20260901000000-example': { repoA: [row('reads-files')] },
      'sweep-20260918123000-example': { repoA: [row('reads-files')] },
    });
    assert.equal(latestSweep(root), join(root, 'sweep-20260918123000-example'));
    assert.equal(latestSweep(join(root, 'nope')), null);
  });

  test('both status-file shapes are found, sorted', () => {
    const root = reportsWith({ 'sweep-20260918123000-example': { repoB: [row('lints')], repoA: [row('lints')], '(batch)': [row('lints')] } });
    const files = sweepStatusFiles(join(root, 'sweep-20260918123000-example'));
    assert.deepEqual(files.map((f) => f.repo), [null, 'repoA', 'repoB']);
  });
});

describe('the manifest join', () => {
  test('a declared flag reads true; a check in a manifest without it reads false; an unknown check is neither', () => {
    const f = repoCodeFlags(manifestsWith());
    assert.equal(f.declared, 2);
    assert.equal(f.byCheck.get('builds-the-repo'), true);
    assert.equal(f.byCheck.get('reads-files'), false);
    assert.equal(f.byCheck.has('some-repo-local-check'), false);
    assert.deepEqual(f.unreadable, []);
  });

  test('an unreadable manifests directory is reported, never an empty vocabulary passing as an answer', () => {
    const f = repoCodeFlags(join(scratch(), 'absent'));
    assert.equal(f.declared, 0);
    assert.equal(f.unreadable.length, 1);
  });
});

describe('the assessment', () => {
  const flags = () => repoCodeFlags(manifestsWith());
  const rows = [
    { ...row('reads-files'), repo: 'repoA', isolation: 'full' },
    { ...row('builds-the-repo'), repo: 'repoA', isolation: 'none', isolationReason: 'host sandbox unavailable: sandbox-exec not on PATH' },
    { ...row('runs-their-tests'), repo: 'repoA', isolation: 'none', isolationReason: 'host sandbox unavailable: sandbox-exec not on PATH' },
    { ...row('builds-the-repo'), repo: 'repoB', isolation: 'fs-only', isolationReason: 'container lane: confined by posture offline' },
    { ...row('lints'), repo: 'repoB' },                                   // a row written before the field existed
    { ...row('some-repo-local-check'), repo: 'repoB', isolation: 'none' }, // no manifest names it
  ];

  test('lanes count by (isolation × executesRepoCode), and the unconfined repo-code lanes are named', () => {
    const a = assessSandboxCoverage(rows, flags());
    assert.equal(a.lanes, 6);
    assert.deepEqual(a.byIsolation, { 'fs-only': 1, full: 1, none: 3, unrecorded: 1 });
    assert.deepEqual(a.matrix, {
      'fs-only/repo-code': 1,
      'full/no-repo-code': 1,
      'none/repo-code': 2,
      'none/repo-code-unknown': 1,
      'unrecorded/no-repo-code': 1,
    });
    assert.deepEqual(a.unconfined.map((u) => [u.repo, u.check]), [['repoA', 'builds-the-repo'], ['repoA', 'runs-their-tests']]);
    assert.deepEqual(a.unconfinedReasons, { 'host sandbox unavailable: sandbox-exec not on PATH': 2 });
    assert.equal(a.repoCodeUnknown, 1, 'a check no manifest names is unknown, not safe');
    assert.equal(a.isolationUnrecorded, 1, 'a row with no isolation field is unrecorded, not confined');
  });

  test('a confined lane is never a finding, whatever it runs', () => {
    const a = assessSandboxCoverage([{ ...row('builds-the-repo'), repo: 'repoA', isolation: 'full' }], flags());
    assert.deepEqual(a.unconfined, []);
    assert.deepEqual(a.matrix, { 'full/repo-code': 1 });
  });

  test('WITHOUT a declared flag anywhere, every lane is repo-code-unknown — never zero unconfined', () => {
    const a = assessSandboxCoverage(rows, repoCodeFlags(manifestsWith({ declare: false })));
    assert.deepEqual(a.unconfined, [], 'nothing can be asserted…');
    assert.equal(a.repoCodeUnknown, 6, '…because nothing is known');
    assert.equal(a.repoCodeDeclared, 0);
    assert.deepEqual(a.matrix, { 'fs-only/repo-code-unknown': 1, 'full/repo-code-unknown': 1, 'none/repo-code-unknown': 3, 'unrecorded/repo-code-unknown': 1 });
  });
});

describe('the lens end to end', () => {
  const batch = {
    repoA: [
      { ...row('reads-files'), isolation: 'full' },
      { ...row('builds-the-repo'), isolation: 'none', isolationReason: 'check declares no egress class; ran unconfined rather than under a guessed one' },
    ],
    repoB: [{ ...row('runs-their-tests'), isolation: 'full' }],
  };

  test('an unconfined repo-code lane is a finding, with repo, check and reason', async () => {
    const root = reportsWith({ 'sweep-20260918123000-example': batch });
    await env({ CW_SANDBOX_COVERAGE_ROOT: root, CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith(), CW_NOW: '2026-09-18T12:40:00.000Z' }, async () => {
      const r = runLens();
      assert.equal(r.state, 'findings');
      assert.equal(r.sweep, join(root, 'sweep-20260918123000-example'));
      assert.deepEqual(r.unconfined, [{ repo: 'repoA', check: 'builds-the-repo', isolationReason: 'check declares no egress class; ran unconfined rather than under a guessed one' }]);
      assert.deepEqual(r.byIsolation, { full: 2, none: 1 });
      assert.equal(r.at, '2026-09-18T12:40:00.000Z');
      assert.match(summaryLine(r), /1 executing repo code UNCONFINED/);
    })();
  });

  test('every lane confined is ok; --sweep names an older batch and measures THAT one', async () => {
    const root = reportsWith({
      'sweep-20260901000000-example': { repoA: [{ ...row('builds-the-repo'), isolation: 'none', isolationReason: 'CW_SANDBOX=off: host sandbox disabled by the operator' }] },
      'sweep-20260918123000-example': { repoA: [{ ...row('builds-the-repo'), isolation: 'full' }] },
    });
    await env({ CW_SANDBOX_COVERAGE_ROOT: root, CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith() }, async () => {
      assert.equal(runLens().state, 'ok');
      const old = runLens({ sweepDir: join(root, 'sweep-20260901000000-example') });
      assert.equal(old.state, 'findings');
      assert.deepEqual(old.unconfinedReasons, { 'CW_SANDBOX=off: host sandbox disabled by the operator': 1 });
    })();
  });

  test('the flag declared nowhere makes the sweep PARTIAL, and the line says why', async () => {
    const root = reportsWith({ 'sweep-20260918123000-example': batch });
    await env({ CW_SANDBOX_COVERAGE_ROOT: root, CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith({ declare: false }) }, async () => {
      const r = runLens();
      assert.equal(r.state, 'partial');
      assert.deepEqual(r.unconfined, []);
      assert.equal(r.manifests.declaredRepoCode, 0);
      assert.match(summaryLine(r), /the flag is declared nowhere in manifests\//);
    })();
  });

  test('rows that predate the isolation field are unrecorded, not confined — partial, never ok', async () => {
    const root = reportsWith({ 'sweep-20260918123000-example': { repoA: [row('reads-files'), row('builds-the-repo')] } });
    await env({ CW_SANDBOX_COVERAGE_ROOT: root, CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith() }, async () => {
      const r = runLens();
      assert.equal(r.state, 'partial');
      assert.equal(r.isolationUnrecorded, 2);
      assert.deepEqual(r.byIsolation, { unrecorded: 2 });
    })();
  });

  test('missing artifacts are unknown(absent) — an unmeasured sweep is never a clean one', async () => {
    const empty = scratch();
    await env({ CW_SANDBOX_COVERAGE_ROOT: join(empty, 'no-such-root'), CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith() }, async () => {
      const r = runLens();
      assert.equal(r.state, 'unknown');
      assert.equal(r.unknownReason, 'absent');
      assert.equal(r.lanes, undefined, 'no counts at all — not zero lanes');
      assert.match(summaryLine(r), /UNKNOWN \(absent\)/);
    })();

    const root = reportsWith({ 'sweep-20260918123000-example': {} });
    mkdirSync(join(root, 'sweep-20260918123000-example'), { recursive: true });
    await env({ CW_SANDBOX_COVERAGE_ROOT: root, CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith() }, async () => {
      const r = runLens();
      assert.equal(r.state, 'unknown');
      assert.match(r.unknownDetail, /unmeasured/);
    })();
  });

  test('an unparseable status file is counted, and its batch stays partial rather than dropping it', async () => {
    const root = reportsWith({ 'sweep-20260918123000-example': { repoA: [{ ...row('builds-the-repo'), isolation: 'full' }] } });
    mkdirSync(join(root, 'sweep-20260918123000-example', 'repoC'), { recursive: true });
    writeFileSync(join(root, 'sweep-20260918123000-example', 'repoC', 'checks-status.json'), '{ truncated');
    await env({ CW_SANDBOX_COVERAGE_ROOT: root, CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith() }, async () => {
      const r = runLens();
      assert.equal(r.state, 'partial');
      assert.equal(r.unreadable.length, 1);
      assert.match(summaryLine(r), /1 unreadable artifact/);
    })();
  });

  test('same inputs, byte-identical output', async () => {
    const root = reportsWith({ 'sweep-20260918123000-example': batch });
    await env({ CW_SANDBOX_COVERAGE_ROOT: root, CW_SANDBOX_COVERAGE_MANIFESTS: manifestsWith(), CW_NOW: '2026-09-18T12:40:00.000Z' }, async () => {
      assert.equal(JSON.stringify(runLens()), JSON.stringify(runLens()));
    })();
  });
});
