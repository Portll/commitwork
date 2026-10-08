// monitor/test/backfill-hash-and-lock.test.mjs — two claims: (1) a backfill rewrite must also
// recompute the index row's sliceSha256, or the next timeline build reads the slice as unreadable;
// (2) rollup and backfill converge on ONE lock path, proven by holding the real lock and asserting
// a refused backfill wrote nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, ROLLUP_LOCK } from '../lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const BACKFILL = join(CW, 'monitor', 'backfill-scanner-delta.mjs');
const TIMELINE = join(CW, 'monitor', 'timeline.mjs');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const T = (h) => new Date(Date.UTC(2026, 7, 1, h)).toISOString();

// a v1 slice whose stored scannerDelta is deliberately wrong, so backfill rewrites the body on
// its first (only) row — exercising the hash-maintenance path without a two-slice chain
function sliceBody(sliceId, stamp) {
  return JSON.stringify({
    sliceVersion: 1, sliceId, kind: 'sweep', stamp, generated: T(0), source: '/fixture/batch',
    // `alpha` keeps this slice ON the grid — timeline.mjs skips a v1 slice with zero tool runs
    scope: { repos: ['alpha'], excluded: [], superseded: [] }, scannerDelta: { comparable: true, prevSliceId: null, byCategory: {}, totals: { new: 9, fixed: 9 }, totalsAll: { new: 9, fixed: 9 }, notCompared: [] },
    conservation: { checked: [], violations: [] }, scanners: {}, scannerFindings: {},
    toolRuns: { alpha: { osv: 1 } }, findings: [], carried: [], resolved: [], anchors: {}, checks: {},
    totals: { crit: 0, high: 0, med: 0, low: 0, cves: 0 }, counts: { born: 0, cleaned: 0, unconfirmed: 0, accepted: 0, carried: 0 },
  }, null, 2);
}

// Builds a fresh scratch OUT with one v1 slice + index row (NO sliceSha256 recorded — the ordinary
// pre-R1b shape). Returns paths; caller owns cleanup of `root`.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-backfill-hashlock-'));
  const out = join(root, 'out');
  const histDir = join(out, 'history');
  mkdirSync(histDir, { recursive: true });
  const stamp = '20260801000000';
  const file = `${stamp}.json`;
  const body = sliceBody('sweep-1', stamp);
  writeFileSync(join(histDir, file), body);
  writeFileSync(join(histDir, 'index.json'), JSON.stringify([
    { stamp, sliceId: 'sweep-1', sliceVersion: 1, source: '/fixture/batch', file, generated: T(0),
      total: 0, crit: 0, high: 0, med: 0, low: 0, new: 0, fixed: 0, unconfirmed: 0, carried: 0, accepted: 0, scannedRepos: 0,
      scannerNew: null, scannerFixed: null },
  ], null, 2));
  return { root, out, histDir, file, originalBody: body };
}

const runBackfill = (out, extraArgs = []) => spawnSync(process.execPath, [BACKFILL, '--write', ...extraArgs],
  { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_MONITOR_OUT: out } });

