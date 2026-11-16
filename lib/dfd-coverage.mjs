// lib/dfd-coverage.mjs — test coverage as a layer over a dfd@1 model: how well each verdict the
// diagram shows is supported by a test, and where it is not.
//
// Three things are measured, and they are different claims:
//   an ELEMENT's coverage   lines and branches of its code a test run executed (nodes[].coverage)
//   a FLOW's coverage       whether a test run drove data along it (flows[].coverage.exercised)
//   a PATCH's control       a test that fails without the patch and passes with it
//                           (patches[].evidence.control) — the only one of the three that is
//                           about the cut itself
// A covered line is not a tested guard: a test can run every line of a parser and assert nothing
// about the bound a patch added. So `tested` and `controlled` are kept apart (patchProof), and a
// path closed by a patch with no control is reported as a gap, not as proven.
//
// Absent is NOT MEASURED, never zero. An element nobody measured is unknown and is listed as
// unmeasured; one measured at 0 of n lines is known to be untested and is listed below the floor.
// Folding the first into the second would report as a finding what nobody looked at.
//
// Everything here is a pure function over the model and builds on lib/dfd.mjs threatPaths, so a
// path, its state and the step that decided it are that module's, not a second copy.

import { threatPaths, IMPACTS } from './dfd.mjs';

/** An element measured below this share of its lines is listed as a gap. */
export const COVERAGE_FLOOR = 0.8;

/** The kinds of gap coverageGaps reports, in the order it lists them within one impact. */
export const GAP_KINDS = Object.freeze(['critical-untouched', 'closed-unproven', 'unevaluated-step', 'below-floor', 'unmeasured-element', 'unexercised-flow']);

const ratio = (c) => (c && c.total > 0 ? c.covered / c.total : null);

/**
 * -> { measured, lines, branches }. `lines` and `branches` are shares from 0 to 1, or null when the
 * element was not measured, the part was not reported, or its total is 0 (nothing to cover is not
 * full coverage).
 */
export function nodeCoverage(node) {
  const c = node && node.coverage;
  if (!c) return { measured: false, lines: null, branches: null };
  return { measured: true, lines: ratio(c.lines), branches: ratio(c.branches) };
}

/**
 * How far a patch's cut is proven:
 *   belt-and-braces  as controlled, with a second control of another kind that also holds
 *   controlled  evidence.level tested AND a run-time control (kind test or dynamic-assert) that fails
 *               without the patch and passes with it
 *   static      only a compile-time control holds (kind static-assert): the baseline does not build,
 *               which says nothing about run time
 *   tested      evidence.level tested, with no control or one that is not both
 *   unproven    anything else (inspected, rescanned, asserted, or no evidence at all)
 */
export function patchProof(patch) {
  const ev = patch && patch.evidence;
  const kinds = new Set(patchControls(patch).filter((c) => c.failsWithout === true && c.passesWith === true).map((c) => c.kind || 'test'));
  const tested = !!ev && ev.level === 'tested';
  if (tested && (kinds.has('test') || kinds.has('dynamic-assert'))) return kinds.size > 1 ? 'belt-and-braces' : 'controlled';
  if (kinds.has('static-assert')) return 'static';
  return tested ? 'tested' : 'unproven';
}

/** Every control a patch carries: evidence.control, then evidence.controls. */
export function patchControls(patch) {
  const ev = patch && patch.evidence;
  return ev ? [...(ev.control ? [ev.control] : []), ...(ev.controls || [])] : [];
}

/** The proofs that show a cut at run time. `static` is not one: a compile-time assertion says nothing about run time. */
export const PROVEN = Object.freeze(['belt-and-braces', 'controlled']);

/**
 * Every source-to-impact path (threatPaths) with what tests say about it:
 *   steps       { total, withVerdict }: its flows, and those whose step is not unevaluated
 *   exercised   { total, measured, exercised }: its flows, those that carry coverage, and those a
 *               test drove data along
 *   belowFloor  elements on it that were measured under `floor` of their lines
 *   unmeasured  elements on it with no coverage at all. A source (nothing flows into it) and an
 *               impact are left out: they stand for an input and a harm, not for code a test runs
 * `nodes`, `flows`, `impact`, `state`, `decidedBy` and `proven` are threatPaths's. `truncated` is
 * true when maxPaths cut the list.
 */
