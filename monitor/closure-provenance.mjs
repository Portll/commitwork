#!/usr/bin/env node
// monitor/closure-provenance.mjs — who closed a finding, and whether a rate may use it.
//
// fact: 66 of 67 `fixed` closures were made by the auto-close gate and the record does not say so / `auto:true` is written into the EVENT and never onto the issue, so a reader of issues.json sees `closedAs:'fixed'` and cannot tell a machine inference from a human verdict without replaying the chain (measured 2026-08-27, expiry: never, prev: broken)
// fact: that gate once reported 8 findings FIXED when they had merely shifted a few lines / a machine-inferred absence is not a confirmed true positive, and a rate that counts it as one is measuring the gate rather than the findings (expiry: never, prev: broken)
//
// DERIVED, NOT BACKFILLED. The fact is already in the event chain, so reconstructing it is a read
// rather than an assertion — and it touches none of the 66 historical records. Writing a marker
// onto them would be asserting today something that was recorded in 2026-08; the chain already
// holds it, so the honest move is to read it.
//
// This is deliberately NOT regradeClosure(). A re-grade changes a verdict and needs evidence; this
// changes nothing and states what was always true. Conflating them would put 66 fabricated
// "corrections" into a history whose whole value is that corrections are visible.

import { isMainModule } from '../lib/is-main.mjs';

/** Closure provenance for one issue, from the event chain. */
export function closureProvenance(events, issueId) {
  const closes = (events || []).filter((e) => e && e.type === 'issue-closed' && e.issueId === issueId);
  if (!closes.length) return { provenance: 'none', closedAs: null, why: 'no close event for this issue' };
  const last = closes[closes.length - 1];
  const d = last.data || {};
  // `auto:true` is written by the auto-close gate. Its ABSENCE is not proof of a human — an older
  // event shape may simply not have carried the flag — so absence reads `unmarked`, never `human`.
  if (d.auto === true) return { provenance: 'auto', closedAs: d.closedAs || null, why: 'closed by the auto-close gate on ledger evidence' };
  if (d.evidence != null && String(d.evidence).trim()) {
    return { provenance: 'human', closedAs: d.closedAs || null, why: 'closed with recorded evidence' };
  }
  return { provenance: 'unmarked', closedAs: d.closedAs || null, why: 'no auto flag and no evidence — provenance cannot be established from the record' };
}

/**
 * The base a false-positive rate may be computed over, and everything excluded from it with the
 * reason. Nothing is silently dropped: a rate over a quietly reduced denominator is the flattering
 * number this repository exists to catch.
 *
 * ELIGIBLE means a human rendered a true/false verdict:
 *   refuted  -> a confirmed false positive
 *   accepted -> a confirmed TRUE positive, judged acceptable
 *   fixed BY A HUMAN -> a confirmed true positive that was remediated
 *
 * EXCLUDED:
 *   fixed by the gate -> an inferred absence, not a confirmed finding
 *   superseded        -> a bookkeeping merge, not a verdict about truth
 *   unmarked          -> provenance unestablished; counting it either way invents a fact
 *
 * `sampling` defaults to opportunistic — the true description of every closure in the store
 * today — and a RATE IS EMITTED ONLY WHEN IT IS random. The default is the honest one so that a
 * caller who never thought about sampling cannot accidentally publish a rate.
 */
export function rateBase(doc, { sampling = 'opportunistic' } = {}) {
  const events = doc && doc.events ? doc.events : [];
  const issues = doc && doc.issues ? doc.issues : {};
  const eligible = { refuted: [], accepted: [], fixedHuman: [] };
  const excluded = { fixedAuto: [], superseded: [], unmarked: [], open: [] };

  for (const [id, iss] of Object.entries(issues)) {
    if (!iss || iss.state !== 'closed') { excluded.open.push(id); continue; }
    const { provenance, closedAs } = closureProvenance(events, id);
    if (closedAs === 'superseded') { excluded.superseded.push(id); continue; }
    if (provenance === 'unmarked') { excluded.unmarked.push(id); continue; }
    if (closedAs === 'refuted') { eligible.refuted.push(id); continue; }
    if (closedAs === 'accepted') { eligible.accepted.push(id); continue; }
    if (closedAs === 'fixed') {
      if (provenance === 'auto') excluded.fixedAuto.push(id);
      else eligible.fixedHuman.push(id);
      continue;
    }
    excluded.unmarked.push(id);
  }

  const falsePositives = eligible.refuted.length;
  const truePositives = eligible.accepted.length + eligible.fixedHuman.length;
  const n = falsePositives + truePositives;

  return {
    eligible, excluded,
    report: {
      totalIssues: Object.keys(issues).length,
      eligibleForRate: n,
      falsePositives,
      truePositives,
      excludedFixedAuto: excluded.fixedAuto.length,
      excludedSuperseded: excluded.superseded.length,
      excludedUnmarked: excluded.unmarked.length,
      stillOpen: excluded.open.length,
      // NO RATE WITHOUT DECLARED RANDOM SAMPLING. The first version of this emitted
      // falsePositives/n whenever both sides were non-zero, and on the live store that produced
      // 0.9927 from 136 refutations against ONE human-confirmed true positive — a selection
      // artefact wearing a measurement's clothes, produced by the very module written to prevent it.
      //
      // People adjudicate what looks wrong. That is not a flaw to be corrected by arithmetic; it
      // means the denominator was never a sample of the population, and no amount of both-sides
      // non-emptiness repairs it. So `sampling` must be DECLARED, and until a random sample exists
      // the answer is null with the counts published beside it. A ratio a reader can compute for
      // themselves from the counts is fine; one this module blesses as `rate` is not.
      rate: sampling === 'random' && n > 0 && truePositives > 0
        ? Number((falsePositives / n).toFixed(4))
        : null,
      sampling,
      rateWhy: sampling !== 'random'
        ? `sampling is '${sampling}' — findings were adjudicated because they looked wrong, so the eligible set is a selection rather than a sample. ${falsePositives} refuted and ${truePositives} confirmed-true is the honest statement; a ratio over them would measure who chose what to look at.`
        : (n === 0
          ? 'no closure carries a human true/false verdict — there is nothing to compute a rate over'
          : (truePositives === 0
            ? `every eligible closure is a refutation (${falsePositives} of ${n}); a rate needs confirmed-true findings on the other side, and none exist`
            : null)),
    },
  };
}

export default { closureProvenance, rateBase };

// ---- CLI --------------------------------------------------------------------------------------

if (isMainModule(import.meta.url)) {
  const { readFileSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { issuesPathFor } = await import('./store-paths.mjs');
  const doc = JSON.parse(readFileSync(issuesPathFor(CW), 'utf8'));
  process.stdout.write(`${JSON.stringify(rateBase(doc).report, null, 2)}\n`);
}
