#!/usr/bin/env node
// monitor/defect-classify.mjs — propose a defectOwner for closed findings, DERIVING before judging.
//
// THE COUNT THAT LOOKED LIKE 136 JUDGEMENTS IS 8.
//
// fact: 136 closures carry `refuted` and every one has an evidence string, but they hold only EIGHT DISTINCT strings / 124 share one, 6 are the literal text `[object Object]`, and 6 are individually reasoned — so the set is THREE bulk adjudication events, not 136 independent human judgements (measured 2026-08-27, expiry: never, prev: broken)
// fact: "136 findings adjudicated with evidence" is true of each record and false of the set / a reader hears 136 judgements, and the honest sentence names the adjudication events rather than the rows they touched (expiry: never, prev: broken)
// fact: 6 closures recorded their evidence as `[object Object]` — an object reached String() — and their titles are `undefined [tlsHeaders]`, so BOTH the reason and the subject are unrecoverable from the record (expiry: never, prev: broken)
//
// WHY DERIVE BEFORE JUDGING. The party classifying which findings were commitwork's own fault is
// the party being measured. Where a refuted finding was closed because commitwork shipped a fix,
// that fix has a sha and the classification is a LOOKUP — `basis: 'commit'` — not an opinion. The
// 124-group cites the sha of the fix that stopped osv scanning the test gate's worktrees as this
// repo's dependencies. A sha resolves or it does not, so that is checkable by anyone.
//
// Everything not derivable stays `undetermined`. It is not a failure state and must not be filled
// in to make a total look complete — the residual fraction is a published number and is the honest
// measure of how much of any rate rests on judgement.
//
// NOTHING HERE WRITES. It returns a proposal for the operator, who is the adjudicator.

import { isMainModule } from '../lib/is-main.mjs';

/** Evidence that carries no recoverable reasoning. `[object Object]` is a real value in the store. */
export const isUnusableEvidence = (t) => {
  const s = String(t == null ? '' : t).trim();
  return !s || s === '[object Object]' || s === 'undefined' || s === 'null';
};

/** A sha cited in the evidence, or null. Deliberately narrow: 7-40 hex as a whole word. */
export function citedSha(text) {
  const m = /\b([0-9a-f]{7,40})\b/.exec(String(text || ''));
  return m ? m[1] : null;
}

/**
 * Group closures by their evidence string. This is the measurement that matters: it turns a row
 * count into a JUDGEMENT count, and the gap between them is the thing a reader needs told.
 */
export function groupByEvidence(closures) {
  const groups = new Map();
  for (const c of closures || []) {
    const key = String((c && c.evidence) == null ? '' : c.evidence).trim();
    if (!groups.has(key)) groups.set(key, { evidence: key, issueIds: [], unusable: isUnusableEvidence(key), sha: citedSha(key) });
    groups.get(key).issueIds.push(c.issueId);
  }
  return [...groups.values()].sort((a, b) => b.issueIds.length - a.issueIds.length);
}

/**
 * Derive an owner for one evidence group.
 *
 * `shaResolves(sha)` is injected — the caller supplies a git lookup, so this stays pure and the
 * derivation is testable without a repository.
 *
 * Only ONE rule derives, and it is deliberately the narrowest defensible one: a sha that resolves
 * in commitwork's own history means commitwork shipped the fix, which makes the finding an
 * instrument defect by lookup. Everything else is residue. Widening this with keyword heuristics
 * would convert opinion into apparent derivation, which is the failure this whole exercise exists
 * to avoid.
 */
export function deriveOwner(group, { shaResolves }) {
  if (group.unusable) {
    return {
      owner: 'undetermined', basis: null, derived: false,
      why: 'evidence is unrecoverable — the closure recorded no readable reason, so nothing can be derived and nothing should be judged from it',
      evidenceDefect: true,
    };
  }
  if (group.sha && typeof shaResolves === 'function' && shaResolves(group.sha)) {
    return {
      owner: 'instrument', basis: 'commit', derived: true,
      why: `commitwork shipped the fix at ${group.sha} — the classification is a lookup, not a judgement`,
      evidenceDefect: false,
    };
  }
  return {
    owner: 'undetermined', basis: null, derived: false,
    why: group.sha
      ? `evidence cites ${group.sha}, which does not resolve in this repository — it may be an upstream commit, which is exactly what a human or a dual-model pass must decide`
      : 'evidence carries no commit reference, so the owner is a judgement rather than a lookup',
    evidenceDefect: false,
  };
}

