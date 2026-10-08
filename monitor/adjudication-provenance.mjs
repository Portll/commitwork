#!/usr/bin/env node
// monitor/adjudication-provenance.mjs — I10: what a published rate must say about who judged its
// findings, and when relative to the finding.
//
// fact: 259 close events collapse to 173 distinct adjudication acts (instant + verdict + evidence), so publishing the row count over-states the judgements by 1.50x / N records sharing one act is ONE adjudication, and a denominator of rows credits a single reading N times (measured 2026-09-01, expiry: on the next adjudication pass, prev: unmeasured)
// fact: 20 of 24 multi-close batches carry ONE evidence string across up to 16 findings / a shared evidence string is the signature of one reading applied across a set, and whether each member was judged individually is not in the record (measured 2026-09-01, expiry: never, prev: unmeasured)
// fact: zero issues carry a defectBasis, so the derived-vs-judged split is UNKNOWN rather than 0% derived / the I9 classification machinery exists and nothing has been run through it (measured 2026-09-01, expiry: on the first classify pass, prev: unmeasured)
//
// A reviewer who asks "who decided these were your bugs rather than the scanner's, and did they
// decide it at the time or reconstruct it afterwards" must find the answer in the document rather
// than in a reply. This module produces that answer, and refuses to produce a flattering one.
//
// BOTH POLES REQUIRE POSITIVE EVIDENCE. `live` and `retro` are each asserted only from something
// the record actually shows; everything else is `undetermined`. Defaulting the residue to either
// pole would be the same defect in opposite signs — `live` flatters the adjudication, `retro`
// impugns it, and the honest answer is that the record does not say.

import { isMainModule } from '../lib/is-main.mjs';

/** Timing of a judgement relative to the finding. Ordered pole, pole, residue. */
export const TIMING = Object.freeze(['live', 'retro', 'undetermined']);

/**
 * Evidence that is present as a string and carries nothing. `String({})` is `[object Object]`, and
 * a caller passing an object into closeIssue produces a field that is non-empty, truthy, and void.
 *
 * THE FIRST VERSION OF THIS MODULE CERTIFIED 135 CLOSURES AS `live` ON EXACTLY THIS. Every one of
 * them resolved to five distinct evidence strings, all of them `[object Object]` — a stringification
 * failure wearing evidence's clothes, and a non-empty check cannot tell the difference. Corruption
 * is not absence and it is certainly not proof; it reads `undetermined`, and loudly.
 */
export function isDegenerateEvidence(raw) {
  if (raw == null) return true;
  const s = String(raw).trim();
  if (!s) return true;
  // Every comma-separated part is a stringified object => the whole field carries nothing.
  return s.split(',').every((p) => p.trim() === '[object Object]');
}

/**
 * Timing for one closure.
 *
 * @param close      the `issue-closed` event
 * @param issue      the issue record (for `evidence`, `defectBasis`)
 * @param batchSize  how many closures share this event's instant
 */
export function adjudicationTiming(close, issue = {}, batchSize = 1) {
  const d = (close && close.data) || {};
  const degenerate = isDegenerateEvidence(issue.evidence);

  // RETRO, positively shown. The auto-close gate infers an absence from a ledger state recorded
  // after the finding — definitionally a reconstruction. `defectBasis:'commit'` says the same thing
  // explicitly: the classification was derived from a sha rather than judged.
  if (d.auto === true) return { timing: 'retro', why: 'closed by the auto-close gate from a later ledger state — an inference about the past, not a judgement made at the time' };
  if (issue.defectBasis === 'commit') return { timing: 'retro', why: 'classified by derivation from a commit after the fact' };

  // UNDETERMINED, because a shared instant means one act closed several findings and the record
  // does not say whether each was judged. This is NOT retro — batching is not proof of a shared
  // judgement, and calling it one would over-report.
  if (batchSize > 1) return { timing: 'undetermined', why: `closed in a batch of ${batchSize} at one instant — whether each finding was judged individually is not in the record` };

  if (issue.evidence != null && degenerate && String(issue.evidence).trim()) {
    return { timing: 'undetermined', why: 'evidence field is corrupt (`[object Object]`) — an object reached String(); the judgement may have been sound and the record of it is gone', corruptEvidence: true };
  }
  if (degenerate) return { timing: 'undetermined', why: 'individually timed, but carries no evidence — nothing establishes when or on what basis it was judged' };

  return { timing: 'live', why: 'individually timed, human-closed, carrying its own evidence' };
}

/**
 * Collapse closures to ACTS. Rows are not judgements: a batch of 16 closures sharing one instant,
 * one verdict and one evidence string is one reading, and counting it as 16 credits that reading
 * fifteen times over.
 */
function actKey(close, issue) {
  const d = (close && close.data) || {};
  const ev = issue && issue.evidence != null ? String(issue.evidence).trim() : '';
  return `${close.at}\0${d.closedAs || ''}\0${ev}`;
}

/**
 * Adjudication provenance across a whole issue store.
 *
 * Emits the counts, the act collapse, and a `statement` — the sentence a publication must carry.
 * The statement is GENERATED, so it cannot drift from the numbers it describes; a hand-written one
 * stays true only until the next pass.
 */
