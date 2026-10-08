#!/usr/bin/env node
// monitor/backfill-scanner-delta.mjs — retrofit scannerDelta onto an area's EXISTING history:
// walks the chain in order and computes each consecutive v1 pair's diff from stored data. Nothing
// re-scanned, no evidence invented; idempotent (rewrites only when the stored delta differs);
// atomic writes, index last, whole walk under the rollup lock.
//
// usage: node monitor/backfill-scanner-delta.mjs [--area <slug>] [--write]
//   default is a DRY RUN. OUT resolves as everywhere else: CW_MONITOR_OUT, else the area's out.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { outDirFor } from './area.mjs';
import { loadRegistry } from './registry.mjs';
import { writeAtomic, takeReportsLock, ROLLUP_LOCK, describeAge } from './lockfile.mjs';
import { diffScannerFindings } from './scanner-delta.mjs';
import { checkHistoryIndex } from './store-consistency.mjs'; // the second witness: reads the DISK after the walk, never this process's idx

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const areaIx = args.indexOf('--area');
const AREA = areaIx >= 0 ? args[areaIx + 1] : null;

// Fail loud — a broken registry must stop a history rewrite, not misresolve OUT
const REG = loadRegistry();
const OUT = outDirFor(AREA, REG);
const histDir = join(OUT, 'history');
const indexPath = join(histDir, 'index.json');
if (!existsSync(indexPath)) {
  console.error(`backfill-scanner-delta: no ${indexPath} — nothing to backfill`);
  process.exit(1);
}

// Only ENOENT is legitimately absent; a parse failure throws — never rewrite a history you cannot read
const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
const ordered = [...idx].sort((a, b) => String(a.generated || '').localeCompare(String(b.generated || '')));

const run = () => {
  let prev = null; // previous V1 slice object, in generated order — v0 rows neither give nor take
  let rewrites = 0, unchanged = 0, skippedV0 = 0, repairedHash = 0;
  let idxChanged = false;
  // The index is written after EVERY change to a row's hash, not once at the end. Measured
  // 2026-09-01: a walk that threw on its sixth slice had rewritten five and re-hashed none — the
  // index-last "commit marker" orphaned every slice before the throw, and the re-run could not
  // heal them because their bodies were already current (`same`) and so were never re-hashed.
  const commitIndex = () => { if (WRITE) writeAtomic(indexPath, JSON.stringify(idx, null, 2)); idxChanged = false; };

  let skippedGone = 0;
  for (const e of ordered) {
    if (!((e.sliceVersion || 0) >= 1)) { skippedV0++; continue; }
    const file = join(histDir, e.file || `${e.stamp}.json`);
    // ENOENT only: compacted histories keep index rows whose bodies were pruned — the chain
    // continues from the last READABLE slice; any other failure throws
    let raw;
    try { raw = readFileSync(file, 'utf8'); }
    catch (err) { if (err && err.code === 'ENOENT') { skippedGone++; continue; } throw err; }
    let slice;
    try { slice = JSON.parse(raw); }
    catch (err) {
      // Named, and the walk STOPS here: `prev = slice` chains every delta to its predecessor, so
      // skipping this slice would compute the next one against the wrong baseline and write a
      // plausible wrong number. Rows before this one already have their hashes committed.
      throw new Error(`${file} is not JSON (${err.message}) — fix or prune it and re-run; slices before it are already re-hashed`);
    }
    // Hash-only repair: bytes that no longer match the recorded hash, with a delta that is already
    // current. The rewrite path below never reaches such a row (`same`), so without this it stays
    // unreadable to timeline.mjs forever — the shape the five 2026-09-01 orphans were found in.
    const actualSha = sha256(raw);
    if (typeof e.sliceSha256 === 'string' && e.sliceSha256 && e.sliceSha256 !== actualSha) {
      repairedHash++;
      console.log(`  ${WRITE ? '✎' : '~'} ${e.stamp} index hash ${e.sliceSha256.slice(0, 12)}… ≠ bytes ${actualSha.slice(0, 12)}… — ${WRITE ? 'repaired' : 'would repair'}`);
      if (WRITE) { e.sliceSha256 = actualSha; idxChanged = true; commitIndex(); }
    }
    const delta = diffScannerFindings(prev, slice);
    const stored = slice.scannerDelta;
    const same = stored && JSON.stringify(stored) === JSON.stringify(delta);
    const line = `${e.stamp} prev=${delta.prevSliceId || '—'} new=${delta.totals.new ?? '·'} fixed=${delta.totals.fixed ?? '·'}`
      + (delta.totalsAll.fixed !== delta.totals.fixed || delta.totalsAll.new !== delta.totals.new
        ? ` (all-lanes new=${delta.totalsAll.new} fixed=${delta.totalsAll.fixed})` : '');
    if (same) { unchanged++; console.log(`  = ${line}`); }
    else {
      rewrites++;
      console.log(`  ${WRITE ? '✎' : '~'} ${line}`);
      if (WRITE) {
        slice.scannerDelta = delta;
        const body = JSON.stringify(slice, null, 2);
        writeAtomic(file, body);
        // sliceSha256 is hashed over the EXACT bytes just written ("write it, hash it") — a stale
        // index hash would render every rewritten slice `unreadable` on the next read
        const newHash = sha256(body);
        if (e.sliceSha256 !== newHash) { e.sliceSha256 = newHash; idxChanged = true; commitIndex(); }
      }
    }
    // index rows ride along regardless of whether the slice body needed rewriting — older rows
    // predate the scannerNew/scannerFixed columns entirely
    if (e.scannerNew !== delta.totals.new || e.scannerFixed !== delta.totals.fixed) {
      e.scannerNew = delta.totals.new; e.scannerFixed = delta.totals.fixed;
      idxChanged = true;
    }
    prev = slice; // the version WITHOUT this run's mutation matters not — delta reads scanners/rows only
  }

  if (idxChanged) commitIndex(); // the ride-along columns (scannerNew/scannerFixed) — not integrity-bearing, batched
  if (repairedHash) console.log(`${WRITE ? 'repaired' : 'would repair'} ${repairedHash} index hash(es) whose slice bytes had changed behind them`);
  console.log(`${WRITE ? 'backfilled' : 'dry run'}: ${rewrites} slice(s) ${WRITE ? 'rewritten' : 'would be rewritten'}, `
    + `${unchanged} already current, ${skippedV0} v0 skipped${skippedGone ? `, ${skippedGone} pruned slice bodies skipped (index rows untouched)` : ''}${idxChanged ? (WRITE ? ', index updated' : ', index would update') : ''}`);
  if (!WRITE && (rewrites || idxChanged)) console.log('re-run with --write to apply');
};