function readTimelinePayload(out, root) {
  const r = spawnSync(process.execPath, [TIMELINE],
    { encoding: 'utf8', env: { ...process.env, CW_MONITOR_OUT: out, CW_ISSUES: join(root, 'never-written-issues.json') } });
  assert.equal(r.status, 0, `timeline.mjs must build: ${r.stderr}`);
  const html = readFileSync(join(out, 'timeline.html'), 'utf8');
  const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'timeline.html must embed its data payload');
  return JSON.parse(m[1].replace(/<\\\//g, '</'));
}

test('backfill --write rewrites a stale slice AND recomputes the index row\'s sliceSha256 to match the new bytes', () => {
  const fx = fixture();
  try {
    const r = runBackfill(fx.out);
    assert.equal(r.status, 0, `backfill-scanner-delta.mjs --write failed: ${r.stderr}`);
    assert.match(r.stdout, /1 slice\(s\) rewritten/, `expected exactly one rewrite: ${r.stdout}`);

    const newBytes = readFileSync(join(fx.histDir, fx.file));
    assert.notEqual(newBytes.toString('utf8'), fx.originalBody, 'the slice body must actually have changed — the wrong scannerDelta was the point of the fixture');

    const idx = JSON.parse(readFileSync(join(fx.histDir, 'index.json'), 'utf8'));
    const row = idx.find((e) => e.sliceId === 'sweep-1');
    assert.ok(row, 'the index row must survive the rewrite');
    assert.equal(typeof row.sliceSha256, 'string', 'sliceSha256 must be recorded once this row\'s body has been rewritten');
    assert.equal(row.sliceSha256, sha256(newBytes), 'the recorded hash must match the EXACT bytes now on disk — a stale or approximate hash reads as tampered on the next verify');

    // idempotent: a second --write keeps the SAME hash and re-touches nothing
    const r2 = runBackfill(fx.out);
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /0 slice\(s\) rewritten/, `a second run must be a no-op: ${r2.stdout}`);
    const idx2 = JSON.parse(readFileSync(join(fx.histDir, 'index.json'), 'utf8'));
    assert.equal(idx2.find((e) => e.sliceId === 'sweep-1').sliceSha256, row.sliceSha256, 'the hash must not churn on a run that rewrites nothing');
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('the REAL monitor/timeline.mjs reads the backfilled slice as verified — never unreadable', () => {
  const fx = fixture();
  try {
    const r = runBackfill(fx.out);
    assert.equal(r.status, 0, `backfill failed: ${r.stderr}`);

    const d = readTimelinePayload(fx.out, fx.root);
    const sl = d.slices.find((s) => s.sliceId === 'sweep-1');
    assert.ok(sl, 'the backfilled slice must still appear in the timeline');
    assert.equal(sl.verify, 'verified', `T1's reader must trust the hash backfill just recomputed, got verify=${sl.verify}`);
    assert.notEqual(sl.unreadable, true, 'a freshly-rewritten-and-rehashed slice must never render as unreadable');
    assert.ok(!(d.corruptSlices || []).some((c) => c.sliceId === 'sweep-1'),
      'the exact false-alarm this item exists to prevent: one backfill run rendering its own rewritten slice as corrupt');
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rollup.mjs and backfill-scanner-delta.mjs converge on ONE lock path (source wiring)', () => {
  const rollupSrc = readFileSync(ROLLUP, 'utf8');
  const backfillSrc = readFileSync(BACKFILL, 'utf8');
  assert.match(rollupSrc, /ROLLUP_LOCK/, 'rollup.mjs must reference the shared ROLLUP_LOCK constant, not a private literal');
  assert.match(backfillSrc, /lockName:\s*ROLLUP_LOCK/, 'backfill must pass lockName: ROLLUP_LOCK to takeReportsLock — the actual convergence point');
  assert.equal(ROLLUP_LOCK, '.rollup.lock', 'the shared constant must still name the file rollup.mjs has always used (monitor/test/rollup-lock.test.mjs asserts this filename end to end)');
});

test('a lock held at rollup.mjs\'s OWN path blocks backfill --write, and NOTHING is written while blocked', () => {
  const fx = fixture();
  try {
    // exactly the lock rollup.mjs's own acquireLock call takes — held in-process to simulate a live rollup
    const held = acquireLock(join(fx.out, ROLLUP_LOCK), { staleMs: 10 * 60 * 1000, label: 'simulated-live-rollup' });
    assert.equal(held.ok, true, 'precondition: the simulated rollup must acquire its own lock');
    try {
      const r = runBackfill(fx.out);
      assert.notEqual(r.status, 0, 'backfill --write must NOT succeed while rollup.mjs\'s lock is held');
      assert.equal(r.status, 3, `expected exit 3 (lock contention), got ${r.status}: ${r.stderr}`);
      assert.match(r.stderr, /another writer holds/, 'the refusal must say why');

      const bytesAfter = readFileSync(join(fx.histDir, fx.file), 'utf8');
      assert.equal(bytesAfter, fx.originalBody, 'a refused backfill must not have touched the slice body — the whole point of holding the SAME lock');
      const idxAfter = JSON.parse(readFileSync(join(fx.histDir, 'index.json'), 'utf8'));
      assert.equal(idxAfter.find((e) => e.sliceId === 'sweep-1').sliceSha256, undefined, 'no sliceSha256 may appear on a row whose body was never rewritten');

      // the lock on disk is still the one held — backfill must not have broken or replaced it
      assert.ok(existsSync(join(fx.out, ROLLUP_LOCK)), 'the held lock must still exist — backfill must not have removed it');
    } finally { held.release(); }

    // converse: released, the same fixture backfills cleanly — the refusal was contention
    const r2 = runBackfill(fx.out);
    assert.equal(r2.status, 0, `backfill must succeed once the lock is free: ${r2.stderr}`);
    assert.deepEqual(readdirSync(fx.out).filter((f) => f === ROLLUP_LOCK || f === '.reports.lock'), [],
      'releaseOnExit must leave no lock directory behind — and backfill must never ALSO create the old default .reports.lock beside it');
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});