export function pathCoverage(model, { applied, known, floor = COVERAGE_FLOOR, maxPaths } = {}) {
  const tp = threatPaths(model, { applied, known, ...(maxPaths === undefined ? {} : { maxPaths }) });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const paths = tp.paths.map((p) => {
    const covered = p.flows.filter((k) => model.flows[k].coverage);
    return {
      nodes: p.nodes,
      flows: p.flows,
      impact: p.impact,
      state: p.state,
      decidedBy: p.decidedBy,
      proven: p.proven,
      steps: { total: p.flows.length, withVerdict: p.flows.filter((k) => tp.steps[k].state !== 'unevaluated').length },
      exercised: { total: p.flows.length, measured: covered.length, exercised: covered.filter((k) => model.flows[k].coverage.exercised === true).length },
      belowFloor: p.nodes.filter((id) => { const c = nodeCoverage(byId.get(id)); return c.measured && c.lines !== null && c.lines < floor; }),
      // nodes[0] is the path's source and its last node the impact it ends in
      unmeasured: p.nodes.slice(1).filter((id) => !byId.get(id).impact && !nodeCoverage(byId.get(id)).measured),
    };
  });
  return { steps: tp.steps, paths, truncated: tp.truncated };
}

const worse = (a, b) => IMPACTS.indexOf(a) < IMPACTS.indexOf(b);
const percent = (x) => `${Math.round(x * 100)}%`;

/**
 * Where a verdict the diagram shows is not supported, worst impact first, then in GAP_KINDS order,
 * then in the order found. Each gap: { kind, impact, path, detail } with `node`, `flow` (an index
 * into model.flows) or `patch` naming what it is about. One gap per element, flow or patch: when
 * several paths meet in it, the gap carries the worst of their impacts and one path of that impact.
 *
 *   critical-untouched   a critical path that is not closed and has no flow a test exercised
 *   closed-unproven      a closing step whose patch has no control (patchProof is not controlled),
 *                        or that is a safe verdict with no runtime proof; one gap per step
 *   unevaluated-step     a flow on a path that nobody has evaluated
 *   below-floor          an element on a path measured under the floor
 *   unmeasured-element   an element on a path that no test run measured
 *   unexercised-flow     a flow on a path that a test run measured and never exercised
 */
export function coverageGaps(model, { applied, known, floor = COVERAGE_FLOOR, maxPaths } = {}) {
  const { steps, paths } = pathCoverage(model, { applied, known, floor, maxPaths });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const patches = new Map((model.patches || []).map((p) => [p.id, p]));
  const found = new Map();
  const add = (key, gap) => {
    const had = found.get(key);
    if (!had) found.set(key, gap);
    else if (worse(gap.impact, had.impact)) { had.impact = gap.impact; had.path = gap.path; }
  };
  const flowName = (k) => `${model.flows[k].from} -> ${model.flows[k].to}`;
  for (const p of paths) {
    if (p.impact === 'critical' && p.state !== 'closed' && p.exercised.exercised === 0) {
      add(`critical-untouched ${p.flows.join('>')}`, { kind: 'critical-untouched', impact: p.impact, path: p.nodes,
        detail: `a critical path that is ${p.state === 'open' ? 'open' : 'not evaluated'}, and no test exercised any of its ${p.flows.length} flow(s)${p.exercised.measured ? '' : ' (none was measured)'}` });
    }
    if (p.state === 'closed') {
      const k = p.decidedBy;
      if (steps[k].state === 'fixed') {
        // one gap per closing step, naming every patch on it that lacks a control: the page lists the same rows
        const weak = steps[k].by.filter((id) => !PROVEN.includes(patchProof(patches.get(id))));
        if (weak.length) {
          const say = (id) => (patchProof(patches.get(id)) === 'tested' ? `patch ${id}: tested, with no control showing the test fails without the patch`
            : patchProof(patches.get(id)) === 'static' ? `patch ${id}: a compile-time assertion only, with nothing shown at run time`
            : `patch ${id}: its evidence is ${patches.get(id).evidence ? patches.get(id).evidence.level : 'absent'}, not a test`);
          add(`closed-unproven flow ${k}`, { kind: 'closed-unproven', impact: p.impact, path: p.nodes, flow: k, patch: weak[0], patches: weak,
            detail: `closed at ${flowName(k)} by ${weak.map(say).join('; ')}` });
        }
      } else if (!steps[k].proven) {
        add(`closed-unproven flow ${k}`, { kind: 'closed-unproven', impact: p.impact, path: p.nodes, flow: k,
          detail: `closed by a safe verdict at ${flowName(k)} with no runtime proof` });
      }
    }
    for (const k of p.flows) {
      if (steps[k].state === 'unevaluated') add(`unevaluated-step ${k}`, { kind: 'unevaluated-step', impact: p.impact, path: p.nodes, flow: k, detail: `nobody has evaluated ${flowName(k)}` });
      const c = model.flows[k].coverage;
      if (c && c.exercised === false) add(`unexercised-flow ${k}`, { kind: 'unexercised-flow', impact: p.impact, path: p.nodes, flow: k, detail: `a test run measured ${flowName(k)} and never exercised it` });
    }
    for (const id of p.belowFloor) {
      add(`below-floor ${id}`, { kind: 'below-floor', impact: p.impact, path: p.nodes, node: id,
        detail: `${id} is measured at ${percent(nodeCoverage(byId.get(id)).lines)} of its lines, under the floor of ${percent(floor)}` });
    }
    for (const id of p.unmeasured) add(`unmeasured-element ${id}`, { kind: 'unmeasured-element', impact: p.impact, path: p.nodes, node: id, detail: `no test run measured ${id}` });
  }
  return [...found.values()].map((g, i) => [g, i])
    .sort(([a, i], [b, j]) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact) || GAP_KINDS.indexOf(a.kind) - GAP_KINDS.indexOf(b.kind) || i - j)
    .map(([g]) => g);
}

