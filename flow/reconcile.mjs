// C3 — reconcile the two witnesses.
//
// FALSE NEGATIVES AND FALSE POSITIVES ARE REPORTED SEPARATELY AND NEVER SUMMED INTO A CONFIDENCE.
// Only one of them lies to you: an edge the runtime took and C1 never saw is a hole in the static
// pass, and a hole is what lets a dangling dependency through. An edge C1 claims and the runtime did
// not take is noise — costly, but it does not wave anything through.
//
// THE COVERAGE RESTRICTION IS THE WHOLE DESIGN. A static edge in a module this run never entered is
// not a contradiction; it is an unasked question. Scoring it as disagreement produces a divergence
// count proportional to how much code you did NOT exercise, which looks exactly like a crisis and
// grows as the repo grows.
//
// A ZERO MUST BE MEASURED. If the trace is unusable, or nothing was comparable, `divergence` is
// null and `state` is 'unmeasured'. It is never 0.

import { SCHEMA_VERSION, edgeKey } from './graph.mjs';

const MODULE_PREFIX = 'node:module:';

function pathOf(id) {
  return id.replace(/^node:[a-z]+:/, '');
}

/** Runtime observations -> the same identity shape the static edges use. */
function runtimeKeys(observations) {
  const set = new Set();
  for (const o of observations) set.add(JSON.stringify([o.from, o.to, o.kind]));
  return set;
}

/**
 * -> the reconciliation report. `edges` carries every static edge with `witness` and `existence`
 * resolved; the two axes stay separate (provenance vs verdict) so "unvisited" has somewhere to live.
 */
