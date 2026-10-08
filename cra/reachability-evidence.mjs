// cra/reachability-evidence.mjs — the call-graph producer for the Phase-4 evidence gate.
//
// The gate in cra/determination.mjs refuses a reachability claim without evidence carrying
// `method: 'call_graph'`. This is the only thing in the tree that may mint that evidence, and it
// mints it from ONE analyser: govulncheck, whose proof is the Go compiler's own call graph.
//
// WHAT GOVULNCHECK CAN AND CANNOT PROVE. It can prove `reachable` — a traced path to the vulnerable
// symbol. It CANNOT prove `unreachable_static`: a module-level finding means it did not show a
// path, not that no path exists. monitor/extractors.mjs already types that distinction
// (`reachability: 'reachable' | 'unproven'`, `proofKind: 'compiler-callgraph' | 'none'`) and this
// file preserves it. So, stated plainly:
//
//   NOTHING IN THE FLEET CAN CURRENTLY ASSERT `unreachable_static`.
//
// That is a true statement about our evidence, not a gap in this file, and the gate is doing its
// job by refusing every attempt until an analyser that proves absence exists.
//
// dep-scan's lane (depsReachability) is DELIBERATELY NOT a call-graph source. Its `exploitable` is a
// static slice over an intermediate representation, and its default `in_triage` was once read as
// REACHABLE for 100 of 105 findings whose true proof count was zero (see CLAUDE.md). It is admitted
// only as `scanner_default`, which satisfies no reachability determination — the lesson enforced
// structurally rather than by remembering it.
//
// Zero deps.

import { REACHABILITY } from './determination.mjs';
import { resolveVia } from './advisory-aliases.mjs';

/** Identity for joining reachability onto a finding. Excludes line and severity, per the house rule. */
export const reachKey = (repo, id, pkg) => `${repo}|${String(id || '').toUpperCase()}|${pkg || ''}`;

// The typed contract monitor/extractors.mjs writes for the depsGo lane. Matched on the TYPED
// fields, never on `message` — the extractor's own comment warns that two engines emitting the word
// "reachable" in prose make two very different claims look identical.
const GO_PROVER = 'govulncheck';
const GO_PROOF = 'compiler-callgraph';

/**
 * Map one govulncheck detail row to a native reachability value + the evidence that supports it.
 * Returns null when the row is not a govulncheck call-graph result, so an unknown prover is
 * skipped rather than adopted.
 */
export function reachabilityFromGoRow(row, atIso) {
  if (!row || row.prover !== GO_PROVER) return null;
  if (row.reachability === 'reachable' && row.proofKind === GO_PROOF) {
    return {
      reachability: 'reachable',
      evidence: { source: GO_PROVER, method: 'call_graph', confidence: 'high', at: atIso,
        detail: 'govulncheck traced a call path to the vulnerable symbol through the Go compiler call graph' },
    };
  }
  if (row.reachability === 'unproven') {
    return {
      // NOT unreachable_static. govulncheck showed no path; it did not show that none exists.
      reachability: 'reachability_unproven',
      evidence: { source: GO_PROVER, method: 'call_graph', confidence: 'medium', at: atIso,
        detail: 'govulncheck analysed the module and traced no call path to the vulnerable symbol — absence of proof, not proof of absence' },
    };
  }
  return null;
}

/**
 * dep-scan rows are admitted, but as evidence of NOTHING a reachability determination can rest on.
 * Returned so a consumer can display the claim and see why it does not count, rather than the row
 * silently vanishing — an unseen exclusion is indistinguishable from an unseen finding.
 */
export function reachabilityFromDepScanRow(row, atIso) {
  if (!row) return null;
  return {
    reachability: 'reachability_unknown',
    evidence: { source: 'dep-scan', method: 'scanner_default', confidence: 'low', at: atIso,
      detail: `dep-scan reachability='${row.reachability}' is a static slice over an intermediate representation, not a call graph; it cannot support a reachability determination` },
  };
}

// scannerFindings lives at the ROLLUP level and each row carries its own `repo` — the rollup
// prepends it on the fleet flatten. This read `rollup.repos[].scannerFindings` in its first version
// and therefore saw NOTHING: 172 repos across 34 areas carry no such key, while
// rollup.scannerFindings.depsGo held 268 govulncheck rows. The tests passed because they fed a
// per-repo fixture this module had invented. Measured against the live reports 2026-08-23, which is
// the only reason it was caught — every unit test agreed with the bug.
const rowsOf = (rollup, lane) => {
  const l = rollup && rollup.scannerFindings && rollup.scannerFindings[lane];
  if (!l) return [];
  return Array.isArray(l) ? l : (Array.isArray(l.findings) ? l.findings : []);
};