if (WRITE) {
  // Hold ROLLUP_LOCK (not '.reports.lock') for the whole rewrite — the single slice-writer mutex
  // rollup.mjs shares over this directory; staleMs matches its 10-minute threshold.
  const lock = takeReportsLock(OUT, { label: 'backfill-scanner-delta', lockName: ROLLUP_LOCK, staleMs: 10 * 60 * 1000 });
  // A lost acquisition must actually stop the write (mirrors rollup.mjs's exit 3)
  if (!lock.ok) {
    console.error(`backfill-scanner-delta: another writer holds ${ROLLUP_LOCK} in ${OUT} (${describeAge(lock.heldFor)}) — aborting`);
    process.exit(3);
  }
  try { run(); }
  catch (e) { console.error(`backfill-scanner-delta: stopped — ${e && e.message || e}`); process.exitCode = 2; }
  finally { lock.release(); }
  // Second witness, from the disk. exit 4 = the store disagrees with itself after this run. A walk
  // that already stopped (exit 2) keeps its code: the stop is the cause, the anomaly its trace.
  const chk = checkHistoryIndex(histDir);
  if (!chk.ok) { console.error(`backfill-scanner-delta: could not re-read ${indexPath} after writing it (${chk.reason || chk.state || 'unknown'})`); process.exitCode ||= 4; }
  else if (chk.anomalies.length) {
    for (const a of chk.anomalies) console.error(`backfill-scanner-delta: ${a.class} ${a.key} — ${a.detail}`);
    console.error(`backfill-scanner-delta: ${chk.anomalies.length} store anomal${chk.anomalies.length === 1 ? 'y' : 'ies'} remain — run node monitor/store-consistency.mjs --area <slug>`);
    process.exitCode ||= 4;
  }
} else {
  run();
}