/**
 * The proposal. Returns one entry per ISSUE (so it can be applied) plus a report keyed on
 * JUDGEMENTS (so it can be read honestly).
 */
export function proposeClassifications(closures, { shaResolves } = {}) {
  const groups = groupByEvidence(closures);
  const proposals = [];
  let derivedRecords = 0; let residueRecords = 0; let defectRecords = 0;

  for (const g of groups) {
    const d = deriveOwner(g, { shaResolves });
    if (d.evidenceDefect) defectRecords += g.issueIds.length;
    else if (d.derived) derivedRecords += g.issueIds.length;
    else residueRecords += g.issueIds.length;
    for (const issueId of g.issueIds) {
      proposals.push({
        issueId, owner: d.owner, basis: d.basis, derived: d.derived,
        evidence: `${d.why}${g.sha ? '' : ''} [group of ${g.issueIds.length}; source evidence: ${g.evidence.slice(0, 160)}]`,
      });
    }
  }

  const records = closures.length;
  return {
    proposals,
    groups,
    report: {
      records,
      judgements: groups.length,
      // The single sentence a reader needs, because "N adjudicated with evidence" is true of each
      // record and false of the set.
      headline: `${records} closures arise from ${groups.length} distinct adjudication${groups.length === 1 ? '' : 's'}`,
      largestGroup: groups.length ? { size: groups[0].issueIds.length, evidence: groups[0].evidence.slice(0, 120) } : null,
      derivedRecords,
      residueRecords,
      evidenceDefectRecords: defectRecords,
      // What a rate would rest on, stated before anyone computes one.
      derivedFraction: records ? Number((derivedRecords / records).toFixed(3)) : 0,
    },
  };
}

export default { isUnusableEvidence, citedSha, groupByEvidence, deriveOwner, proposeClassifications };

// ---- CLI --------------------------------------------------------------------------------------
// usage: node monitor/defect-classify.mjs [--json]
// Prints the proposal and writes nothing. Applying it is classifyDefect() under an operator gate.

if (isMainModule(import.meta.url)) {
  const { readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { issuesPathFor } = await import('./store-paths.mjs');

  const doc = JSON.parse(readFileSync(issuesPathFor(CW), 'utf8'));
  const closures = (doc.events || [])
    .filter((e) => e.type === 'issue-closed' && (e.data || {}).closedAs === 'refuted')
    .map((e) => ({ issueId: e.issueId, evidence: (e.data || {}).evidence }));

  const shaCache = new Map();
  const shaResolves = (sha) => {
    if (shaCache.has(sha)) return shaCache.get(sha);
    let ok = false;
    try { execFileSync('git', ['-C', CW, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore', timeout: 5000 }); ok = true; } catch { ok = false; }
    shaCache.set(sha, ok);
    return ok;
  };

  const out = proposeClassifications(closures, { shaResolves });
  if (process.argv.includes('--json')) { process.stdout.write(`${JSON.stringify(out, null, 2)}\n`); process.exit(0); }

  process.stdout.write(`${JSON.stringify(out.report, null, 2)}\n\nGROUPS\n`);
  for (const g of out.groups) {
    const d = deriveOwner(g, { shaResolves });
    // THREE states on the line, not two. An unreadable evidence string is not "residue awaiting a
    // judgement" — it is a record defect, and printing them the same way hides six broken closures
    // inside a bucket that reads as ordinary pending work.
    const tag = d.evidenceDefect ? '[NO EVIDENCE]' : (d.derived ? '[derived]    ' : '[residue]    ');
    process.stdout.write(`${String(g.issueIds.length).padStart(4)}x  ${d.owner.padEnd(13)} ${tag} ${g.evidence.slice(0, 92).replace(/\s+/g, ' ')}\n`);
  }
  process.stdout.write('\nNothing written. Applying is classifyDefect() under an operator gate.\n');
}
