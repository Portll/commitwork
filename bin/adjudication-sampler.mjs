#!/usr/bin/env node
// Adjudication sampler: per-stratum coverage, rates-as-records, and a ranked adjudication queue.
// A rate here is a RECORD carrying its denominator and an `observable` flag — never a bare number,
// so absence can never read as zero. Proposals only: nothing here mutates anything.
import { readJournalFile, readJournal, TRUTHS, retractionsFrom } from './lib/verdict-journal-core.mjs';
import { rethrowIfBug } from './rethrow.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Read env at call time — a const at import defeats test overrides.
const dirFor = () => process.env.CW_VERDICT_DIR || join(REPO, '.claude', 'verdicts');

// ── THE REGISTRY IS THE POPULATION, NOT THE FILESYSTEM ──────────────────────────────────────────
// A gate that never wrote has no evidence, not no problems. `clean`/`alarm` are enumerated; an
// unlisted verdict is `unclassified`, never defaulted into a stratum. `neither` is a real third
// answer, which keeps clean + alarm + neither === total.
export const GATE_REGISTRY = {
  // THE BEHAVIOURAL GATE over a session's own transcript (bin/turn-gate.mjs). Its verdicts are
  // weaker evidence than every other gate here: the rest read exit codes, tallies and ledgers,
  // while this one infers from text a model wrote. That is an argument for sampling it MORE
  // carefully, not for leaving it out — an unclassified gate contributes to no denominator, so its
  // false alarms would never surface in the rates that decide whether anyone should trust it.
  //
  // `unknown` is emphatically NEITHER, and it is the outcome this gate reaches most often when
  // something is wrong with the RECORD rather than the session: unparseable transcript lines mean
  // the denominator is unknown, so every rate above it is a guess. Calling that clean would let a
  // corrupt transcript certify a session; calling it alarm would accuse one for a reader's fault.
  //
  // factFields are `subject` and `outcome` — which session, and what was concluded. `reason` is
  // prose and deliberately excluded on the same principle as oversight's `basis`: rewording why a
  // session was blocked does not change that it was. `policy` is excluded for the opposite reason
  // and it is worth naming: a threshold change DOES alter meaning, but it alters it for every
  // record at once, which is a re-scoring event rather than a per-record fact change.
  // THE LOCAL HALF OF THE OFF-BOX WATCHER (bin/offbox-watch-check.mjs). It classifies the freshness
  // and verdict of a ledger written on another machine, so its alarm states divide cleanly: ALARM is
  // the remote watcher's own alarm relayed verbatim, while the three STALE/FAILING states are this
  // check's own finding that the off-box half stopped running. The unknown states are NEITHER and
  // are the reason this gate is registered at all — 'no-ledger' means never observed, which must not
  // land in the clean stratum and so certify a watcher that has never run.
  //
  // factFields are 'state' and 'ledgerAgeH': which answer, and the measurement it rests on. 'paged'
  // is excluded — where an alarm was routed is a fact about the route, not about the finding, and it
  // changes when a webhook is declared without the underlying state changing at all.
  'offbox-watch': {
    verdictField: 'state',
    clean: ['ok'],
    alarm: ['ALARM', 'STALE-LEDGER', 'STALE-WITNESS', 'WORKFLOW-FAILING'],
    neither: ['no-ledger', 'offline', 'not-permitted', 'no-repository', 'unreadable-ledger'],
    factFields: ['state', 'ledgerAgeH'],
  },
  'turn-gate': {
    verdictField: 'outcome',
    clean: ['pass'],
    alarm: ['block'],
    neither: ['unknown'],
    factFields: ['subject', 'outcome'],
  },
  // HUMAN OVERSIGHT (lib/oversight.mjs). It belongs in the registry rather than in the test's
  // ROSTER_ONLY escape hatch, whose stated reason is 'no verdict vocabulary to classify' — this
  // one HAS a vocabulary, so claiming the exemption would be a false declaration to silence a
  // true alarm.
  //
  // `dispute` is an ALARM and not a curiosity: it is a human stating that a determination this
  // fleet published is wrong. That is the most expensive kind of finding the repository can
  // carry, because it is the one a reader can check.
  //
  // `corroborate` is CLEAN in the only sense this stratum means: a claim was examined and no
  // fault was found. There is no `neither` stratum, and that is deliberate — an oversight record
  // exists BECAUSE somebody looked, so 'no claim was made' cannot arise. The absence of any
  // record is the undetermined case, and it lives outside this file, in overseenBy()'s 'none'.
  oversight: {
    verdictField: 'stance',
    clean: ['corroborate'],
    alarm: ['dispute'],
    neither: [],
    // `basis` is prose and is deliberately NOT a fact field: an author rewording why they signed
    // has not changed what they signed. `stance` and `who` are the record's whole meaning.
    factFields: ['stance', 'who'],
  },
  'gate-tests': {
    verdictField: 'verdict',
    clean: ['steady'],
    alarm: ['regression-uncommitted', 'regression-committed', 'coverage-loss', 'coverage-transient'],
    // NEITHER, both of them, and for the two different reasons this stratum exists.
    // `floor-lowered` is the gate re-arming itself at a better baseline — the live records show the
    // fail count IMPROVING against the stored floor (14 -> 12, 12 -> 11). It is bookkeeping, not a
    // claim that the tree is clean, and it is the same shape as gate-ratchet's `baseline-set`.
    // `no-tally` is a REFUSAL — bin/canary-harness.mjs REFUSALS declares it as declining to judge
    // because a sensor is blind, and says in terms that a refusal is "never scored as a clean read".
    // It must not be alarm either: blindness is not a finding. Undetermined belongs in its own
    // field, outside the clean/alarm split, which is the house rule this stratum implements.
    // `armed` is the FIRST run: no baseline existed, so no comparison happened and no clean-or-alarm
    // claim was possible — the same shape as gate-ratchet's `baseline-set`.
    // `regression-unattributed` is that same shape reached from the other direction, and the rule
    // above already decides it: gate-tests-core.mjs:39 emits it when `!head || head.fail === null`,
    // i.e. the gate could not establish a HEAD baseline to compare against, so — exactly as with
    // `armed` — no comparison happened and neither a clean nor an alarm claim was available. It is
    // NOT clean: the tree may well have regressed and the gate simply could not tell. It is NOT
    // alarm: the gate found no regression, it found no BASELINE, and reporting a blind instrument
    // as a finding is the over-report this repository refuses in the same breath as the under-report.
    // Observed live 2026-08-29 after a baseline reset left the gate with no commit range to read.
    // `regression-disk-undetermined` is that same shape reached from a THIRD direction, and the same
    // rule decides it: bin/gate-tests.mjs refuses to attribute a run whose disk was full or could not
    // be read, because ENOSPC here is swallowed by bare catches and surfaces as unrelated red across
    // write-touching suites. Measured 2026-08-30, four such failures were published as "committed and
    // attributable" in one day; three passed 12/12 standalone once the volume was clear. NOT clean —
    // the tree may have regressed and the instrument could not tell. NOT alarm — a blind sensor is
    // not a finding. Same stratum as `no-tally`, and for the identical reason.
    // `regression-incomparable` (R17, 2026-08-30) is `regression-unattributed` reached from a THIRD
    // direction. There, no HEAD baseline could be established at all. Here one was, but HEAD ran
    // FEWER cases than the tree, so absence from HEAD's failures cannot mean "it passed" — it may
    // simply never have run. Nothing could be placed, and naming a culprit for a comparison that
    // did not happen is the defect the verdict exists to avoid. Refusal, therefore neither.
    // `deferred` (bin/gate-tests.mjs) is the gate declining to run while another run holds the
    // suite lock. No suite ran, no comparison happened, no claim was made either way. It is
    // journalled precisely to make the rate of declining measurable. A refusal on the same rule as
    // `no-tally`, therefore neither.
    // `regression-undetermined` (bin/gate-tests-core.mjs) is a regression the gate saw and could
    // not place. HEAD's own control run was degraded and the failures cannot be called committed
    // or uncommitted. Not clean, the failures exist. Not alarm, no culprit was established. The
    // rule that decides `regression-disk-undetermined` decides this one. Neither.
    neither: ['floor-lowered', 'no-tally', 'armed', 'regression-unattributed', 'regression-disk-undetermined', 'regression-incomparable', 'deferred', 'regression-undetermined'],
    // Fields the message derives from; deliveryReport finds suppressed records whose facts moved.
    factFields: ['verdict', 'fail', 'pass'],
  },
  'gate-ratchet': {
    verdictField: 'verdict',
    clean: ['steady'],
    alarm: ['worse'],
    // `baseline-set`/`armed` are the gate arming itself — no clean/alarm claim was made. `improved`
    // is the ratchet tightening its own baseline: bookkeeping, like gate-tests' `floor-lowered`.
    // `degraded` is a BLIND SENSOR: the live records carry ok:false, exit 2 and all-null metrics, so
    // no comparison against the baseline happened. It is not liveness's same-named alarm verdict,
    // which is why every gate declares its own vocabulary instead of sharing one.
    neither: ['baseline-set', 'armed', 'improved', 'degraded'],
    factFields: ['verdict', 'metrics'],
  },
  'docs-doctor': {
    verdictField: 'verdict',
    clean: ['green'],
    alarm: ['orange', 'grey-only'],
    neither: [],
  },
  // Verdict is the boolean `block`; matched by identity, so `false` is a value, not an absence.
  'gate-spine': {
    // Keys on `verdict`, like every other gate. It keyed on `block` with clean:[false], so all four
    // of assess()'s GREY verdicts — which fail open and therefore carry block:false — landed in the
    // clean stratum. Measured 2026-08-29: 110 of 993 records, 11%, scored as passes by the sampler
    // whose denominators exist to stop exactly that. All 993 already carry `verdict`, so this
    // reclassifies the history rather than orphaning it.
    verdictField: 'verdict',
    clean: ['below-threshold', 'satisfied'],
    alarm: ['no-spine-record', 'decoy-suspected'],
    // The blind-sensor family: the gate declining to judge. Not a pass, not a finding.
    // `overwatch-unreachable` belongs here and NOT in clean: nowhere-to-file is the gate declining
    // to judge, so counting it as a pass would repeat the 110-record error above in a new verdict.
    //
    neither: ['sensor-absent', 'spine-ledger-unreadable', 'spine-ledger-absent', 'store-unreadable',
      'overwatch-unreachable', 'substrate-unreachable'],
    // RETIRED FROM WRITING, STILL READ. `substrate-unreachable` was renamed to
    // `overwatch-unreachable` on 2026-08-30 for the public release, and 8 records already on disk
    // carry the old spelling. It must keep classifying, or those rows fall out of `neither` into the
    // unclassified remainder — silently reclassifying historical greys, which is the 110-record
    // error this stratum exists to prevent, arriving by a different door.
    //
    // Declared rather than left implicit because the registry is guarded: a listed verdict that
    // assess() cannot produce is normally a DEAD stratum reading as coverage, and that guard is
    // right. This field is how a verdict says "unproducible ON PURPOSE" instead of defeating it.
    // Empty this list once no stored record uses the id; the guard then goes back to catching
    // everything.
    retired: ['substrate-unreachable'],
    factFields: ['verdict', 'edits', 'spineRecords'],
  },
  // Maps liveness's RANK vocabulary (monitor/liveness.mjs): rank 0 clean, rank >= 1 alarm.
  // `degraded` fires by construction and is expected to dominate the alarm stratum.
  liveness: {
    verdictField: 'verdict',
    clean: ['fresh', 'pending', 'unscheduled'],
    // `overrunning` is RANK 1: a sweep past its hang threshold whose PID IS STILL ALIVE — long,
    // not hung. It warns without failing the gate, but it is still a claim the gate made, and a
    // verdict that cannot be classified cannot enter a denominator. It was recorded by
    // liveness and counted by nothing between 2026-08-24 and here.
    alarm: ['stale', 'degraded', 'never-swept', 'unjournaled', 'unknown', 'expired', 'hung', 'tampered', 'overrunning'],
    // `paused` is RANK 0 and is the operator's own instruction that an area is deliberately quiet.
    // Not clean — the sweep did not run, so nothing was observed and no pass was earned. Not alarm —
    // a state somebody asked for is not a finding. Its own stratum, which is what the house rule
    // means by keeping an undetermined outside the clean/alarm split.
    neither: ['paused'],
  },
  // Writes no record when quiet, so the clean stratum is UNMEASURABLE, not merely unmeasured.
  'gate-focus': {
    verdictField: 'verdict',
    clean: [],
    alarm: ['refocus-fired'],
    neither: ['state-unreadable'],   // the gate declining to judge — fail-closed, not a verdict
    cleanStratumImpossible: 'writes no record when quiet (focus-journal.mjs:152) — silence leaves nothing to adjudicate',
  },
  // fact: clean-with-unscanned is only in older records
  'pre-publish': {
    verdictField: 'verdict',
    clean: ['clean', 'clean-reviewed', 'clean-with-unscanned'],
    alarm: ['blocked-secret', 'blocked-context'],
    neither: ['cannot-check', 'unreviewed-unscanned'],
  },
  'release-candidate': {
    verdictField: 'verdict',
    clean: ['accepted'],
    alarm: ['blocked'],
    neither: ['incomplete'],
  },
};

