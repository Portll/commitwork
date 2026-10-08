// monitor/test/rollup-history-corrupt.test.mjs — a corrupt history store STOPS the rollup.
//
// Task 1.2's rollup half (cw-handoff-corpus-20260813), measured before it was fixed: the index
// read at rollup's history stage swallowed corrupt as absent, and the fallthrough was destructive
// twice over — a fresh sliceId duplicating every ledger entry, and a final index write REPLACING
// index.json with one row, orphaning all prior slices. The prev-slice walk had the sibling defect:
// a named-but-unreadable slice was silently skipped, so the lifecycle diff ran against an OLDER
// baseline and minted false FIXED/born events. Both now refuse with exit 7, and the refusal is
// pinned here in both directions: corrupt stops the run AND leaves the store bytes untouched;
// a genuinely absent index (first run) still rolls up.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

const REPO = 'rollup-history-corrupt-fixture-repo';
const AREAS = [{ slug: 'corrupt-area', label: 'corrupt', out: 'corrupt-area', primary: true, members: [REPO] }];

// Minimal honest batch: one repo, one clean npm-audit artifact — enough for a v1 slice.
function plantBatch(root, stampSuffix) {
  const batch = join(root, 'reports', `sweep-2026081013000${stampSuffix}-corrupt-area`);
  const repoDir = join(batch, REPO);
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: `sweep-2026081013000${stampSuffix}`, kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'corrupt-area', areaOut: 'reports/corrupt-area', startedAt: `2026-08-10T13:00:0${stampSuffix}.000Z`,
    scope: { repos: [{ name: REPO, manifests: ['security-baseline'] }], excluded: [], lifecycle: {} },
    anchors: {},
  }));
  writeFileSync(join(repoDir, 'npm-audit.json'), JSON.stringify({ vulnerabilities: {} }));
  writeFileSync(join(repoDir, 'checks-status.json'), JSON.stringify([
    { check: 'npm-audit', status: 'pass', durationMs: 5, at: '2026-08-10T12:00:01.000Z' },
  ]));
  return batch;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-rollup-corrupt-'));
  const reg = { reportsRoot: join(root, 'reports'), monitorOutput: AREAS[0].out,
    defaultManifest: 'security-baseline', roots: [], projects: [], areas: AREAS };
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify(reg));
  mkdirSync(join(root, 'reports', AREAS[0].out), { recursive: true });
  return { root, regPath, out: join(root, 'reports', AREAS[0].out) };
}

const runRollup = (regPath, batch) => spawnSync(
  process.execPath, ['--import', NO_FETCH, ROLLUP, batch],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '' } });

describe('rollup refuses a corrupt history store', () => {
  let FX, batch1;

  before(() => {
    FX = fixture();
    batch1 = plantBatch(FX.root, '0');
    const first = runRollup(FX.regPath, batch1);
    assert.equal(first.status, 0, `seed rollup failed: ${(first.stderr || '').slice(0, 500)}`);
  });

  test('control: the seed run wrote a real history index (ENOENT was a legitimate first run)', () => {
    const idx = JSON.parse(readFileSync(join(FX.out, 'history', 'index.json'), 'utf8'));
    assert.ok(Array.isArray(idx) && idx.length >= 1);
  });

  test('a corrupt index.json stops the rollup and its BYTES survive untouched', () => {
    const idxPath = join(FX.out, 'history', 'index.json');
    const good = readFileSync(idxPath, 'utf8');
    writeFileSync(idxPath, '[{"sliceVersion":1, TRUNCATED');
    const r = runRollup(FX.regPath, plantBatch(FX.root, '1'));
    assert.equal(r.status, 7, `expected refusal exit 7, got ${r.status}\n${(r.stderr || '').slice(0, 400)}`);
    assert.match(r.stderr, /EXISTS but is unreadable/);
    assert.match(r.stderr, /orphaning all history/);
    assert.equal(readFileSync(idxPath, 'utf8'), '[{"sliceVersion":1, TRUNCATED',
      'the refusal must not have rewritten the index — burying the corruption is the defect');
    writeFileSync(idxPath, good);   // restore for the next tests
  });

  test('an index that parses to a non-array is the same refusal', () => {
    const idxPath = join(FX.out, 'history', 'index.json');
    const good = readFileSync(idxPath, 'utf8');
    writeFileSync(idxPath, '{"not":"an array"}');
    const r = runRollup(FX.regPath, plantBatch(FX.root, '2'));
    assert.equal(r.status, 7);
    assert.match(r.stderr, /not an array/);
    writeFileSync(idxPath, good);
  });

  test('a prev slice NAMED by the index but unreadable refuses — never a stale-baseline comparison', () => {
    // A second batch (different source) makes the walk consult batch1's slice as prev. Corrupt it.
    const idx = JSON.parse(readFileSync(join(FX.out, 'history', 'index.json'), 'utf8'));
    const prevRow = idx.filter((e) => (e.sliceVersion || 0) >= 1).pop();
    assert.ok(prevRow && prevRow.file, 'fixture invariant: the seed slice is indexed');
    const slicePath = join(FX.out, 'history', prevRow.file);
    const goodSlice = readFileSync(slicePath, 'utf8');
    writeFileSync(slicePath, '{"findings": [ TRUNCATED');
    const r = runRollup(FX.regPath, plantBatch(FX.root, '3'));
    assert.equal(r.status, 7, `expected refusal exit 7, got ${r.status}\n${(r.stderr || '').slice(0, 400)}`);
    assert.match(r.stderr, /named by the index but unreadable/);
    assert.match(r.stderr, /false FIXED\/born/);
    writeFileSync(slicePath, goodSlice);
  });

  test('restored store: the rollup proceeds again — the refusal is about the bytes, not a latch', () => {
    const r = runRollup(FX.regPath, plantBatch(FX.root, '4'));
    assert.equal(r.status, 0, `rollup after restore failed: ${(r.stderr || '').slice(0, 400)}`);
    const files = readdirSync(join(FX.out, 'history'));
    assert.ok(files.length >= 2, 'history accumulated rather than restarted');
  });
});
