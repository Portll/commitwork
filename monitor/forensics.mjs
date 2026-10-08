#!/usr/bin/env node
// monitor/forensics.mjs — the one entry point for the forensic lanes, and the thing that FEEDS them.
//
// WHY THIS EXISTS. The six lanes landed as libraries with CLIs and nothing invoking
// them. That is the defect this repository names most often — built, tested, fed by nothing — and
// it is worth being blunt that it was committed knowingly, with the gap written into the commit
// message, rather than discovered later. This closes it: one call from monitor/sweep.mjs, one
// artifact, and every lane either runs or says why it did not.
//
// fact: a lane with no input reports `not-configured`, NEVER zero / "0 matches" every sweep forever is indistinguishable from a fleet checked against a real indicator set and found clean (expiry: never, prev: broken)
// fact: indicators.mjs (no bundle), lookalike.mjs (no declared-legitimate set) and host-baseline.mjs (no accepted baseline) are OFF by default and SAY SO on every run / any other rendering manufactures a reassuring number out of nothing (expiry: if any of the three gains a default input, prev: broken)
//
// NOTHING HERE IS FATAL AND NOTHING HERE FILES A FINDING. Every lane is wrapped; a lane that
// throws is recorded as failed and the sweep continues. None of them writes to the issue store,
// carries a severity, or asserts a cause — they produce leads and inventories a human reads.
//
// usage: node monitor/forensics.mjs [--json]
//   env: CW_FORENSICS_OUT       artifact path (default reports/forensics.json)
//        CW_INDICATOR_BUNDLE    STIX2 bundle to match the corpus against; unset ⇒ lane off
//        CW_LEGIT_PACKAGES      declared-legitimate package list; unset ⇒ lookalike off
//        CW_HOST_BASELINE       accepted host baseline; absent ⇒ host-baseline reports no-reference
//        CW_FORENSICS_SKIP      comma-separated lane names to skip
//        CW_NOW                 pins `generated`

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';
import { unknown } from './unknown.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

// One resolver for the writer and its readers (admin/routes/correlations.mjs).
export const forensicsOutPath = () => process.env.CW_FORENSICS_OUT || join(REPO, 'reports', 'forensics.json');

/** The lanes, in the order they are reported. Declared here so a lane cannot be added by being
 *  called — the roster and the runner are the same list. */
export const LANES = Object.freeze([
  'store-consistency', 'observables', 'indicators', 'lookalike', 'coincidence', 'host-baseline',
]);

const notConfigured = (what, how) => ({
  ...unknown('no-reference', `${what} — ${how}`),
  configured: false,
  // Stated on every run so an unconfigured lane never reads as a checked one.
  note: 'this lane produced NO result. That is not a zero, and it is not a clean result.',
});

/**
 * Run every lane that has an input. `deps` exists so the tests can drive the orchestration without
 * a fleet, a docker daemon or an lsof — the point under test is the CONFIGURATION logic, and a
 * test that needs 170 repos to prove "an unconfigured lane reports not-configured" proves nothing.
 */
