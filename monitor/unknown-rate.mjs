#!/usr/bin/env node
// monitor/unknown-rate.mjs — the question monitor/unknown.mjs was built for, finally asked at
// fleet scope: WHAT FRACTION OF WHAT WE PUBLISH IS AN UNKNOWN, and for which reasons, in which
// lanes?
//
// Every primitive already existed — unknownReasonOf() reads mixed-vintage category blocks,
// tallyUnknown() counts them, denominator.claim() makes the coverage travel with the number — and
// nothing called them across a slice. (HANDOFF-scanner-truth-and-taxonomy-2026-08-23, Priority 2:
// "nothing answers the question the unknown-unification was built for".) This lens is that call,
// and nothing else: it computes over rollups already on disk, writes one fleet artifact, and
// publishes no verdicts — its output is a metric about OUR OWN reporting, never a finding about a
// scanned repo.
//
// THE UNIVERSE IS PUBLISHED CELLS. A cell is one repos[].scanners.<category> block in one area's
// rollup. Categories whose extractor returned null never reach `scanners` (they read as voids via
// checks-status provenance), so this rate is about what WAS published — the voids have their own
// ledgers (coverage-manifest, denominator blocks in the rollup itself) and are not re-counted
// here. The `of` string on every claim pins that universe so the number cannot quietly widen.
//
// TWO HONESTY RULES.
//   1. A rate over a dead sweep is not a rate. Freshness is classified on the sliceId scan stamp
//      (never the re-stampable `generated`); an area that is not `fresh` contributes its cells to
//      the fleet claim's `undetermined`, not to its observed count, and carries its own freshness
//      state so nothing is hidden.
//   2. Conservation is the second witness: per area, unknown + determined must equal cells. The
//      tally and the conservation check walk the same blocks by different arithmetic, so a
//      violation is a defect in THIS module — a violating area is excluded from the fleet's
//      observed count (rolled into undetermined) and the violation is published, never patched.
//
// usage: node monitor/unknown-rate.mjs [--json]
// writes: <reportsRoot>/unknown-rate.json (fleet-level, atomic) and appends one point to
// unknown-rate-history.jsonl beside it (CW_UNKNOWN_RATE_HISTORY). CW_NOW pins `generated` and the
// freshness clock; CW_REGISTRY isolates tests completely.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadRegistry } from './registry.mjs';
import { reportsRootDir } from './area.mjs';
import { unknownReasonOf } from './unknown.mjs';
import { claim, render, publishable, combine } from './denominator.mjs';
import { classifyFreshness } from './freshness.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

const WORST_CAP = 50;

/**
 * The pure core: one area's rollup → its unknown-rate block. No I/O, no clock of its own.
 * `nowMs` decides freshness only.
 */
export function unknownRateFor(area, rollup, nowMs) {
  const repos = Array.isArray(rollup && rollup.repos) ? rollup.repos : [];
  const byReason = {};
  const byCategory = {};
  const worst = [];
  let cells = 0;
  let unknownCells = 0;
  let determined = 0;

  for (const r of repos) {
    const scanners = r && r.scanners && typeof r.scanners === 'object' ? r.scanners : {};
    for (const [category, block] of Object.entries(scanners)) {
      cells += 1;
      const cat = byCategory[category] || (byCategory[category] = { cells: 0, unknown: 0, byReason: {} });
      cat.cells += 1;
      const reason = unknownReasonOf(block);
      if (reason) {
        unknownCells += 1;
        byReason[reason] = (byReason[reason] || 0) + 1;
        cat.unknown += 1;
        cat.byReason[reason] = (cat.byReason[reason] || 0) + 1;
        worst.push({ repo: String(r.repo || r.name || ''), category, reason });
      } else {
        determined += 1;
      }
    }
  }

  // Second witness: same blocks, different arithmetic. A violation here is OUR defect and is
  // published as one — never silently reconciled.
  const conserved = unknownCells + determined === cells;

  const freshness = classifyFreshness(rollup && rollup.generated, nowMs, { sliceId: rollup && rollup.sliceId });
  const fresh = freshness.state === 'fresh';

  worst.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  // An area that is stale/expired/unknown — or that failed conservation — must not lend its cells
  // to the fleet's determined coverage: they are examined-but-unanswerable for NOW-purposes.
  const usable = fresh && conserved;
  return {
    area,
    sliceId: (rollup && rollup.sliceId) || null,
    freshness: { state: freshness.state, scanTime: freshness.scanTime ?? null, ageHours: freshness.ageHours ?? null },
    cells,
    unknown: unknownCells,
    byReason: sortKeys(byReason),
    byCategory: sortKeys(mapValues(byCategory, (v) => ({ cells: v.cells, unknown: v.unknown, byReason: sortKeys(v.byReason) }))),
    conservation: conserved ? { ok: true } : { ok: false, cells, unknown: unknownCells, determined },
    worst: worst.length > WORST_CAP ? worst.slice(0, WORST_CAP) : worst,
    ...(worst.length > WORST_CAP ? { worstTruncated: worst.length - WORST_CAP } : {}),
    claim: claim({
      count: usable ? unknownCells : 0,
      observed: usable ? cells : 0,
      population: cells,
      undetermined: usable ? 0 : cells,
      unit: 'cell',
      of: 'published scanner cell carrying an unknown',
    }),
  };
}