export const STRATA = ['clean', 'alarm', 'neither', 'unclassified'];

/**
 * Stratum of a record's verdict; unrecognised returns 'unclassified', never a guess.
 *
 * `registry` is injectable ONLY so the identity comparison below can be tested. Every shipped spec
 * now uses string verdicts, so nothing real exercises the falsy case, and a refactor to
 * `.includes()` or a truthy guard would pass the whole suite — measured, it did. A property no
 * live spec can reach still needs a witness.
 */
export function classifyRecord(gate, record, { registry = GATE_REGISTRY } = {}) {
  const spec = registry[gate];
  if (!spec || !spec.verdictField) return { stratum: 'unclassified', verdict: null };
  const v = record ? record[spec.verdictField] : undefined;
  if (v === undefined || v === null) return { stratum: 'unclassified', verdict: null };
  // Identity comparison, so `false` (gate-spine) is matched, not swallowed by truthiness.
  // `greyMismatch` is the reader for the `grey` flag gate-spine journals. The flag is computed by
  // the gate's own core; the stratum is decided by this registry. If a record says it was a blind
  // sensor and the registry files it as clean or alarm, the two descriptions of one verdict have
  // drifted — which is exactly how 110 greys came to be scored as passes. A flag nothing reads
  // could not have caught that; this is the reader.
  const grey = record?.grey === true;
  const at = (stratum) => ({ stratum, verdict: v, ...(grey && stratum !== 'neither' ? { greyMismatch: true } : {}) });
  if (spec.clean.some((x) => x === v)) return at('clean');
  if (spec.alarm.some((x) => x === v)) return at('alarm');
  if (spec.neither.some((x) => x === v)) return at('neither');
  return at('unclassified');
}