export function adjudicationProvenance(doc) {
  const events = (doc && doc.events) || [];
  const issues = (doc && doc.issues) || {};
  const closes = events.filter((e) => e && e.type === 'issue-closed');

  const perInstant = new Map();
  for (const e of closes) perInstant.set(e.at, (perInstant.get(e.at) || 0) + 1);

  const byTiming = { live: 0, retro: 0, undetermined: 0 };
  const acts = new Map();
  const readings = new Map();
  const rows = [];
  let corruptEvidence = 0;

  for (const e of closes) {
    const iss = issues[e.issueId] || {};
    const t = adjudicationTiming(e, iss, perInstant.get(e.at) || 1);
    byTiming[t.timing] += 1;
    if (t.corruptEvidence) corruptEvidence += 1;
    const k = actKey(e, iss);
    if (!acts.has(k)) acts.set(k, { at: e.at, closedAs: (e.data || {}).closedAs || null, members: [] });
    acts.get(k).members.push(e.issueId);
    // A SECOND, LOOSER COLLAPSE. An act requires a shared instant AND evidence, so one reading
    // applied over several sittings counts as several acts — the live store holds exactly that,
    // 135 closures over 5 evidence strings spread across many instants. Keying on evidence alone
    // would instead merge genuinely independent judgements that happen to cite the same short
    // string. Neither bound is the truth, so BOTH are published and neither is called the answer.
    const ev = iss.evidence != null ? String(iss.evidence).trim() : '';
    if (ev) readings.set(ev, (readings.get(ev) || 0) + 1);
    rows.push({ issueId: e.issueId, at: e.at, closedAs: (e.data || {}).closedAs || null, ...t });
  }

  const actList = [...acts.values()].sort((a, b) => b.members.length - a.members.length);
  const largest = actList[0] || null;

  // The derived-vs-judged split comes from I9's defectBasis. NOTHING carries one today, and that
  // must read as unknown: reporting 0% derived would assert that every classification was a human
  // judgement, which is precisely the claim nobody has made.
  const withBasis = Object.values(issues).filter((i) => i && i.defectBasis).length;

  const rowCount = closes.length;
  const actCount = acts.size;

  return {
    rows,
    summary: {
      closureRows: rowCount,
      adjudicationActs: actCount,
      // How much publishing rows would over-state the judgements. 1.0 means every row is its own act.
      rowsPerAct: actCount ? Number((rowCount / actCount).toFixed(2)) : null,
      // The looser bound: distinct evidence strings, ignoring when they were recorded. The true
      // judgement count sits between this and `adjudicationActs`; publishing one alone picks a
      // side of an uncertainty the record does not resolve.
      distinctEvidenceStrings: readings.size,
      byTiming,
      corruptEvidence,
      largestAct: largest ? { at: largest.at, closedAs: largest.closedAs, size: largest.members.length } : null,
      defectBasisRecorded: withBasis,
      statement: statementFor({ rowCount, actCount, readingCount: readings.size, byTiming, largest, withBasis, corruptEvidence }),
    },
  };
}

/** The provenance sentence a publication must carry. Generated, never hand-written. */
export function statementFor({ rowCount, actCount, readingCount, byTiming, largest, withBasis, corruptEvidence = 0 }) {
  const parts = [];
  parts.push(
    `${rowCount} closure${rowCount === 1 ? '' : 's'} across ${actCount} distinct adjudication act${actCount === 1 ? '' : 's'}` +
    (actCount && rowCount / actCount > 1.05
      ? ` — publishing the closure count would over-state the judgements by ${(rowCount / actCount).toFixed(2)}x, because records sharing one instant, verdict and evidence string are one reading`
      : ''),
  );
  if (readingCount != null) {
    parts.push(
      `Those closures cite ${readingCount} distinct evidence string${readingCount === 1 ? '' : 's'}, so the number of independent judgements lies between ${readingCount} and ${actCount} — the record does not resolve which`,
    );
  }
  if (corruptEvidence > 0) {
    parts.push(
      `${corruptEvidence} closure${corruptEvidence === 1 ? '' : 's'} carry a CORRUPT evidence field (an object reached String() and became \`[object Object]\`). The judgements behind them may have been sound; the record of them is gone, and they are counted as undetermined rather than as either a pass or a defect`,
    );
  }
  parts.push(
    `Timing: ${byTiming.live} judged live, ${byTiming.retro} reconstructed after the fact, ` +
    `${byTiming.undetermined} undetermined — the record does not establish when or on what basis these were judged, ` +
    `which is neither a pass nor a failing mark against them`,
  );
  if (largest && largest.members.length > 1) {
    parts.push(`Largest single act closed ${largest.members.length} findings at ${largest.at}`);
  }
  parts.push(
    withBasis === 0
      ? 'Derived-vs-judged split: UNKNOWN — no closure carries a recorded defect basis, so nothing here says whether a classification was derived from a commit or judged by a person'
      : `${withBasis} closure${withBasis === 1 ? '' : 's'} carry a recorded defect basis`,
  );
  parts.push('Adjudication is internal. The operator is the primary adjudicator, and naming that does not remove the conflict — it records it');
  return `${parts.join('. ')}.`;
}

export default { TIMING, adjudicationTiming, adjudicationProvenance, statementFor };

// ---- CLI --------------------------------------------------------------------------------------

if (isMainModule(import.meta.url)) {
  const { readFileSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { issuesPathFor } = await import('./store-paths.mjs');
  const doc = JSON.parse(readFileSync(issuesPathFor(CW), 'utf8'));
  const p = adjudicationProvenance(doc);
  process.stdout.write(`${JSON.stringify(p.summary, null, 2)}\n`);
}