/** Fleet aggregate over per-area blocks — denominator.combine so one unknown poisons honestly. */
export function fleetUnknownRate(areaBlocks) {
  const byReason = {};
  const byCategory = {};
  for (const a of areaBlocks) {
    for (const [r, n] of Object.entries(a.byReason)) byReason[r] = (byReason[r] || 0) + n;
    for (const [c, v] of Object.entries(a.byCategory)) {
      const cat = byCategory[c] || (byCategory[c] = { cells: 0, unknown: 0 });
      cat.cells += v.cells; cat.unknown += v.unknown;
    }
  }
  const fleet = combine(areaBlocks.map((a) => a.claim), { unit: 'cell', of: 'published scanner cell carrying an unknown' });
  return { fleet, byReason: sortKeys(byReason), byCategory: sortKeys(byCategory) };
}

const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const mapValues = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

// ── HISTORY ──────────────────────────────────────────────────────────────────────────────────────
// unknown-rate.json is overwritten each run, so without this the rate had no past. One line per
// run, beside the snapshot; the panel's correlations view reads it (admin/routes/correlations.mjs).
export const HISTORY_CAP = 1000;
export const unknownRatePath = (root) => join(root, 'unknown-rate.json');
export const unknownRateHistoryPath = (root) => process.env.CW_UNKNOWN_RATE_HISTORY || join(root, 'unknown-rate-history.jsonl');

/** One history point from a fleet claim. Counts only; the rates are derived by the reader. */
export function historyPoint(generated, claim, { areas = 0, unreadable = 0 } = {}) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    at: generated, count: n(claim && claim.count), observed: n(claim && claim.observed),
    population: n(claim && claim.population), undetermined: n(claim && claim.undetermined), areas, unreadable,
  };
}

/** Existing history text + one point → new text. A re-run at the same `at` (CW_NOW pinned) adds
 *  nothing, so the journal is idempotent. A line that does not parse throws: a corrupt history is
 *  never silently truncated to the cap. */
export function appendHistory(text, point, cap = HISTORY_CAP) {
  const lines = String(text || '').split('\n').filter(Boolean);
  lines.forEach((l, i) => { try { JSON.parse(l); } catch (e) { throw new Error(`unknown-rate history line ${i + 1} does not parse: ${e.message}`); } });
  const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  if (!last || last.at !== point.at) lines.push(JSON.stringify(point));
  return `${lines.slice(-cap).join('\n')}\n`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const reg = loadRegistry();
  const root = reportsRootDir(reg);
  const nowIso = process.env.CW_NOW || new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  // Every area dir holding a rollup — the liveness discovery shape. A rollup that does not parse
  // is an area whose state is UNKNOWN, listed as such; only ENOENT means legitimately absent.
  const areas = [];
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch (e) {
    if (e && e.code !== 'ENOENT') { console.error(`unknown-rate: cannot read ${root}: ${e.message}`); process.exit(2); }
  }
  const unreadable = [];
  for (const d of dirs) {
    const p = join(root, d, 'rollup.json');
    if (!existsSync(p)) continue;
    let rollup;
    try { rollup = JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { unreadable.push({ area: d, why: `rollup.json did not parse: ${e.message}` }); continue; }
    areas.push(unknownRateFor(d, rollup, nowMs));
  }

  const { fleet, byReason, byCategory } = fleetUnknownRate(areas);
  const out = {
    generated: nowIso,
    note: 'What fraction of the cells we PUBLISH is an unknown, by reason and by lane. The universe is published repos[].scanners.<category> blocks — voids that never reached a rollup are counted by coverage-manifest, not here. Areas that are not fresh (sliceId scan stamp) or fail conservation contribute to undetermined, never to the observed count.',
    fleet: { claim: publishable(fleet), rendered: render(fleet) },
    byReason,
    byCategory,
    areas,
    ...(unreadable.length ? { unreadable } : {}),
  };

  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  writeAtomic(unknownRatePath(root), JSON.stringify(out, null, 1) + '\n');
  const histPath = unknownRateHistoryPath(root);
  try {
    let prev = '';
    try { prev = readFileSync(histPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    writeAtomic(histPath, appendHistory(prev, historyPoint(nowIso, out.fleet.claim, { areas: areas.length, unreadable: unreadable.length })));
  } catch (e) {
    // the snapshot above stands; the history refuses to rewrite what it could not read
    console.error(`unknown-rate: history NOT appended (${histPath}): ${e.message}`);
    process.exitCode = 2;
  }
  console.log(`unknown-rate: ${render(fleet)} · ${areas.length} area(s)${unreadable.length ? ` · ${unreadable.length} UNREADABLE` : ''}`);
  const top = Object.entries(byReason).sort(([, a], [, b]) => b - a)[0];
  if (top) console.log(`  top reason: ${top[0]} (${top[1]} cell(s))`);
}

if (isMain) main();