/** Stratum a truth is observable in — the truth value carries its own stratum. */
export function stratumOfTruth(truth) {
  if (truth === 'true-clean' || truth === 'false-clean') return 'clean';
  if (truth === 'true-alarm' || truth === 'false-alarm') return 'alarm';
  return null;
}

// The interval stays a function of (k, n) ONLY — never weight it by stratum balance: distribution
// shape is the axis a degraded gate distorts. Composition travels BESIDE the interval instead.
/** How a population distributes across strata — must accompany every interval. `dominant` breaks
 *  ties on STRATA order for determinism. */
export function composition(counts) {
  const c = {};
  for (const s of STRATA) c[s] = Number.isInteger(counts && counts[s]) ? counts[s] : 0;
  const total = STRATA.reduce((n, s) => n + c[s], 0);
  const shares = {};
  // null, not 0, over an empty population: absence is its own state.
  for (const s of STRATA) shares[s] = total > 0 ? c[s] / total : null;
  const top = total > 0 ? STRATA.reduce((a, b) => (c[b] > c[a] ? b : a)) : null;
  return {
    total,
    counts: c,
    shares,
    dominant: top ? { stratum: top, count: c[top], share: c[top] / total } : null,
    label: total > 0
      ? STRATA.filter((s) => c[s] > 0).map((s) => `${s} ${c[s]}/${total}`).join(', ')
      : 'no records',
  };
}

/** The stratum composition of a set of records for one gate, classified by GATE_REGISTRY. */
export function compositionOf(gate, records) {
  const counts = {};
  for (const s of STRATA) counts[s] = 0;
  for (const r of records) counts[classifyRecord(gate, r).stratum]++;
  return composition(counts);
}

// Wilson on integer counts — deterministic, and honest at k=0 / tiny n where the normal
// approximation reports unearned certainty.
export function wilson(k, n, z = 1.96) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n <= 0 || k < 0 || k > n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  // Pin the degenerate endpoints: k=0 lower bound is exactly 0, k=n upper exactly 1.
  return [
    k === 0 ? 0 : Math.max(0, centre - margin),
    k === n ? 1 : Math.min(1, centre + margin),
  ];
}