export function reconcile(graph, runtime) {
  const base = { v: SCHEMA_VERSION, generatedAt: graph.generatedAt || null };

  if (!runtime || runtime.state !== 'usable') {
    return {
      ...base,
      state: 'unmeasured',
      divergence: null,
      reason: runtime ? runtime.reason || `runtime trace ${runtime.state}` : 'no runtime pass supplied',
      comparable: 0,
      falseNegatives: [],
      unconfirmed: [],
      confirmed: [],
      outOfScope: [],
      edges: (graph.edges || []).map((e) => ({ ...e, existence: 'unknown' })),
    };
  }

  const coverage = new Set(runtime.coverage || []);
  const observed = runtimeKeys(runtime.observations || []);
  const staticKeys = new Set();

  const confirmed = [];
  // C1 claimed it, the run entered that module, the edge was not observed.
  //
  // NOT called `falsePositives`, and the rename is a finding rather than a preference. Coverage here
  // is MODULE granularity, so this bucket is the union of two things it cannot separate: a wrong
  // static claim, and a correct claim on a branch this run did not take. Measured: the single
  // occurrence on this repo is readJournalFile('sweep-fleet-journal.jsonl') in a module that was
  // imported but whose function was never called — an unexercised branch, not a wrong claim.
  // Publishing that as `contradicted` would be an unknown wearing a verdict, which is the house's
  // most expensive recorded failure. Separating the two needs statement coverage, which module
  // coverage cannot supply.
  const unconfirmed = [];
  const outOfScope = [];          // module never entered — unknown, NOT a finding
  const edges = [];

  for (const e of graph.edges || []) {
    if (!e.from.startsWith(MODULE_PREFIX)) { edges.push({ ...e, existence: 'unknown' }); continue; }
    const from = pathOf(e.from);
    const to = pathOf(e.to);
    const key = JSON.stringify([from, to, e.kind]);
    staticKeys.add(key);

    if (!coverage.has(from)) {
      outOfScope.push({ from, to, kind: e.kind });
      edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'unvisited' });
      continue;
    }
    if (observed.has(key)) {
      confirmed.push({ from, to, kind: e.kind });
      edges.push({ ...e, witness: 'both', existence: 'confirmed', runtimeCoverage: 'visited' });
      continue;
    }
    // A `touches` edge never claimed a direction, so nothing about it can be contradicted. Same for
    // a module edge the loader satisfies from cache, for a dynamic import that did not fire, and —
    // the one that matters most — for an ENV edge: C2 patches fs and child_process, not
    // process.env, so it cannot witness an env read in either direction. Scoring those as
    // contradicted made every CW_* edge in a traced module a false positive.
    const unfalsifiable = e.kind === 'touches'
      || e.to.startsWith('node:module:')
      || e.to.startsWith('node:env:')
      || [].concat(e.evidence || []).some((x) => String(x).includes('dynamic-import'));
    if (unfalsifiable) {
      edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'visited', unfalsifiable: true });
      continue;
    }
    unconfirmed.push({ from, to, kind: e.kind, evidence: [].concat(e.evidence || [])[0] || null });
    edges.push({ ...e, witness: 'static', existence: 'unknown', runtimeCoverage: 'visited', unconfirmed: true });
  }

  // The direction that lies: the run did it, C1 never saw it.
  //
  // BUT ONLY WHERE C1 COULD HAVE SEEN IT. A path built by a directory walk, or joined out of
  // variables, or taken from argv, is not a literal and never was — C1 makes no claim about it, so
  // scoring it as a miss is a finding manufactured out of a category difference. Measured on this
  // repo before the split existed: tracing one recursive walk produced 2,001 "false negatives",
  // 99.6% of them paths that appear as a literal nowhere in the module that opened them.
  const literalIndex = new Map(
    (graph.modules || []).filter((m) => m.pathLiterals).map((m) => [m.path, m.pathLiterals]),
  );
  const couldHaveSeen = (actor, target) => {
    const lits = literalIndex.get(actor);
    if (!lits || !lits.length) return false;
    const base = String(target).slice(String(target).lastIndexOf('/') + 1);
    return lits.some((l) => l === target || String(target).endsWith(`/${l}`) || l === base);
  };

  // What C1 actually emitted, per actor, so a NAME/LOCATION mismatch is not scored as a miss.
  // C1's node for `join(dir, 'rollup.json')` is the literal `rollup.json`; C2 observes
  // `reports/<area>/rollup.json`. Those are the same edge seen at two resolutions, and calling the
  // difference a false negative is the composed-node problem wearing a verdict.
  const emittedByActor = new Map();
  for (const e of graph.edges || []) {
    if (!e.from.startsWith(MODULE_PREFIX)) continue;
    const a = pathOf(e.from);
    if (!emittedByActor.has(a)) emittedByActor.set(a, []);
    emittedByActor.get(a).push({ to: pathOf(e.to), kind: e.kind });
  }
  const matchesByName = (actor, target, kind) => {
    const t = String(target);
    const base = t.slice(t.lastIndexOf('/') + 1);
    return (emittedByActor.get(actor) || []).some((e) => (e.kind === kind || e.kind === 'touches')
      && (e.to === t || e.to === base || t.endsWith(`/${e.to}`)));
  };

  const falseNegatives = [];
  const dynamicPaths = [];
  const matchedByName = [];
  for (const o of runtime.observations || []) {
    if (!coverage.has(o.from)) continue;                 // an actor outside the analysed set
    if (staticKeys.has(JSON.stringify([o.from, o.to, o.kind]))) continue;
    const row = { from: o.from, to: o.to, kind: o.kind, via: o.via };
    if (matchesByName(o.from, o.to, o.kind)) { matchedByName.push(row); continue; }
    (couldHaveSeen(o.from, o.to) ? falseNegatives : dynamicPaths).push(row);
  }

  const comparable = confirmed.length + unconfirmed.length + falseNegatives.length;
  return {
    ...base,
    state: comparable === 0 ? 'unmeasured' : 'measured',
    reason: comparable === 0 ? 'no edge fell inside the runtime coverage set — nothing was compared' : null,
    divergence: comparable === 0 ? null : falseNegatives.length + unconfirmed.length,
    comparable,
    coverageModules: coverage.size,
    falseNegatives,
    unconfirmed,
    dynamicPaths,          // observed, and outside C1's reach BY CONSTRUCTION — not a finding
    matchedByName,         // same edge at two resolutions (bare literal vs resolved path)
    confirmed,
    outOfScope,
    edges,
  };
}

/** The report leads with the divergence count, and says so when there is not one. */
export function formatReport(r) {
  const head = r.state === 'measured'
    ? `divergence ${r.divergence}  (false negatives ${r.falseNegatives.length}, unconfirmed ${r.unconfirmed.length}) over ${r.comparable} comparable edges`
    : `divergence UNMEASURED — ${r.reason}`;
  return [
    `flow/reconcile: ${head}`,
    `  confirmed by both  ${r.confirmed.length}`,
    `  out of scope (module never entered, NOT a finding)     ${r.outOfScope.length}`,
    `  dynamic paths (never a literal, NOT a finding)         ${(r.dynamicPaths || []).length}`,
    `  matched by name only (bare literal vs resolved path)   ${(r.matchedByName || []).length}`,
    `  runtime coverage   ${r.coverageModules || 0} modules`,
  ].join('\n');
}

export { edgeKey };
