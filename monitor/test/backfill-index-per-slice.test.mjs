// backfill-scanner-delta.mjs — what a crash mid-walk leaves behind, measured 2026-09-01 on
// clientB and shodh-memory: five slices rewritten, index written LAST, a throw before it,
// five rows whose recorded hash no longer matched their bytes. The re-run could not heal them —
// their bodies were already current, so the rewrite path never touched them again.
//
// Three claims: (1) the index is committed after EACH rewrite, so rows before a throw are already
// re-hashed; (2) a corrupt slice stops the walk by NAME with exit 2 — never skipped, because the
// next delta is computed against it; (3) a row whose bytes changed behind its hash is repaired
// even when its delta is current, and the disk is re-read afterwards (exit 4 on disagreement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const BACKFILL = join(CW, 'monitor', 'backfill-scanner-delta.mjs');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const T = (h) => new Date(Date.UTC(2026, 8, 1, h)).toISOString();

// a v1 slice whose stored scannerDelta is WRONG, so --write rewrites it
function body(sliceId, stamp, h) {
  return JSON.stringify({
    sliceVersion: 1, sliceId, kind: 'sweep', stamp, generated: T(h), source: `sweep-${stamp}`,
    scope: { repos: ['alpha'], excluded: [], superseded: [] },
    scannerDelta: { comparable: true, prevSliceId: null, byCategory: {}, totals: { new: 9, fixed: 9 }, totalsAll: { new: 9, fixed: 9 } },
    conservation: { checked: [], violations: [] }, scanners: {}, scannerFindings: {},
    toolRuns: { alpha: { osv: 1 } }, findings: [], carried: [], resolved: [], anchors: {}, checks: {},
    totals: { crit: 0, high: 0, med: 0, low: 0, cves: 0 }, counts: { born: 0, cleaned: 0, unconfirmed: 0, accepted: 0, carried: 0 },
  }, null, 2);
}
const row = (stamp, sliceId, sliceSha256, h) => ({ stamp, sliceId, sliceVersion: 1, source: `sweep-${stamp}`, file: `${stamp}.json`, generated: T(h),
  total: 0, crit: 0, high: 0, med: 0, low: 0, new: 0, fixed: 0, unconfirmed: 0, carried: 0, accepted: 0, scannedRepos: 0, scannerNew: null, scannerFixed: null, sliceSha256 });

function fixture(slices) {
  const root = mkdtempSync(join(tmpdir(), 'cw-backfill-perslice-'));
  const out = join(root, 'out'); const hist = join(out, 'history');
  mkdirSync(hist, { recursive: true });
  const idx = [];
  slices.forEach(({ stamp, text, hash }, i) => {
    writeFileSync(join(hist, `${stamp}.json`), text);
    idx.push(row(stamp, `sweep-${i + 1}`, hash === undefined ? sha256(text) : hash, i));
  });
  writeFileSync(join(hist, 'index.json'), JSON.stringify(idx, null, 2));
  return { root, out, hist };
}
const run = (out) => spawnSync(process.execPath, [BACKFILL, '--write'], { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_MONITOR_OUT: out } });
const readIdx = (hist) => JSON.parse(readFileSync(join(hist, 'index.json'), 'utf8'));
const hashOnDisk = (hist, stamp) => sha256(readFileSync(join(hist, `${stamp}.json`)));

test('the harness is live: a clean three-slice walk rewrites all three and every index hash matches its bytes', () => {
  const { root, out, hist } = fixture([
    { stamp: '20260901000000', text: body('sweep-1', '20260901000000', 0) },
    { stamp: '20260901010000', text: body('sweep-2', '20260901010000', 1) },
    { stamp: '20260901020000', text: body('sweep-3', '20260901020000', 2) },
  ]);
  const r = run(out);
  assert.equal(r.status, 0, r.stderr);
  for (const e of readIdx(hist)) assert.equal(e.sliceSha256, hashOnDisk(hist, e.stamp), `${e.stamp} must be re-hashed`);
  rmSync(root, { recursive: true, force: true });
});

test('a CORRUPT second slice: the first is already re-hashed, the corrupt one is named, exit 2, the third untouched', () => {
  const { root, out, hist } = fixture([
    { stamp: '20260901000000', text: body('sweep-1', '20260901000000', 0) },
    { stamp: '20260901010000', text: '{ this is not json', hash: 'f'.repeat(64) },
    { stamp: '20260901020000', text: body('sweep-3', '20260901020000', 2) },
  ]);
  const before3 = readIdx(hist)[2].sliceSha256;
  const r = run(out);
  assert.equal(r.status, 2, `exit must be 2 (stopped, named), got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /20260901010000\.json is not JSON/, 'the corrupt slice is named');
  assert.match(r.stderr, /already re-hashed/, 'and the caller is told the rows before it are safe');
  const idx = readIdx(hist);
  assert.equal(idx[0].sliceSha256, hashOnDisk(hist, '20260901000000'), 'slice 1 was rewritten AND its index hash committed before the throw');
  assert.equal(idx[2].sliceSha256, before3, 'slice 3 was never reached — its row is untouched, not invented');
  // the disk re-read after the walk reports the corrupt row's stale hash: exit code already 2, and the anomaly is printed
  assert.match(r.stderr, /mismatch 20260901010000\.json/, 'the second witness names the row that still disagrees');
  rmSync(root, { recursive: true, force: true });
});

test('HASH-ONLY REPAIR: bytes changed behind a current delta are re-hashed, which the rewrite path alone never does', () => {
  // the delta stored in this slice is what backfill would compute for a first slice (no prev), so
  // the body is `unchanged` — the exact shape the five 2026-09-01 orphans were left in
  const stamp = '20260901000000';
  const text = body('sweep-1', stamp, 0);
  const { root, out, hist } = fixture([{ stamp, text, hash: 'e'.repeat(64) }]);
  const r1 = run(out);
  assert.equal(r1.status, 0, r1.stderr);
  const after = readIdx(hist)[0];
  assert.equal(after.sliceSha256, hashOnDisk(hist, stamp), 'the stale hash is repaired to the bytes on disk');
  assert.match(r1.stdout, /index hash e{12}… ≠ bytes/, 'the repair is printed, with both hashes');
  // idempotent: a second run repairs nothing
  const r2 = run(out);
  assert.equal(r2.status, 0);
  assert.doesNotMatch(r2.stdout, /≠ bytes/);
  rmSync(root, { recursive: true, force: true });
});

test('the disk is re-read after the walk: an orphaned row that survives the walk is exit 4, never a quiet 0', () => {
  // an index row whose slice file is ABSENT with a hash pinned — store-consistency's `orphan`. The
  // walk skips it (ENOENT is legitimate for compacted histories), so only the disk check can see it.
  const { root, out, hist } = fixture([{ stamp: '20260901000000', text: body('sweep-1', '20260901000000', 0) }]);
  const idx = readIdx(hist);
  idx.push(row('20260901010000', 'sweep-2', 'd'.repeat(64), 1));
  writeFileSync(join(hist, 'index.json'), JSON.stringify(idx, null, 2));
  const r = run(out);
  assert.equal(r.status, 4, `exit must be 4, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /orphan 20260901010000\.json/);
  rmSync(root, { recursive: true, force: true });
});
