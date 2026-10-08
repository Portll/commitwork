#!/usr/bin/env node
// monitor/coincidence.mjs — correlation across artifact KINDS, on the wall clock.
//
// THE TECHNIQUE. Amnesty International's Pegasus confirmations are almost all of one shape: not
// "we found the malware" but "process `bh` executed ten seconds after Safari wrote a favicon and
// the installation server created an IndexedDB file". Neither store knew about the other. Neither
// event was suspicious alone — Safari writes favicons constantly and processes launch constantly.
// What carried the information was that two INDEPENDENT stores, with independent writers and
// independent clocks, showed a gap far tighter than either store's own rhythm.
//
// commitwork already has several such stores and has never joined them. Slice rows carry
// `generated`; the issue log carries `at` on every event; the verdict journal stamps every gate
// decision; git carries commit times. monitor/corroboration.mjs correlates ANALYSTS over one
// finding, and monitor/timeline2.mjs renders slices over time — neither asks whether two different
// KINDS of evidence keep suspicious company.
//
// WHAT MAKES A GAP INTERESTING, AND WHY IT IS NOT A FIXED WINDOW. "Within 60 seconds" is the
// obvious rule and it is the wrong one, because 60 seconds is unremarkable between a slice and the
// verdict that gated it and extraordinary between a commit and a host-inventory change. So the
// threshold is derived per ordered kind-pair from that pair's OWN gap population, by rank: a gap
// is interesting when it sits in the bottom percentile of the gaps that pair normally shows. No
// distribution is assumed, because none is known.
//
// A PAIR WITH TOO FEW SAMPLES HAS NO TAIL. Below `minSamples` there is nothing to be extreme
// relative to, so the pair reports `unexaminable` — the declared reason in monitor/unknown.mjs for
// exactly this — rather than flagging its own single observation as an outlier. Two events an hour
// apart look like a 0th-percentile coincidence when they are the only two you have.
//
// THESE ARE LEADS, NOT FINDINGS. Nothing here carries a severity, enters the issue store, or
// asserts a cause. A tight cross-kind gap is a place to look. The overwhelming majority will be
// one process legitimately triggering another, which is what an automated fleet DOES all day.
// Published as a verdict this would be the unsupported finding defect in a new costume.
//
// fact: the output is a RANKING, not a shortlist / a per-pair percentile necessarily fires on that percentile — ~14,000 verdict events over 14 days make `verdict→slice` alone contribute ~280 candidates by arithmetic, so reading the lead COUNT as a quantity of suspicion is reading arithmetic as evidence (expiry: never, prev: wrong)
// fact: what the report is FOR is the top of the sorted list — the tightest gaps relative to their own pair's rhythm — plus the per-pair table saying how normal that pair's tightness is (expiry: never, prev: unknown)
//
// usage: node monitor/coincidence.mjs [--json] [--area <slug>] [--days N]
//   env: CW_COINCIDENCE_PCTL     tail percentile        (default 2)
//        CW_COINCIDENCE_MIN      min samples per pair   (default 12)
//        CW_COINCIDENCE_MAXGAP   never report above this many seconds (default 900)
//        CW_COINCIDENCE_OUT      artifact path
//        CW_NOW                  pins `generated`

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';
import { issuesPathFor } from './store-paths.mjs';
import { unknown } from './unknown.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

export const DEFAULTS = Object.freeze({
  percentile: 2, minSamples: 12, maxGapSec: 900, maxHitFraction: 0.1,
});

/** The closed kind vocabulary. A kind is a STORE with its own writer, not a category of content —
 *  two kinds written by the same process share a clock and their coincidence means nothing. */
export const KIND = Object.freeze({
  SLICE: 'slice',
  ISSUE: 'issue-event',
  VERDICT: 'verdict',
  COMMIT: 'commit',
  ANNOTATION: 'annotation',
});

// ── event normalisation ─────────────────────────────────────────────────────────────────────────

/**
 * Sort into one stream, and COUNT what could not be placed on the clock. An event with an
 * unparseable timestamp is dropped from the correlation — there is nothing else to do with it —
 * but dropping it silently would shrink every denominator below without saying so.
 */
export function normaliseEvents(events) {
  const kept = [];
  let undated = 0;
  for (const e of events) {
    const t = Date.parse(e && e.at);
    if (!Number.isFinite(t)) { undated += 1; continue; }
    kept.push({ kind: e.kind, at: e.at, t, label: e.label ?? null, ref: e.ref ?? null });
  }
  // Stable and total: time, then kind, then label — so two events sharing a millisecond do not
  // reorder between runs and change which one a gap is measured from.
  kept.sort((a, b) => a.t - b.t || cmp(a.kind, b.kind) || cmp(a.label, b.label));
  return { events: kept, undated };
}