/**
 * A rate as a record that cannot be mistaken for a number. `observable: false` means the
 * denominator contained nothing capable of exhibiting the outcome — `value` is null and callers
 * must render the absence.
 * @param {number} k events observed
 * @param {number} n records in which the event was OBSERVABLE (not all adjudications)
 * @param {string} basis one clause naming what n counts
 * @param {object} [comp] composition() of the population — carried, never consumed, so the
 *   interval cannot become a function of distribution shape
 */
export function rate(k, n, basis, comp) {
  // Refuse inputs that cannot describe a rate, rather than computing k/n anyway.
  const impossible = !Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n;
  if (!Number.isInteger(n) || n <= 0 || impossible) {
    return {
      value: null,
      k: Number.isInteger(k) ? k : null,
      n: Number.isInteger(n) ? n : null,
      observable: false,
      ci95: null,
      // Explicitly false, never undefined — an absent field must not read as "informative".
      uninformative: false,
      // Distinguishes "nothing to measure" from "the counts given cannot be a rate".
      impossible: impossible && n > 0,
      basis,
      composition: comp || null,
    };
  }
  // Computed from (k, n) alone; `comp` is deliberately not read.
  const ci95 = wilson(k, n);
  return {
    value: k / n,
    k,
    n,
    observable: true,
    ci95,
    composition: comp || null,
    // An interval wider than half the scale carries almost no information — said, not suppressed.
    uninformative: ci95 ? ci95[1] - ci95[0] > 0.5 : true,
    impossible: false,
    basis,
  };
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;

/** The only sanctioned way to render a rate: absence can never read as zero. */
export function renderRate(r, label) {
  if (r && r.impossible) {
    return `${label}: REFUSED — the counts given cannot be a rate (${r.basis}); this is a data-integrity fault, not an empty stratum`;
  }
  if (!r || !r.observable) {
    return `${label}: undefined (${r && r.basis ? r.basis : 'no observable records'})`;
  }
  const ci = r.ci95 ? ` [${pct(r.ci95[0])}, ${pct(r.ci95[1])}]` : '';
  const flag = r.uninformative ? ' · uninformative' : '';
  // The interval never travels alone; unknown composition is stated, not defaulted.
  const comp = r.composition && r.composition.total
    ? ` · population: ${r.composition.label}`
    : ' · population composition NOT SUPPLIED, so whether this interval is tight because the'
      + ' evidence is good or because one stratum swallowed the records cannot be told apart';
  return `${label}: ${pct(r.value)} (${r.k}/${r.n})${ci}${comp}${flag} — ${r.basis}`;
}

/** Rule of three: with 0 events in n trials, the rate could still be as high as ~3/n. */
export function unobservedUpperBound(k, n) {
  if (n <= 0) return 1;
  return k === 0 ? Math.min(1, 3 / n) : null;
}

// ── COVERAGE, PER STRATUM, OVER A DECLARED POPULATION ───────────────────────────────────────────
/**
 * @param {object} [opts]
 * @param {string} [opts.dir] verdict directory; defaults to CW_VERDICT_DIR at call time
 * @param {string} [opts.since] ISO instant — count only records at or after it
 */
export function stratumCoverage({ dir, since } = {}) {
  const d = dir || dirFor();
  // Chain-aware read: rotation is not deletion, and a single-file read makes it look like it is.
  const adj = readJournal('adjudications', { dir: d });
  const adjudications = adj.records.filter((a) => a && a.kind === 'adjudication');

  const out = { gates: {}, since: since || null, unclassified: [] };

  for (const [gate, spec] of Object.entries(GATE_REGISTRY)) {
    const j = readJournal(gate, { dir: d });
    // A registered gate with no journal is absent-not-measured — never 0%, never omitted.
    if (j.absent) {
      out.gates[gate] = {
        state: spec.expected === false ? 'absent-expected' : 'absent-not-measured',
        records: null, strata: null, composition: null,
        note: 'no journal — a gate with no evidence, not a gate with no problems',
      };
      continue;
    }

    const records = since ? j.records.filter((r) => r && String(r.at || '') >= since) : j.records;
    const strata = {};
    for (const s of STRATA) strata[s] = { population: 0, adjudicated: 0, judgedUndecidable: 0, ambiguousRef: 0, retractedIgnored: 0,
      judgedRecords: new Set(), undecidableRecords: new Set(), verdicts: {} };

    // `at` is not unique across concurrent writers: keep the SET of strata per instant so an
    // ambiguous reference is representable, never guessed.
    const strataAt = new Map();
    for (const r of records) {
      const { stratum, verdict } = classifyRecord(gate, r);
      const cell = strata[stratum];
      cell.population++;
      const key = String(verdict);
      cell.verdicts[key] = (cell.verdicts[key] || 0) + 1;
      if (r && r.at) {
        if (!strataAt.has(r.at)) strataAt.set(r.at, new Set());
        strataAt.get(r.at).add(stratum);
      }
      if (stratum === 'unclassified') out.unclassified.push({ gate, verdict, at: r && r.at });
    }

    // Only LIVE adjudications that assigned a truth count against coverage; partial
    // (attribution-only) judgements are counted separately, and retractions are honoured via
    // verdict-journal's resolver so both readers agree on what "adjudicated" means.
    const retracted = retractionsFrom(adj.records);
    for (const a of adjudications) {
      if (a.gate !== gate) continue;
      if (retracted.has(a)) { strata.unclassified.retractedIgnored++; continue; }
      const seen = strataAt.get(a.recordAt);
      if (!seen) continue;
      // Ambiguous instant: attributed to nothing, never assigned by picking a stratum.
      if (seen.size > 1) { strata.unclassified.ambiguousRef++; continue; }
      const s = [...seen][0];
      // Coverage counts records judged, not judgements made — several adjudications can name one record.
      if (TRUTHS.includes(a.truth)) strata[s].judgedRecords.add(a.recordAt);
      else strata[s].undecidableRecords.add(a.recordAt);
    }
    // A record judged both ways counts as judged once.
    for (const s of STRATA) {
      for (const at of strata[s].judgedRecords) strata[s].undecidableRecords.delete(at);
      strata[s].adjudicated = strata[s].judgedRecords.size;
      strata[s].judgedUndecidable = strata[s].undecidableRecords.size;
      delete strata[s].judgedRecords;
      delete strata[s].undecidableRecords;
    }

    const total = records.length;
    const summed = STRATA.reduce((n, s) => n + strata[s].population, 0);
    // Computed once per gate and carried onto every interval drawn from it.
    const comp = composition(Object.fromEntries(STRATA.map((s) => [s, strata[s].population])));
    for (const s of STRATA) {
      const c = strata[s];
      c.coverage = rate(c.adjudicated, c.population, `${c.adjudicated} of ${c.population} ${s} records adjudicated`, comp);
      c.unexamined = c.population - c.adjudicated;
      c.missedUpperBound = unobservedUpperBound(c.adjudicated, c.population);
    }
    out.gates[gate] = {
      state: 'measured',
      records: total,
      // The arithmetic must close — a dropped stratum deflates a denominator.
      arithmeticCloses: summed === total,
      // "0 of 0 clean" and "0 of 344 clean" call for opposite actions.
      cleanStratumImpossible: spec.cleanStratumImpossible || null,
      composition: comp,
      strata,
    };
  }
  return out;
}

// ── DID THE SOURCE MOVE? A CANDIDATE FILTER, NEVER A VERDICT ───────────────────────────────────
// `measured.digest` (bin/measured.mjs) hashes the source's raw output: digest changed with the
// reading unchanged = healthy-static; digest unchanged across differing headSha = suspect (a
// tracked artifact nobody regenerated looks identical and is benign — hence shortlist, not
// verdict). Below the declared window the answer is `window-too-small`, not `not suspect`.
export const RESPONSIVENESS_MIN_COMMITS = 3;

export function sourceResponsiveness({ dir, minCommits = RESPONSIVENESS_MIN_COMMITS } = {}) {
  const d = dir || dirFor();
  const out = {};
  for (const gate of Object.keys(GATE_REGISTRY)) {
    const j = readJournal(gate, { dir: d });
    if (j.absent) { out[gate] = { state: 'absent', reason: 'no journal' }; continue; }
    const withProv = j.records.filter((r) => r && r.measured && r.measured.digest && r.headSha);
    if (!withProv.length) {
      out[gate] = {
        state: 'unrecorded',
        records: j.records.length,
        reason: 'no record carries measurement provenance, so whether the source ever moved is UNKNOWN — not unchanged',
      };
      continue;
    }
    const shas = new Set(withProv.map((r) => r.headSha));
    const digests = new Set(withProv.map((r) => r.measured.digest));
    const pinned = withProv.filter((r) => String(r.measured.source || '').startsWith('artifact:')).length;
    if (shas.size < minCommits) {
      out[gate] = {
        state: 'window-too-small', window: withProv.length, commits: shas.size, digests: digests.size, pinnedReads: pinned,
        reason: `${shas.size} distinct commit(s) carry provenance; ${minCommits} are declared as the floor — I could not look, which is not the same as having looked and found nothing`,
      };
      continue;
    }
    out[gate] = {
      state: digests.size === 1 ? 'suspect' : 'responsive',
      window: withProv.length, commits: shas.size, digests: digests.size, pinnedReads: pinned,
      reason: digests.size === 1
        ? `one source digest across ${shas.size} distinct commits — the source did not move. A CANDIDATE for re-derivation, not a verdict: a tracked artifact nobody regenerated looks exactly like this and is benign.`
        : `${digests.size} distinct source digests across ${shas.size} commits — the source moved, so a steady reading is a steady reading rather than a possible echo`,
    };
  }
  return out;
}

// ── TRUTH MUST AGREE WITH THE VERDICT IT JUDGES ────────────────────────────────────────────────
// A `truth` implies a stratum; disagreement with the record it names silently corrupts a
// denominator. A contradiction is refused and reported, never silently corrected.
export function validateAdjudication(adjudication, record, { gate = adjudication && adjudication.gate } = {}) {
  if (!adjudication || adjudication.kind !== 'adjudication') {
    return { ok: true, reason: 'not an adjudication — nothing to check' };
  }
  const implied = stratumOfTruth(adjudication.truth);
  if (implied === null) {
    // No truth is not a contradiction: attribution-only records are honest partial judgements.
    return { ok: true, reason: 'no truth asserted, so nothing contradicts the record' };
  }
  if (!record) {
    // Canary/retrospective/unresolvable records have no live record to agree with.
    return { ok: true, reason: 'no live record to compare against (canary, retrospective or unresolvable)' };
  }
  const actual = classifyRecord(gate, record).stratum;
  if (actual === 'unclassified') {
    return { ok: true, unverifiable: true, reason: `the record's verdict is not classified for ${gate}, so the claim cannot be checked — UNVERIFIED, not agreed` };
  }
  if (actual === 'neither') {
    return {
      ok: false,
      reason: `truth '${adjudication.truth}' asserts the gate said ${implied}, but the record made NO clean-or-alarm claim at all (${gate} '${record[GATE_REGISTRY[gate]?.verdictField]}')`,
    };
  }
  if (actual !== implied) {
    return {
      ok: false,
      reason: `truth '${adjudication.truth}' can only be said about a record where the gate said ${implied.toUpperCase()}, `
        + `but this record's verdict '${record[GATE_REGISTRY[gate]?.verdictField]}' is ${actual.toUpperCase()} — `
        + 'one of the two is wrong, and correcting either silently would put the judgement in a denominator it does not belong in',
    };
  }
  return { ok: true, reason: `truth agrees with the record's ${actual} verdict` };
}

/** Run validateAdjudication over every resolvable adjudication already on disk. */
export function auditTruthStratum({ dir } = {}) {
  const d = dir || dirFor();
  const adj = readJournal('adjudications', { dir: d });
  const out = { checked: 0, agreed: 0, unverifiable: 0, notComparable: 0, contradictions: [] };
  const byGate = new Map();
  for (const a of adj.records) {
    if (!a || a.kind !== 'adjudication') continue;
    if (!GATE_REGISTRY[a.gate]) { out.notComparable++; continue; }
    if (!byGate.has(a.gate)) {
      const j = readJournal(a.gate, { dir: d });
      byGate.set(a.gate, new Map(j.records.filter((r) => r && r.at).map((r) => [r.at, r])));
    }
    const rec = byGate.get(a.gate).get(a.recordAt) || null;
    const v = validateAdjudication(a, rec, { gate: a.gate });
    if (!rec || stratumOfTruth(a.truth) === null) { out.notComparable++; continue; }
    out.checked++;
    if (v.unverifiable) { out.unverifiable++; continue; }
    if (v.ok) out.agreed++;
    else out.contradictions.push({ at: a.at, gate: a.gate, recordAt: a.recordAt, truth: a.truth, reason: v.reason });
  }
  return out;
}

// ── DELIVERY: WAS THE DECISION EVER SAID OUT LOUD? ─────────────────────────────────────────────
// `suppressed: true` means "this exact sentence was already said" (the first occurrence WAS
// spoken) — the miss worth alarming on is a suppressed record whose FACTS moved. A gate recording
// no `suppressed` field is `unrecorded`, never zero.
const factsOf = (spec, rec) => JSON.stringify((spec.factFields || []).map((f) => rec[f] ?? null));

export function deliveryReport({ dir, since } = {}) {
  const d = dir || dirFor();
  const out = {};
  for (const [gate, spec] of Object.entries(GATE_REGISTRY)) {
    const j = readJournal(gate, { dir: d });
    if (j.absent) { out[gate] = { state: 'absent', reason: 'no journal — delivery is unknown, not clean' }; continue; }
    const records = since ? j.records.filter((r) => r && String(r.at || '') >= since) : j.records;
    const alarms = records.filter((r) => classifyRecord(gate, r).stratum === 'alarm');
    const recording = records.filter((r) => r && 'suppressed' in r);
    const comp = compositionOf(gate, records);
    if (!recording.length) {
      out[gate] = {
        state: 'unrecorded',
        alarms: alarms.length,
        composition: comp,
        reason: `this gate writes no \`suppressed\` field, so the delivery of its ${alarms.length} alarm record(s) is UNKNOWN — not delivered`,
      };
      continue;
    }
    // The candidate misses: suppressed, and the facts differ from the record immediately before.
    let suppressed = 0;
    const missed = [];
    for (let i = 1; i < records.length; i++) {
      const r = records[i];
      if (r.suppressed !== true) continue;
      suppressed++;
      if (!spec.factFields) continue;
      if (factsOf(spec, r) !== factsOf(spec, records[i - 1])) {
        // Direction matters: a silenced ALARM leaves a live problem unannounced; a silenced
        // RECOVERY leaves a stale alarm standing.
        const now = classifyRecord(gate, r).stratum;
        const before = classifyRecord(gate, records[i - 1]).stratum;
        missed.push({
          at: r.at,
          direction: now === 'alarm' ? 'silenced-alarm' : before === 'alarm' ? 'silenced-recovery' : 'silenced-change',
          from: factsOf(spec, records[i - 1]),
          to: factsOf(spec, r),
        });
      }
    }
    out[gate] = {
      state: 'measured',
      records: records.length,
      alarms: alarms.length,
      recordingDelivery: recording.length,
      suppressed,
      // Only suppressed records whose facts moved are candidate misses.
      silencedNewState: missed.length,
      silencedAlarms: missed.filter((m) => m.direction === 'silenced-alarm').length,
      silencedRecoveries: missed.filter((m) => m.direction === 'silenced-recovery').length,
      examples: missed.slice(0, 3),
      composition: comp,
      rate: rate(missed.length, suppressed, `${missed.length} of ${suppressed} suppressed records had facts that moved`, comp),
      factFieldsDeclared: spec.factFields || null,
      // Blind to a stuck measurement: a dead gate and a healthy-static gate score identically
      // here — liveness is measured.digest / sourceResponsiveness territory.
      blindTo: 'a stuck measurement — a dead gate and a healthy-static gate have identical suppression profiles and both score silencedNewState 0',
    };
  }
  return out;
}

// ── THE DEADMAN'S OWN PULSE ─────────────────────────────────────────────────────────────────────
// Lives here because liveness cannot notice liveness stopped. Two missed beats: one could be an
// in-flight run; two is a stopped scheduler, not jitter.
export const DEADMAN_MISSED_BEATS = 2;

const livenessPlistPath = () => process.env.CW_LIVENESS_PLIST
  || join(process.env.HOME || '', 'Library', 'LaunchAgents', 'com.portll.commitwork-liveness.plist');

/** Is the deadman itself beating? Newest liveness record's age vs the plist cadence. Writes
 *  nothing. Missing plist = late-ness UNDEFINABLE; unreadable plist is its own failure. */
export function livenessDeadman({ dir, plistPath, now } = {}) {
  const plist = plistPath || livenessPlistPath();
  const t = now ?? (process.env.CW_NOW ? Date.parse(process.env.CW_NOW) : Date.now());

  const j = readJournal('liveness', { dir: dir || dirFor() });
  if (j.absent) {
    return { state: 'no-journal', plist,
      reason: 'liveness has never journalled — there is no pulse to age; unknown, not healthy' };
  }
  let newest = NaN;
  for (const r of j.records) {
    const at = r && Date.parse(r.at);
    if (Number.isFinite(at) && !(at <= newest)) newest = at;
  }
  if (!Number.isFinite(newest)) {
    return { state: 'no-usable-timestamp', plist, records: j.records.length,
      reason: `${j.records.length} record(s), none carrying a parseable \`at\` — age is unmeasurable, not fresh` };
  }
  const newestAt = new Date(newest).toISOString();
  const ageSeconds = Math.floor((t - newest) / 1000);

  let intervalSeconds = null;
  try {
    const m = readFileSync(plist, 'utf8').match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
    intervalSeconds = m ? Number(m[1]) : null;
    if (!intervalSeconds || intervalSeconds <= 0) {
      return { state: 'cadence-unreadable', plist, newestAt, ageSeconds,
        reason: 'plist exists but declares no positive StartInterval — a cadence that cannot be read is not a cadence of zero' };
    }
  } catch (e) {
    rethrowIfBug(e);
    if (e.code === 'ENOENT') {
      return { state: 'cadence-unknown', plist, newestAt, ageSeconds,
        reason: `no plist at ${plist} — "late" is undefinable without a schedule; the newest pulse is ${ageSeconds}s old and that is all that can be said` };
    }
    return { state: 'cadence-unreadable', plist, newestAt, ageSeconds, code: e.code || null,
      reason: `plist unreadable (${e.code || e.message}) — a permission error is not an absent schedule` };
  }

  const thresholdSeconds = DEADMAN_MISSED_BEATS * intervalSeconds;
  if (ageSeconds > thresholdSeconds) {
    return { state: 'flatlined', plist, newestAt, ageSeconds, intervalSeconds,
      missedBeatsThreshold: DEADMAN_MISSED_BEATS,
      reason: `newest pulse ${ageSeconds}s old against a ${intervalSeconds}s cadence (threshold ${thresholdSeconds}s) — `
        + 'the deadman itself is down, and every lane it watches is silently unwatched' };
  }
  return { state: 'beating', plist, newestAt, ageSeconds, intervalSeconds,
    missedBeatsThreshold: DEADMAN_MISSED_BEATS,
    reason: `newest pulse ${ageSeconds}s old, within ${DEADMAN_MISSED_BEATS}x the ${intervalSeconds}s cadence` };
}

// ── THE QUEUE: WHAT WOULD MOVE A NUMBER ─────────────────────────────────────────────────────────
// Ranked by how much one more adjudication would narrow the interval, never oldest-first.
// Census rule: strata at or under CENSUS_THRESHOLD are adjudicated in full or not at all —
// proportional sampling never reaches them.
export const CENSUS_THRESHOLD = 5;

/** Marginal narrowing from ONE more adjudication in this stratum. n counts ADJUDICATIONS, not
 *  records. Monotonically decreasing, so unexamined strata rank first. */
export function informationGain(adjudicated, population) {
  if (population <= 0) return 0;
  const unexamined = population - adjudicated;
  if (unexamined <= 0) return 0;              // nothing left to judge here
  const widthAt = (n) => {
    if (n <= 0) return 1;                     // no estimate at all — maximally uninformative
    const w = wilson(0, n);
    return w ? w[1] - w[0] : 1;
  };
  const narrowing = widthAt(adjudicated) - widthAt(adjudicated + 1);
  // Weight by the unexamined remainder: the same narrowing generalises to more records.
  return Math.max(0, narrowing) * Math.log10(1 + unexamined);
}

export function adjudicationQueue({ dir, since } = {}) {
  const cov = stratumCoverage({ dir, since });
  const rows = [];
  for (const [gate, g] of Object.entries(cov.gates)) {
    if (g.state !== 'measured') {
      rows.push({
        gate, stratum: null, kind: g.state, population: null, adjudicated: null,
        priority: g.state === 'absent-not-measured' ? Infinity : 0,
        why: g.state === 'absent-not-measured'
          ? 'no journal at all — nothing to sample; the gate must record before it can be measured'
          : 'declared as not-yet-journalling',
      });
      continue;
    }
    for (const s of ['clean', 'alarm', 'neither']) {
      const c = g.strata[s];
      if (!c.population) continue;
      const census = c.population <= CENSUS_THRESHOLD;
      rows.push({
        gate, stratum: s, kind: census ? 'census' : 'sample',
        population: c.population, adjudicated: c.adjudicated, unexamined: c.unexamined,
        priority: census ? Infinity : informationGain(c.adjudicated, c.population),
        why: census
          ? `only ${c.population} record(s) — adjudicate all; proportional sampling never reaches a stratum this small`
          : s === 'clean' && c.adjudicated === 0
            ? `a false-clean is observable ONLY here, and 0 of ${c.population} have been examined — the gate's false-clean rate is undefined, not zero`
            : `${c.adjudicated} of ${c.population} examined`,
      });
    }
  }
  // Deterministic: ties break on gate then stratum name, never on iteration order.
  rows.sort((a, b) => (b.priority - a.priority)
    || a.gate.localeCompare(b.gate)
    || String(a.stratum).localeCompare(String(b.stratum)));
  return { rows, since: cov.since, unclassified: cov.unclassified };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const wantJson = argv.includes('--json');
  const sinceArg = argv.find((a) => a.startsWith('--since='));
  const since = sinceArg ? sinceArg.slice('--since='.length) : undefined;
  const cov = stratumCoverage({ since });
  const q = adjudicationQueue({ since });

  if (wantJson) {
    process.stdout.write(`${JSON.stringify({ coverage: cov, queue: q, deadman: livenessDeadman({}) }, null, 2)}\n`);
    return 0;
  }

  const lines = ['adjudication coverage by stratum (proposals only — nothing here mutates anything)'];
  if (since) lines.push(`  population restricted to records at or after ${since}`);
  for (const [gate, g] of Object.entries(cov.gates)) {
    if (g.state !== 'measured') {
      lines.push(`  ${gate.padEnd(14)} ${g.state.toUpperCase()} — ${g.note}`);
      continue;
    }
    lines.push(`  ${gate.padEnd(14)} ${g.records} records${g.arithmeticCloses ? '' : '  !! PARTITION DOES NOT CLOSE'}`);
    if (g.cleanStratumImpossible) {
      lines.push(`      ${'clean'.padEnd(13)} NOT MEASURABLE — ${g.cleanStratumImpossible}`);
      lines.push(`      ${' '.repeat(13)} this gate's false-clean rate cannot be estimated without changing what it records`);
    }
    for (const s of ['clean', 'alarm', 'neither', 'unclassified']) {
      const c = g.strata[s];
      if (!c.population) continue;
      lines.push(`      ${s.padEnd(13)} ${renderRate(c.coverage, 'coverage')}`);
      // Judged-and-unjudgeable is a third state — a finding about the corpus, not progress.
      if (c.ambiguousRef) {
        lines.push(`      ${' '.repeat(13)} + ${c.ambiguousRef} adjudication(s) name an AMBIGUOUS instant (two records share that timestamp) — `
          + 'attributed to no stratum: picking one would be a guess wearing the shape of a measurement');
      }
      if (c.retractedIgnored) {
        lines.push(`      ${' '.repeat(13)} + ${c.retractedIgnored} RETRACTED judgement(s) ignored — a withdrawn claim is not evidence`);
      }
      if (c.judgedUndecidable) {
        lines.push(`      ${' '.repeat(13)} + ${c.judgedUndecidable} judged UNDECIDABLE (examined, no truth assignable) — `
          + 'not counted as adjudicated: "we looked and could not tell" is not "we know"');
      }
      if (s === 'clean' && c.adjudicated === 0) {
        lines.push(`      ${' '.repeat(13)} a false-clean is observable ONLY in this stratum — with 0 examined, `
          + `up to ${c.population} missed alarms are consistent with the evidence`);
      }
    }
  }
  lines.push('', 'source responsiveness — did the thing being measured actually move? (candidate filter, never a verdict)');
  for (const [gate, rr] of Object.entries(sourceResponsiveness({}))) {
    const head = rr.state === 'suspect' ? '*** SUSPECT' : rr.state.toUpperCase();
    lines.push(`  ${gate.padEnd(14)} ${head}  ${rr.reason}`);
  }
  lines.push('', 'liveness deadman — liveness watches every gate\'s pulse; this is the age of its own');
  const dm = livenessDeadman({});
  const dmHead = dm.state === 'flatlined' || dm.state === 'cadence-unreadable'
    ? `*** ${dm.state.toUpperCase()}` : dm.state.toUpperCase();
  lines.push(`  ${dmHead}  ${dm.reason}`);
  const audit = auditTruthStratum({ dir: undefined });
  lines.push('', `truth-vs-verdict — ${audit.agreed}/${audit.checked} adjudications agree with the record they judge`
    + `${audit.unverifiable ? ` · ${audit.unverifiable} unverifiable` : ''}`
    + `${audit.notComparable ? ` · ${audit.notComparable} not comparable (canary, retrospective, or no truth)` : ''}`);
  for (const c of audit.contradictions.slice(0, 5)) {
    lines.push(`  *** CONTRADICTION  ${c.gate} ${c.recordAt}  truth='${c.truth}'`);
    lines.push(`      ${c.reason}`);
  }
  lines.push('', 'delivery — was the decision ever said out loud? (`suppressed` means the previous message was');
  lines.push('  identical, so the first occurrence WAS spoken; only a suppressed record whose FACTS MOVED is a miss)');
  lines.push('  NOT evidence a gate is alive: a corpse returning a cached reading scores identically here.');
  for (const [gate, dv] of Object.entries(deliveryReport({ since }))) {
    if (dv.state !== 'measured') { lines.push(`  ${gate.padEnd(14)} ${dv.state.toUpperCase()} — ${dv.reason}`); continue; }
    const flag = dv.silencedNewState
      ? `  *** ${dv.silencedNewState} silenced while the facts moved (${dv.silencedAlarms} ALARM, ${dv.silencedRecoveries} recovery)`
      : '';
    lines.push(`  ${gate.padEnd(14)} alarms=${dv.alarms} suppressed=${dv.suppressed}${flag}`);
    for (const m of dv.examples) lines.push(`      ${m.direction.padEnd(18)} ${m.at}  ${m.from} -> ${m.to}`);
  }
  lines.push('', 'queue — ranked by what one more adjudication would move, not by age');
  for (const r of q.rows.slice(0, 12)) {
    const head = r.stratum ? `${r.gate}/${r.stratum}` : r.gate;
    const p = r.priority === Infinity ? 'CENSUS' : r.priority.toFixed(4);
    lines.push(`  ${String(p).padStart(7)}  ${head.padEnd(28)} ${r.why}`);
  }
  if (q.unclassified.length) {
    lines.push('', `UNCLASSIFIED verdicts (${q.unclassified.length}) — a verdict not in GATE_REGISTRY cannot be`
      + ' put in a denominator, and is never defaulted into one:');
    const seen = new Set();
    for (const u of q.unclassified) {
      const k = `${u.gate}/${u.verdict}`;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push(`  ${k}`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
