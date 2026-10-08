// nondeterministic-store.test.mjs — G2. The store for un-recomputable values (D3 divergence, C
// anomaly) must be EXCLUDED from the deterministic rollup, and the exclusion needs TWO witnesses that
// cannot share a failure mode (the eval's F1): a STRUCTURAL one (W2: the store is outside reportsRoot
// and rollup imports nothing from it) and a CAUSAL one (W1: mutating the store does not change a byte
// of rollup output — with a determinism baseline and a non-vacuity control so the pass is real).
// Plus the writer's own contract: append-not-overwrite, a bounded hot depth (the slider), fail-loud
// on corruption, ENOENT-is-empty, score in [0,1], CW_NOW-honouring timestamps.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from '../nondeterministic-store.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

// ── the writer contract ────────────────────────────────────────────────────────────────────────
describe('nondeterministic-store writer', () => {
  const withStore = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-nondet-'));
    const prev = process.env.CW_NONDET_STORE; process.env.CW_NONDET_STORE = dir;
    try { return fn(dir); } finally { if (prev === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = prev; }
  };

  test('a re-run APPENDS an observation, it never overwrites — two runs are two facts', () => withStore(() => {
    store.record({ subject: 'repoA/handler', dimension: 'intent-divergence', score: 0.2 });
    store.record({ subject: 'repoA/handler', dimension: 'intent-divergence', score: 0.8 });
    const rows = store.read('repoA/handler', 'intent-divergence');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.score), [0.2, 0.8]); // oldest first, latest last
  }));

  test('the hot depth is a slider and it BOUNDS the file (CW_NONDET_HOT)', () => withStore(() => {
    const prev = process.env.CW_NONDET_HOT; process.env.CW_NONDET_HOT = '3';
    try {
      for (const s of [0.1, 0.2, 0.3, 0.4, 0.5]) store.record({ subject: 's', dimension: 'd', score: s });
      const rows = store.read('s', 'd');
      assert.equal(rows.length, 3, 'kept only the hot depth');
      assert.deepEqual(rows.map((r) => r.score), [0.3, 0.4, 0.5], 'kept the MOST RECENT');
    } finally { if (prev === undefined) delete process.env.CW_NONDET_HOT; else process.env.CW_NONDET_HOT = prev; }
  }));

  test('a corrupt record file FAILS LOUD — never silently reset to clean', () => withStore((dir) => {
    store.record({ subject: 'x', dimension: 'd', score: 0.5 });
    const p = join(dir, 'd', 'x.jsonl');
    appendFileSync(p, '{not json\n');
    assert.throws(() => store.read('x', 'd'), /corrupt record/);
  }));

  test('ENOENT is legitimately empty — a never-written pair reads []', () => withStore(() => {
    assert.deepEqual(store.read('never', 'written'), []);
  }));

  test('score must be a number in [0,1] — grey is not a score', () => withStore(() => {
    for (const bad of [1.5, -0.1, NaN, 'x', null, undefined]) {
      assert.throws(() => store.record({ subject: 's', dimension: 'd', score: bad }), /score must be/);
    }
  }));

  test('the timestamp honours CW_NOW — same inputs, same recorded ts', () => withStore(() => {
    const prev = process.env.CW_NOW; process.env.CW_NOW = '2026-08-27T00:00:00.000Z';
    try {
      store.record({ subject: 's', dimension: 'd', score: 0.4 });
      assert.equal(store.read('s', 'd')[0].ts, '2026-08-27T00:00:00.000Z');
    } finally { if (prev === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prev; }
  }));
});

// ── archive / retention (F3): a different device or it frees nothing ─────────────────────────────
describe('nondeterministic-store archive (F3)', () => {
  test('same-device prune is refused, reports frees 0 bytes, verifies the copy, keeps the source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-nondet-arch-'));
    const prev = process.env.CW_NONDET_STORE; process.env.CW_NONDET_STORE = join(dir, 'store');
    try {
      store.record({ subject: 'r/h', dimension: 'd', score: 0.3 });
      store.record({ subject: 'r/h2', dimension: 'd', score: 0.6 });
      const dest = join(dir, 'archive'); // same tmp device as the store
      const res = store.archive(dest, { prune: true });
      assert.equal(res.sameDevice, true);
      assert.equal(res.freedBytes, 0, 'same device frees nothing');
      assert.equal(res.archived, 2);
      assert.equal(res.verified, 2, 'read-back receipt: every file verified byte-for-byte');
      assert.match(res.note, /same device/);
      assert.equal(store.read('r/h', 'd').length, 1, 'source kept — prune refused on same device');
      assert.equal(existsSync(join(dest, 'd', 'r_h.jsonl')), true, 'dest carries the verified copy');
    } finally { if (prev === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = prev; }
  });
});