const cmp = (a, b) => (a === b ? 0 : (a ?? '') < (b ?? '') ? -1 : 1);

/**
 * For every ordered pair of DIFFERENT kinds, the gap from each A-event to the next B-event after
 * it. Self-pairs are excluded: a store's cadence with itself is its cadence, not a coincidence.
 */
export function crossKindGaps(events) {
  const kinds = [...new Set(events.map((e) => e.kind))].sort();
  const byKind = new Map(kinds.map((k) => [k, events.filter((e) => e.kind === k)]));
  const out = new Map();

  for (const a of kinds) {
    for (const b of kinds) {
      if (a === b) continue;
      const bs = byKind.get(b);
      const rows = [];
      let bi = 0;
      for (const ev of byKind.get(a)) {
        // bs is sorted; advance a single cursor rather than rescanning (both are time-ordered).
        while (bi < bs.length && bs[bi].t <= ev.t) bi += 1;
        if (bi >= bs.length) break;
        rows.push({ from: ev, to: bs[bi], gapSec: (bs[bi].t - ev.t) / 1000 });
      }
      out.set(`${a}→${b}`, rows);
    }
  }
  return out;
}

/** Rank-based tail threshold: the gap value at the given percentile of a sorted population. No
 *  distributional assumption, because none is warranted. */
export function percentileGap(sortedGaps, pctl) {
  if (!sortedGaps.length) return null;
  const idx = Math.max(0, Math.min(sortedGaps.length - 1, Math.floor((pctl / 100) * sortedGaps.length)));
  return sortedGaps[idx];
}

/**
 * The sweep. Returns leads plus, crucially, the pairs that could NOT be examined — a report whose
 * lead list is empty because every pair was too sparse has found nothing and proved nothing, and
 * the two must not print the same way.
 */