/**
 * The layer in counts. Elements and flows are counted only when they lie on at least one path to an
 * impact: code no path reaches is not this layer's question. Patches are all the document's.
 *   elements  { total, measured, belowFloor }
 *   flows     { total, measured, exercised }
 *   patches   { total, beltAndBraces, controlled, static, tested, unproven }
 *   paths     { total, allStepsExercised, noStepExercised }
 *   gaps      a count per kind in GAP_KINDS, zero included
 *   measuredAnything  false when no element or flow carries coverage and no patch a control: every
 *                     figure above is then an absence of measurement, not a result
 */
const count = (xs, x) => xs.filter((y) => y === x).length;

export function coverageSummary(model, { applied, known, floor = COVERAGE_FLOOR, maxPaths } = {}) {
  const opts = { applied, known, floor, maxPaths };
  const { paths } = pathCoverage(model, opts);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const nodeIds = new Set(paths.flatMap((p) => p.nodes));
  const flowIx = new Set(paths.flatMap((p) => p.flows));
  const nodeCov = [...nodeIds].map((id) => nodeCoverage(byId.get(id)));
  const flowCov = [...flowIx].map((k) => model.flows[k].coverage).filter(Boolean);
  const proofs = (model.patches || []).map(patchProof);
  const gaps = Object.fromEntries(GAP_KINDS.map((k) => [k, 0]));
  for (const g of coverageGaps(model, opts)) gaps[g.kind]++;
  return {
    elements: { total: nodeIds.size, measured: nodeCov.filter((c) => c.measured).length, belowFloor: nodeCov.filter((c) => c.measured && c.lines !== null && c.lines < floor).length },
    flows: { total: flowIx.size, measured: flowCov.length, exercised: flowCov.filter((c) => c.exercised === true).length },
    patches: { total: proofs.length, beltAndBraces: count(proofs, 'belt-and-braces'), controlled: count(proofs, 'controlled'), static: count(proofs, 'static'), tested: count(proofs, 'tested'), unproven: count(proofs, 'unproven') },
    paths: { total: paths.length, allStepsExercised: paths.filter((p) => p.exercised.total > 0 && p.exercised.exercised === p.exercised.total).length, noStepExercised: paths.filter((p) => p.exercised.exercised === 0).length },
    gaps,
    measuredAnything: model.nodes.some((n) => !!n.coverage) || model.flows.some((f) => !!f.coverage) || (model.patches || []).some((p) => !!(p.evidence && p.evidence.control)),
  };
}