// ── the exclusion, TWO witnesses ─────────────────────────────────────────────────────────────────
const fixedNow = '2026-08-27T00:00:05.000Z';
function rollupFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-nondet-rollup-'));
  const AREAS = [{ slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true, members: ['clean-repo'] }];
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: 'primary-area', defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  mkdirSync(join(root, 'reports', 'primary-area'), { recursive: true });
  const batch = join(root, 'reports', 'sweep-20260827000000-primary-area');
  mkdirSync(join(batch, 'clean-repo'), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20260827000000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'primary-area', areaOut: 'reports/primary-area', startedAt: '2026-08-27T00:00:00.000Z',
    scope: { repos: [{ name: 'clean-repo', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} }, anchors: {},
  }));
  const emptyOsv = { runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } }, results: [] }] };
  writeFileSync(join(batch, 'clean-repo', 'osv.sarif'), JSON.stringify(emptyOsv));
  writeFileSync(join(batch, 'clean-repo', 'npm-audit.json'), JSON.stringify({ vulnerabilities: {} }));
  writeFileSync(join(batch, 'clean-repo', 'checks-status.json'), JSON.stringify([{ check: 'deps-osv', status: 'pass', durationMs: 5, at: fixedNow }, { check: 'npm-audit', status: 'pass', durationMs: 5, at: fixedNow }]));
  return { root, batch, regPath, out: join(root, 'reports', 'primary-area') };
}
const runRollup = (regPath, batch) => spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '', CW_NOW: fixedNow } });
// rollup.json's `generated` is real wall-clock (it does NOT honour CW_NOW — an existing rollup gap),
// so mask it: W1 is about whether the store mutation changed the rollup's SUBSTANCE, not its clock.
const rollupBytes = (out) => readFileSync(join(out, 'rollup.json'), 'utf8').replace(/"generated": "[^"]*"/g, '"generated":"MASKED"');

describe('G2 exclusion — the store is invisible to the deterministic rollup', () => {
  test('W2 (structural): the store root is OUTSIDE reportsRoot, and rollup imports nothing from it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-nondet-w2-'));
    const prev = process.env.CW_NONDET_STORE; process.env.CW_NONDET_STORE = dir;
    try {
      assert.equal(store.isWithinReports(store.storeRoot(), join(CW, 'reports')), false, 'store must not be under reportsRoot');
    } finally { if (prev === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = prev; }
    const rollupSrc = readFileSync(ROLLUP, 'utf8');
    assert.equal(/from ['"].*nondeterministic-store/.test(rollupSrc), false, 'rollup.mjs must not import the nondeterministic store');
  });

  test('W1 (causal): mutating the store changes not one byte of rollup output', () => {
    const FX = rollupFixture();
    const r0 = runRollup(FX.regPath, FX.batch);
    assert.equal(r0.status, 0, `rollup should succeed: ${r0.stderr}`);
    const A = rollupBytes(FX.out);

    // baseline: rollup is deterministic on this fixture (no mutation, byte-identical) — else the test
    // below would pass for the wrong reason.
    runRollup(FX.regPath, FX.batch);
    assert.equal(rollupBytes(FX.out), A, 'baseline: rollup must be deterministic given CW_NOW');

    // the store lives OUTSIDE this fixture's reports, resolved by the REAL call-time resolver.
    const storeDir = join(FX.root, '.nondeterministic');
    const prev = process.env.CW_NONDET_STORE; process.env.CW_NONDET_STORE = storeDir;
    let recPath;
    try {
      recPath = store.record({ subject: 'clean-repo/x', dimension: 'intent-divergence', score: 0.97 }).path;
      assert.equal(store.isWithinReports(storeDir, FX.root + '/reports'), false, 'store must be outside the fixture reports');
      runRollup(FX.regPath, FX.batch);
      assert.equal(rollupBytes(FX.out), A, 'W1: a store mutation is causally inert to the rollup');
    } finally { if (prev === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = prev; }

    // non-vacuity: the recorded observation actually landed (not a no-op elsewhere)...
    assert.equal(readFileSync(recPath, 'utf8').includes('0.97'), true, 'the mutation was real');
    // ...AND the test CAN detect a change — mutating an artifact the rollup DOES read flips the bytes.
    writeFileSync(join(FX.batch, 'clean-repo', 'osv.sarif'), JSON.stringify({ runs: [{ tool: { driver: { name: 'osv-scanner', rules: [
      { id: 'CVE-2026-9999', properties: { 'security-severity': '9.8' }, shortDescription: { text: 'injected' } }] } },
      results: [{ ruleId: 'CVE-2026-9999', message: { text: "Package 'x@1.0.0' is vulnerable." }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///p.json' } } }] }] }] }));
    runRollup(FX.regPath, FX.batch);
    assert.notEqual(rollupBytes(FX.out), A, 'control: the rollup IS sensitive to files it reads, so W1 is not vacuous');
  });
});