export function findCoincidences(rawEvents, opts = {}) {
  const percentile = opts.percentile ?? DEFAULTS.percentile;
  const minSamples = opts.minSamples ?? DEFAULTS.minSamples;
  const maxGapSec = opts.maxGapSec ?? DEFAULTS.maxGapSec;

  const { events, undated } = normaliseEvents(rawEvents);
  const gaps = crossKindGaps(events);

  const leads = [];
  const pairs = [];
  for (const [pair, rows] of [...gaps.entries()].sort(([a], [b]) => cmp(a, b))) {
    if (rows.length < minSamples) {
      pairs.push({
        pair, samples: rows.length,
        ...unknown('unexaminable', `${rows.length} sample(s); ${minSamples} needed before a tail exists`),
      });
      continue;
    }
    const sorted = rows.map((r) => r.gapSec).sort((x, y) => x - y);
    const threshold = percentileGap(sorted, percentile);
    const median = percentileGap(sorted, 50);
    // Three gates, and none of them is redundant.
    // fact: `cut` is the absolute bound / a fleet firing in lockstep can have a p2 threshold of four hours, and four hours is not a coincidence in any story (expiry: never, prev: missing)
    // fact: `< median` — a gap EQUAL to the pair's median is by definition typical / without it the percentile alone flags a uniform population entirely: 40 gaps of exactly 2s give p2 = 2, `gap <= 2` matches all 40, and the pair reports 100% leads, caught by the test below and not by reading the code (expiry: never, prev: missing)
    // fact: `fraction` — a pair whose leads exceed maxHitFraction of its own population is bimodal, not anomalous, so it reports its SHAPE and emits nothing / a lane firing on ~100% of a population is a defect in the lane (CLAUDE.md) (expiry: never, prev: missing)
    //
    // THE ORDER OF THE LAST TWO MATTERS, and getting it wrong is not visible by reading. Collapse
    // FIRST, then measure the fraction: a burst of nine antecedents hitting one consequence is ONE
    // coincidence, and counting it as nine made a legitimate lone lead look like 18% of its pair
    // and suppressed it. Caught by the burst test, having been written the other way round.
    const cut = Math.min(threshold, maxGapSec);
    const candidates = rows.filter((r) => r.gapSec <= cut && r.gapSec < median);
    // fact: leads collapse on the CONSEQUENCE, because the unit of interest is "what fired right after this" / a burst of antecedents — 200 issue-opened events in one batch, six gate verdicts a millisecond apart — each pairs with the SAME next event, turning one coincidence into two hundred (live stores 2026-08-26: 979 raw leads over 14 days, nine of them the identical issue-opened→sweep-20260813210000 pair at one timestamp) (expiry: never, prev: wrong)
    // fact: the gap kept is the tightest and the number collapsed is PUBLISHED as `antecedents`, never discarded (expiry: never, prev: unknown)
    const byConsequence = new Map();
    for (const h of candidates) {
      const k = `${h.to.kind}\0${h.to.at}\0${h.to.ref ?? ''}\0${h.to.label ?? ''}`;
      const prev = byConsequence.get(k);
      if (!prev || h.gapSec < prev.gapSec) byConsequence.set(k, { ...h, antecedents: (prev?.antecedents ?? 0) + 1 });
      else prev.antecedents += 1;
    }
    const fraction = byConsequence.size / rows.length;
    const degenerate = fraction > (opts.maxHitFraction ?? DEFAULTS.maxHitFraction);
    pairs.push({
      pair, samples: rows.length, thresholdSec: threshold, cutSec: cut, median,
      hits: candidates.length, coincidences: degenerate ? 0 : byConsequence.size,
      ...(degenerate
        ? {
          degenerate: true, candidateFraction: round3(fraction),
          note: 'collapsed coincidences exceeded the fraction ceiling - this pair is bimodal, and its mode is not a lead',
        }
        : {}),
    });
    if (degenerate) continue;

    for (const h of byConsequence.values()) {
      leads.push({
        pair, gapSec: round3(h.gapSec),
        // The pair's own rhythm, carried alongside — a 3-second gap means nothing without it.
        pairMedianSec: round3(median),
        antecedents: h.antecedents,
        from: { kind: h.from.kind, at: h.from.at, label: h.from.label, ref: h.from.ref },
        to: { kind: h.to.kind, at: h.to.at, label: h.to.label, ref: h.to.ref },
      });
    }
  }

  leads.sort((a, b) => a.gapSec - b.gapSec || cmp(a.pair, b.pair) || cmp(a.from.at, b.from.at));

  const unexaminable = pairs.filter((p) => p.unknown);
  return {
    generated: process.env.CW_NOW || new Date().toISOString(),
    events: events.length,
    undated,
    kinds: [...new Set(events.map((e) => e.kind))].sort(),
    pairsExamined: pairs.length - unexaminable.length,
    pairsUnexaminable: unexaminable.length,
    // An empty `leads` says nothing at all unless this is true.
    examinedAnything: pairs.length > unexaminable.length,
    settings: { percentile, minSamples, maxGapSec },
    pairs,
    leads,
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

// ── collectors ──────────────────────────────────────────────────────────────────────────────────
// Each returns events; each tolerates its store being absent, because the correlation is worth
// running on whatever subset exists. What it must not do is pretend the store was empty — the
// collector's `missing` list rides along into the report.

export function eventsFromHistoryIndex(historyDir) {
  const p = join(historyDir, 'index.json');
  let rows;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    rows = Array.isArray(parsed) ? parsed : (parsed.rows || parsed.slices || []);
  } catch (e) {
    return { events: [], missing: [{ source: p, reason: e.code === 'ENOENT' ? 'absent' : 'unparseable' }] };
  }
  return {
    events: rows.filter((r) => r && r.generated).map((r) => ({
      kind: KIND.SLICE, at: r.generated, label: r.sliceId || r.file || null, ref: r.file || null,
    })),
    missing: [],
  };
}

export function eventsFromIssueStore(storePath) {
  let store;
  try {
    store = JSON.parse(readFileSync(storePath, 'utf8'));
  } catch (e) {
    return { events: [], missing: [{ source: storePath, reason: e.code === 'ENOENT' ? 'absent' : 'unparseable' }] };
  }
  const evs = Array.isArray(store.events) ? store.events : [];
  return {
    events: evs.filter((e) => e && e.at).map((e) => ({
      kind: KIND.ISSUE, at: e.at, label: e.type || null, ref: e.issueId || null,
    })),
    missing: Array.isArray(store.events) ? [] : [{ source: storePath, reason: 'not-recorded' }],
  };
}

export function eventsFromVerdictJournal(journalDir) {
  let names;
  try { names = readdirSync(journalDir); } catch (e) {
    return { events: [], missing: [{ source: journalDir, reason: e.code === 'ENOENT' ? 'absent' : 'not-permitted' }] };
  }
  const events = [];
  const missing = [];
  for (const n of names.sort()) {
    if (!/\.jsonl(\.\d+)?$/.test(n)) continue;
    const p = join(journalDir, n);
    let lines;
    try { lines = readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { missing.push({ source: p, reason: 'not-permitted' }); continue; }
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec && rec.at) events.push({ kind: KIND.VERDICT, at: rec.at, label: rec.gate || rec.verdict || null, ref: n });
      } catch { /* one bad line is not a bad journal; the chain check owns that question */ }
    }
  }
  return { events, missing };
}