/**
 * Build the reachability index for a rollup.
 * Returns a Map of reachKey → {reachability, evidence, repo, id, package}.
 *
 * PRECEDENCE IS EXPLICIT: a govulncheck row always wins over a dep-scan row for the same finding,
 * because one carries a call graph and the other does not. Two govulncheck rows for one key cannot
 * disagree (the extractor dedupes by osv+reachability), but if they ever do, `reachable` wins —
 * a proven path is not cancelled by a second pass that failed to find one.
 */
export function buildReachabilityIndex(rollup, atIso) {
  const index = new Map();
  const put = (repo, row, mapped) => {
    if (!mapped) return;
    const key = reachKey(repo, row.id, row.package);
    const prev = index.get(key);
    if (prev) {
      const prevIsCallGraph = prev.evidence.method === 'call_graph';
      const nextIsCallGraph = mapped.evidence.method === 'call_graph';
      if (prevIsCallGraph && !nextIsCallGraph) return;                       // never downgrade
      if (prevIsCallGraph && nextIsCallGraph && prev.reachability === 'reachable') return;
    }
    index.set(key, { ...mapped, repo, id: String(row.id || '').toUpperCase(), package: row.package || '' });
  };

  // A row with no `repo` is SKIPPED, not attributed to a guess: an unattributed reachability proof
  // joined to the wrong repo is worse than no proof at all.
  for (const row of rowsOf(rollup, 'depsGo')) {
    if (row.repo) put(row.repo, row, reachabilityFromGoRow(row, atIso));
  }
  for (const row of rowsOf(rollup, 'depsReachability')) {
    if (row.repo) put(row.repo, row, reachabilityFromDepScanRow(row, atIso));
  }
  return index;
}

/**
 * The reachability determination for one finding, and the evidence behind it.
 * A finding with no analyser row is `reachability_unknown` with NO evidence — which the gate will
 * correctly refuse any stronger claim on. explicit uncertainty: absent analysis is its own state.
 */
export function reachabilityFor(index, repo, id, pkg, aliasIndex = null) {
  const direct = index.get(reachKey(repo, id, pkg));
  if (direct) return { reachability: direct.reachability, evidence: [direct.evidence], via: String(id).toUpperCase(), aliased: false };

  // The join without this was 0.31%: govulncheck proves against GO-2026-xxxx while the dependency
  // lane records CVEs. `via` is carried so a consumer states WHICH advisory carries the proof
  // rather than presenting one from nowhere, and an ambiguous alias is REFUSED, not picked.
  if (aliasIndex) {
    const r = resolveVia(aliasIndex, id, (cand) => index.get(reachKey(repo, cand, pkg)));
    if (r.refused) {
      return { reachability: 'reachability_unknown', evidence: [], refused: r.refused, claimedBy: r.claimedBy,
        why: `advisory ${id} is claimed by more than one Go advisory (${(r.claimedBy || []).join(', ')}); refusing to attribute a reachability proof to one of them` };
    }
    if (r.hit) {
      return { reachability: r.hit.reachability, evidence: [r.hit.evidence], via: r.via, aliased: true, fanOut: r.fanOut };
    }
  }
  return {
    reachability: 'reachability_unknown',
    evidence: [],
    why: aliasIndex
      ? 'no call-graph analyser produced a row for this finding, under any of its aliases'
      : 'no call-graph analyser produced a row for this finding (no alias index supplied)',
  };
}

/** What the fleet can and cannot currently prove — rendered, never assumed. */
export function proverCoverage(index) {
  const out = { reachable: 0, reachability_unproven: 0, reachability_unknown: 0, byMethod: {} };
  for (const v of index.values()) {
    out[v.reachability] = (out[v.reachability] || 0) + 1;
    out.byMethod[v.evidence.method] = (out.byMethod[v.evidence.method] || 0) + 1;
  }
  // Stated explicitly so a reader never infers it from a zero: no analyser here proves absence.
  out.canAssertUnreachableStatic = false;
  out.note = 'unreachable_static has NO producer in this fleet. govulncheck proves reachability, not '
    + 'its absence; the gate refuses the stronger claim by design.';
  return out;
}

/** Sanity: every value this module can emit must be a declared Axis-B value. */
export const EMITTED = Object.freeze(['reachable', 'reachability_unproven', 'reachability_unknown']);
for (const v of EMITTED) {
  if (!Object.prototype.hasOwnProperty.call(REACHABILITY, v)) {
    throw new Error(`reachability-evidence.mjs can emit '${v}', which is not a declared Axis-B value`);
  }
}