export async function runForensics(opts = {}) {
  const skip = new Set(String(process.env.CW_FORENSICS_SKIP || '').split(',').map((s) => s.trim()).filter(Boolean));
  const lanes = {};
  const deps = opts.deps || {};

  const run = async (name, fn) => {
    if (skip.has(name)) { lanes[name] = { skipped: true, why: 'CW_FORENSICS_SKIP' }; return null; }
    try {
      const r = await fn();
      lanes[name] = r;
      return r;
    } catch (e) {
      // A failed lane is `failed`, never an empty result — see the house rule on fail-closed.
      lanes[name] = { failed: true, error: String((e && e.message) || e) };
      return null;
    }
  };

  // ── store-consistency: no configuration, always runs ──────────────────────────────────────────
  await run('store-consistency', async () => {
    const { runConsistency } = deps.storeConsistency || await import('./store-consistency.mjs');
    const { issuesPathFor } = await import('./store-paths.mjs');
    const issueStorePath = issuesPathFor(REPO);
    const historyDirs = await (deps.historyDirs ? deps.historyDirs() : defaultHistoryDirs());
    const r = runConsistency({ issueStorePath, historyDirs });
    return {
      configured: true, complete: r.complete, totals: r.totals,
      pairsChecked: r.pairsChecked, pairsUnknown: r.pairsUnknown,
      anomalies: r.pairs.flatMap((p) => p.anomalies.map((a) => ({ pair: p.pair, ...a }))).slice(0, 50),
    };
  });

  // ── observables: the corpus everything downstream needs ───────────────────────────────────────
  const corpusLane = await run('observables', async () => {
    const { collectFleet } = deps.observables || await import('./observables.mjs');
    const repos = await (deps.repos ? deps.repos() : defaultRepos());
    const r = collectFleet(repos);
    return {
      configured: true, corpusSize: r.corpusSize, rawObservables: r.rawObservables,
      byType: r.byType, hosts: r.hosts.slice(0, 25), voidsByKind: r.voidsByKind,
      coverage: r.coverage, unreadable: r.unreadable.slice(0, 20),
      // Held for the two lanes below, not published in the artifact — 25k rows would dwarf it.
      _corpus: r.corpus,
    };
  });
  const corpus = corpusLane && corpusLane._corpus ? corpusLane._corpus : null;
  if (corpusLane) delete corpusLane._corpus;

  // ── indicators: OFF unless a bundle is declared ───────────────────────────────────────────────
  await run('indicators', async () => {
    const bundlePath = process.env.CW_INDICATOR_BUNDLE;
    if (!bundlePath) {
      return notConfigured('no indicator bundle is declared',
        'set CW_INDICATOR_BUNDLE to a STIX 2 bundle. Until then this fleet is matched against '
        + 'NOTHING, which is a coverage void and not a clean result');
    }
    if (!existsSync(bundlePath)) {
      return { ...unknown('absent', `CW_INDICATOR_BUNDLE=${bundlePath} does not exist`), configured: true };
    }
    if (!corpus) {
      return { ...unknown('no-subject', 'the observable corpus could not be built, so there was nothing to match'), configured: true };
    }
    const { parseStixBundle, matchIndicators, coverageSentence } = deps.indicators || await import('./indicators.mjs');
    const set = parseStixBundle(JSON.parse(readFileSync(bundlePath, 'utf8')), { source: bundlePath });
    const r = matchIndicators([set], corpus.map((o) => ({ type: o.type, value: o.value, where: o.where[0] })));
    return {
      configured: true, bundle: bundlePath,
      matchCount: r.matchCount, matches: r.matches.slice(0, 50),
      indicatorsApplied: r.indicatorsApplied, indicatorsRejected: r.indicatorsRejected,
      appliedFraction: r.appliedFraction, complete: r.complete,
      coverage: coverageSentence(r),
    };
  });

  // ── lookalike: OFF unless a DECLARED legitimate set exists ────────────────────────────────────
  await run('lookalike', async () => {
    const legitPath = process.env.CW_LEGIT_PACKAGES;
    if (!legitPath) {
      return notConfigured('no declared-legitimate package set',
        'set CW_LEGIT_PACKAGES to a human-authored list. Deriving one from the corpus would '
        + 'bootstrap whatever is already present into legitimacy, which is exactly what a squat '
        + 'is counting on');
    }
    if (!existsSync(legitPath)) {
      return { ...unknown('absent', `CW_LEGIT_PACKAGES=${legitPath} does not exist`), configured: true };
    }
    if (!corpus) {
      return { ...unknown('no-subject', 'the observable corpus could not be built'), configured: true };
    }
    const { sweepLookalikes } = deps.lookalike || await import('./lookalike.mjs');
    const legit = new Set(JSON.parse(readFileSync(legitPath, 'utf8')));
    const { OBSERVABLE } = deps.indicators || await import('./indicators.mjs');
    const names = corpus.filter((o) => o.type === OBSERVABLE.PACKAGE).map((o) => ({ name: o.value, where: o.where[0] }));
    const r = sweepLookalikes(names, legit);
    return {
      configured: true, declaredSet: legitPath, declaredSize: legit.size,
      findingCount: r.findingCount, findings: r.findings.slice(0, 50),
      noDeclaredNeighbour: r.noDeclaredNeighbour, coverage: r.coverage,
    };
  });

  // ── coincidence: always runs; its inputs are this repository's own stores ──────────────────────
  await run('coincidence', async () => {
    const mod = deps.coincidence || await import('./coincidence.mjs');
    const days = Number(process.env.CW_COINCIDENCE_DAYS) || 14;
    const { issuesPathFor } = await import('./store-paths.mjs');
    const collected = [
      mod.eventsFromIssueStore(issuesPathFor(REPO)),
      mod.eventsFromVerdictJournal(process.env.CW_VERDICT_DIR || join(REPO, '.claude', 'verdicts')),
      await mod.eventsFromGit(REPO, days),
      ...(await (deps.historyDirs ? deps.historyDirs() : defaultHistoryDirs())).map(mod.eventsFromHistoryIndex),
    ];
    const cutoff = Date.now() - days * 86400_000;
    const events = collected.flatMap((c) => c.events).filter((e) => {
      const t = Date.parse(e.at);
      return !Number.isFinite(t) || t >= cutoff;
    });
    const r = mod.findCoincidences(events);
    return {
      configured: true, windowDays: days, events: r.events, kinds: r.kinds,
      pairsExamined: r.pairsExamined, pairsUnexaminable: r.pairsUnexaminable,
      examinedAnything: r.examinedAnything,
      leadCount: r.leads.length, leads: r.leads.slice(0, 25),
      sourcesMissing: collected.flatMap((c) => c.missing),
    };
  });

  // ── host-baseline: runs, but reports no-reference until a human accepts one ───────────────────
  await run('host-baseline', async () => {
    const mod = deps.hostBaseline || await import('./host-baseline.mjs');
    const base = mod.readBaseline();
    if (base.unknown) {
      return {
        configured: false,
        ...unknown(base.unknownReason, base.unknownReason === 'absent'
          ? 'no host baseline has been accepted — run `node monitor/host-baseline.mjs --accept` '
            + 'once the current listening surface has been reviewed. Accepting one is a human act '
            + 'and is deliberately not done here.'
          : base.unknownDetail),
        note: 'this lane produced NO result. That is not a zero, and it is not a clean result.',
      };
    }
    const { inventory } = deps.hostInventory || await import('./host-inventory.mjs');
    const diff = mod.diffAgainstBaseline(base.value, inventory());
    return {
      configured: true, usable: diff.usable,
      ...(diff.usable
        ? {
          counts: diff.counts, absenceAssertable: diff.absenceAssertable,
          ephemeralExcluded: diff.ephemeralExcluded,
          changes: diff.changes.filter((c) => c.change !== 'unchanged').slice(0, 25),
          baselineAcceptedAt: diff.baselineAcceptedAt,
        }
        : { unknownReason: diff.unknownReason, unknownDetail: diff.unknownDetail }),
    };
  });

  const configured = LANES.filter((l) => lanes[l] && lanes[l].configured === true).length;
  const unconfigured = LANES.filter((l) => lanes[l] && lanes[l].configured === false);
  const failed = LANES.filter((l) => lanes[l] && lanes[l].failed);

  return {
    generated: process.env.CW_NOW || new Date().toISOString(),
    lanesRun: configured,
    lanesTotal: LANES.length,
    lanesUnconfigured: unconfigured,
    lanesFailed: failed,
    // The headline nobody may read past. `complete` is false whenever any lane had no input.
    complete: unconfigured.length === 0 && failed.length === 0,
    lanes,
  };
}