export async function eventsFromGit(repoDir, sinceDays) {
  const { execFileSync } = await import('node:child_process');
  try {
    const out = execFileSync('git', [
      '-C', repoDir, 'log', `--since=${sinceDays}.days`, '--format=%aI%x09%h%x09%s',
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return {
      events: out.split('\n').filter(Boolean).map((l) => {
        const [at, sha, subject] = l.split('\t');
        return { kind: KIND.COMMIT, at, label: (subject || '').slice(0, 120), ref: sha };
      }),
      missing: [],
    };
  } catch (e) {
    return { events: [], missing: [{ source: `git:${repoDir}`, reason: 'tool-failed' }] };
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const asJson = argv.includes('--json');
  const days = Number(flag('--days')) || 30;

  const { outDirFor, reportsRootDir } = await import('./area.mjs');
  const areaSlug = flag('--area');
  const outDir = process.env.CW_MONITOR_OUT ? resolve(process.env.CW_MONITOR_OUT)
    : areaSlug ? outDirFor(areaSlug) : null;

  const historyDirs = outDir ? [join(outDir, 'history')].filter(existsSync)
    : safeReaddir(reportsRootDir()).map((n) => join(reportsRootDir(), n, 'history')).filter(existsSync);

  const collected = [
    ...historyDirs.map(eventsFromHistoryIndex),
    eventsFromIssueStore(issuesPathFor(REPO)),
    eventsFromVerdictJournal(process.env.CW_VERDICT_DIR || join(REPO, '.claude', 'verdicts')),
    await eventsFromGit(REPO, days),
  ];

  const cutoff = Date.now() - days * 86400_000;
  const all = collected.flatMap((c) => c.events).filter((e) => {
    const t = Date.parse(e.at);
    return !Number.isFinite(t) || t >= cutoff;
  });
  const missing = collected.flatMap((c) => c.missing);

  const report = {
    ...findCoincidences(all, {
      percentile: Number(process.env.CW_COINCIDENCE_PCTL) || DEFAULTS.percentile,
      minSamples: Number(process.env.CW_COINCIDENCE_MIN) || DEFAULTS.minSamples,
      maxGapSec: Number(process.env.CW_COINCIDENCE_MAXGAP) || DEFAULTS.maxGapSec,
    }),
    windowDays: days,
    sourcesMissing: missing,
  };

  const outPath = process.env.CW_COINCIDENCE_OUT || join(outDir || REPO, 'coincidence.json');
  writeAtomic(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`coincidence: ${report.events} event(s) over ${days}d across ${report.kinds.length} kind(s): ${report.kinds.join(', ')}`);
  if (report.undated) console.log(`  ${report.undated} event(s) carried no parseable timestamp and are outside the correlation`);
  for (const p of report.pairs) {
    if (p.unknown) { console.log(`  UNEXAMINABLE  ${p.pair.padEnd(28)} ${p.unknownDetail}`); continue; }
    console.log(`  ${p.pair.padEnd(28)} n=${String(p.samples).padStart(5)}  median ${fmt(p.median)}  cut ${fmt(p.cutSec)}  hits ${p.hits}`
      + `${p.degenerate ? `  BIMODAL (${(p.candidateFraction * 100).toFixed(0)}% of the pair sits below its own median — suppressed)` : ''}`);
  }
  for (const l of report.leads.slice(0, 20)) {
    console.log(`  LEAD  ${fmt(l.gapSec)} (pair median ${fmt(l.pairMedianSec)})  ${l.from.kind}:${l.from.label ?? l.from.ref} → ${l.to.kind}:${l.to.label ?? l.to.ref}  @ ${l.from.at}`);
  }
  if (report.leads.length > 20) console.log(`  … ${report.leads.length - 20} more lead(s) in the artifact`);
  for (const m of report.sourcesMissing) console.log(`  source unread: ${m.source} (${m.reason})`);
  if (!report.examinedAnything) {
    console.log('coincidence: NOTHING WAS EXAMINABLE — every pair fell below the sample floor. '
      + 'An empty lead list here is silence, not a clean result.');
  }
  console.log(`coincidence: ${report.leads.length} lead(s) — ${outPath}`);
}

const fmt = (s) => (s == null ? '—' : s < 90 ? `${round3(s)}s` : s < 5400 ? `${(s / 60).toFixed(1)}m` : `${(s / 3600).toFixed(1)}h`);

function safeReaddir(d) { try { return readdirSync(d).sort(); } catch { return []; } }

if (isMain) {
  main().catch((e) => { console.error(`coincidence: ${(e && e.stack) || e}`); process.exitCode = 2; });
}