async function defaultHistoryDirs() {
  const { reportsRootDir } = await import('./area.mjs');
  const { readdirSync } = await import('node:fs');
  const root = reportsRootDir();
  let names = [];
  try { names = readdirSync(root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return names.sort().map((n) => join(root, n, 'history')).filter(existsSync);
}

async function defaultRepos() {
  const { loadRegistry } = await import('./registry.mjs');
  const { resolveRepos } = await import('./discover.mjs');
  return resolveRepos(loadRegistry()).repos || [];
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const report = await runForensics();
  const outPath = forensicsOutPath();
  writeAtomic(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`forensics: ${report.lanesRun}/${report.lanesTotal} lane(s) had an input`);
  const L = report.lanes;

  if (L['store-consistency']?.configured) {
    const t = L['store-consistency'].totals;
    console.log(`  store-consistency  ${t.orphan} orphan, ${t.widow} widow, ${t.mismatch} mismatch`
      + `${L['store-consistency'].complete ? '' : `  (INCOMPLETE — ${L['store-consistency'].pairsUnknown} pair(s) unreadable; the totals are a floor)`}`);
  }
  if (L.observables?.configured) {
    const o = L.observables;
    console.log(`  observables        ${o.corpusSize} distinct from ${o.rawObservables} raw; top origin ${o.hosts[0]?.host ?? '—'} (${o.hosts[0]?.references ?? 0})`);
    const voids = Object.entries(o.voidsByKind || {});
    if (voids.length) console.log(`                     declared unread: ${voids.map(([k, n]) => `${k}×${n}`).join(', ')}`);
  }
  if (L.coincidence?.configured) {
    const c = L.coincidence;
    console.log(`  coincidence        ${c.leadCount} lead(s) over ${c.events} event(s), ${c.pairsExamined} pair(s) examined`
      + `${c.examinedAnything ? '' : '  (NOTHING EXAMINABLE — an empty lead list here is silence)'}`);
    for (const l of c.leads.slice(0, 3)) console.log(`                     ${l.gapSec}s (pair median ${l.pairMedianSec}s)  ${l.from.kind} → ${l.to.kind}`);
  }
  if (L.indicators?.configured) console.log(`  indicators         ${L.indicators.matchCount} match(es) — ${L.indicators.coverage}`);
  if (L.lookalike?.configured) console.log(`  lookalike          ${L.lookalike.findingCount} finding(s) against ${L.lookalike.declaredSize} declared`);
  if (L['host-baseline']?.configured && L['host-baseline'].usable) {
    const c = L['host-baseline'].counts;
    console.log(`  host-baseline      ${c.new} new, ${c.changed} changed, ${c.gone} gone, ${c.unknown} unknown`
      + `${L['host-baseline'].absenceAssertable ? '' : '  (socket table unread — nothing reported gone)'}`);
  }

  for (const lane of report.lanesUnconfigured) {
    const l = L[lane];
    console.log(`  NOT CONFIGURED     ${lane} — ${l.unknownDetail || l.unknownReason}`);
  }
  for (const lane of report.lanesFailed) console.log(`  FAILED             ${lane} — ${L[lane].error}`);

  if (!report.complete) {
    console.log('forensics: INCOMPLETE — a lane with no input produced no result. '
      + 'None of the absences above is a clean finding.');
  }
  console.log(`forensics: ${outPath}`);
}

if (isMain) {
  main().catch((e) => { console.error(`forensics: ${(e && e.stack) || e}`); process.exitCode = 2; });
}
