// admin/routes/determinations.mjs — the determination consumer, and why a determination is unknown.
//
// Unknown is the overwhelmingly common determination, and "reachability: unknown" alone tells a
// reader nothing about whether that is a fact about the fleet or a fact about our plumbing. Those
// are opposite conclusions and they look identical.
//
// So `unknownBecause` is the primary output, not a footnote:
//   no-analyser-for-ecosystem  the fleet has ONE reachability analyser (govulncheck, Go). For a
//                              npm/PyPI/crates finding nothing could have proven anything. This is
//                              a gap in our TOOLING and must never read as a gap in the code.
//   analyser-did-not-run       a Go finding in a repo where govulncheck produced no evidence at all.
//   analysed-no-row            govulncheck ran on that repo and emitted no row for this advisory.
//   ambiguous-alias            two Go advisories claim the same CVE; the proof is REFUSED, not picked.
//
// And the denominator is published three ways deliberately. The same work reads very differently
// depending only on which is chosen, and the low one makes working plumbing look broken.
//
// Every route requires a session OR the operator port, matching every other lane.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePaths, loadJSON, nowISO } from '../../cra/lib.mjs';
import { openFindings } from '../../cra/lib.mjs';
import { buildReachabilityIndex, reachabilityFor, proverCoverage } from '../../cra/reachability-evidence.mjs';
import { buildAliasIndex, aliasesOf } from '../../cra/advisory-aliases.mjs';
import { determinationForStatement } from '../../cra/vex.mjs';
import { project } from '../../cra/determination-projection.mjs';

const authed = (ctx) => !!(ctx.isLoopbackReq || (ctx.adminSession(ctx.req) || {}).user);

// The fleet's reachability analysers, by the advisory namespace they can prove against. ONE entry
// today; declared as a map so adding a second is a data change and the "no analyser" reason stays
// accurate by construction rather than by memory.
export const REACHABILITY_ANALYSERS = Object.freeze({ GO: 'govulncheck' });

/** Does any analyser in the fleet cover this advisory? Consults aliases — a CVE may name a GO id. */
export function analyserFor(aliasIndex, id) {
  for (const a of aliasesOf(aliasIndex, id)) {
    const ns = String(a).split('-')[0].toUpperCase();
    if (REACHABILITY_ANALYSERS[ns]) return { analyser: REACHABILITY_ANALYSERS[ns], via: a, namespace: ns };
  }
  return null;
}

const EMPTY = () => ({ proven: 0, unproven: 0, unknown: 0 });

// Lanes that ARE an analyser's own output. Measuring an analyser's coverage over its own rows is
// circular — every one carries evidence by construction. Excluded from the coverage denominators;
// still counted in the population, because they are real findings.
export const ANALYSER_OUTPUT_LANES = Object.freeze(new Set(['depsGo', 'depsReachability']));

// The scanner lane whose per-repo `ran` flag says an analyser EXECUTED, independent of whether it
// found anything. Inferring "the analyser ran" from "the analyser produced rows" is circular: a
// repo where govulncheck ran and found nothing is PERFECTLY covered and would be counted as neither
// numerator nor denominator.
export const ANALYSER_RAN_LANE = 'depsGo';

// Lanes outside the findings population. `stubs` is a metric — TODO density is real
// maintainability signal and is not a vulnerability — and METRIC_CATEGORIES in
// monitor/extractors.mjs enforces it for the producer. It is published as rollup.metrics, but
// scannerFindings.stubs is still a bare array carrying no marker, so a consumer that enumerates
// records rather than reading rollup.metrics readmits every row as work needing tooling.
//
// Read from the artifact when it declares them, so the declaration cannot drift from this copy; the
// literal is the floor for a rollup predating rollup.metrics. Lint lanes join them for the same
// reason: shellcheck and actionlint findings are correctness, and asking them a reachability
// question produces an unknown that means nothing.
export const RULED_OUT_LANES = Object.freeze(new Set(['stubs', 'denoLint', 'denoTypes', 'shellLint', 'actionsLint']));
export function nonFindingLanes(rollup) {
  const declared = Object.keys(rollup?.metrics || {});
  return new Set([...RULED_OUT_LANES, ...declared]);
}

/**
 * Repos where a reachability analyser actually EXECUTED, from the rollup's own check status.
 * Returns null when the rollup carries no per-repo scanner status at all, so the caller degrades
 * with a stated reason instead of silently falling back to the circular signal.
 */
export function analyserRanIn(rollup) {
  const out = new Set();
  let sawStatus = false;
  for (const repo of rollup?.repos || []) {
    const lane = repo.scanners && repo.scanners[ANALYSER_RAN_LANE];
    if (!lane) continue;
    sawStatus = true;
    if (lane.ran === true) out.add(repo.name);
  }
  return sawStatus ? out : null;
}

// ── the POPULATION ──────────────────────────────────────────────────────────────────────────────
// openFindings() reads rollup.repos[].findings — the dependency-CVE lane — and nothing in cra/ reads
// rollup.scannerFindings, so a view built on openFindings alone would describe a fraction of the
// fleet while looking complete.
//
// The two kinds are NOT the same question and are not flattened into one. A dependency finding asks
// "is this third-party vulnerability reachable from our code"; a scanner finding is our own code and
// asks something different. Both take determinations; only the first has any analyser at all.
//
// Identity for a scanner row is repo|rule|file — NEVER the line, per the house rule.
export function* allFindings(rollup, excluded = new Set()) {
  for (const repo of rollup?.repos || []) {
    for (const f of repo.findings || []) {
      const state = f.state || f.status || 'persisting';
      if (/^resolved/.test(state)) continue;
      yield { kind: 'dependency', lane: 'deps', repo: f.repo || repo.name, id: f.id, package: f.package || null,
        severity: f.severity || null, kev: f.kev, epss: f.epss, ref: `${f.repo || repo.name}|${f.id}|${f.package || ''}` };
    }
  }
  for (const [lane, v] of Object.entries(rollup?.scannerFindings || {})) {
    if (excluded.has(lane)) continue;      // ruled not a finding; see RULED_OUT_LANES
    const rows = Array.isArray(v) ? v : (Array.isArray(v.findings) ? v.findings : []);
    for (const r of rows) {
      if (!r || !r.repo) continue;                       // unattributable rows are skipped, never guessed
      yield { kind: 'scanner', lane, repo: r.repo, id: r.id || r.rule || null, package: r.package || null,
        rule: r.rule || null, file: r.file || null, severity: r.sev || r.severity || null,
        ref: `${r.repo}|${r.rule || r.id || ''}|${r.file || r.package || ''}` };
    }
  }
}

/**
 * Build the determination view for one rollup. EVERY row is returned.
 *
 * No cap: an unrequired cap is a silent truncation, and one taken in iteration order can hide every
 * proven reachability behind rows reading `unknown`.
 */
export function determinationView(rollup, aliasIndex, atIso, { rows: rowScope = 'evidenced', lane = null } = {}) {
  const index = buildReachabilityIndex(rollup, atIso);
  const reposWithEvidence = new Set([...index.values()].map((v) => v.repo));
  // Prefer the declared status; fall back to row-presence ONLY when no status exists, and say so.
  const ranIn = analyserRanIn(rollup);
  const ranBasis = ranIn ? 'check-status' : 'row-presence (DEGRADED — the rollup carries no per-repo scanner status, so a repo the analyser cleared is indistinguishable from one it never visited)';
  const ranRepos = ranIn || reposWithEvidence;

  const excluded = nonFindingLanes(rollup);
  const reach = EMPTY();
  const unknownBecause = {
    'no-analyser-for-lane': 0, 'no-analyser-for-ecosystem': 0, 'analyser-did-not-run': 0,
    'analysed-no-row': 0, 'ambiguous-alias': 0,
  };
  const covered = { total: 0, resolved: 0 };   // the honest denominator: analyser exists AND ran here
  const rows = [];
  let total = 0;

  const byLane = {};
  for (const f of allFindings(rollup, excluded)) {
    total++;
    byLane[f.lane] = byLane[f.lane] || { total: 0, proven: 0, unproven: 0, unknown: 0 };
    byLane[f.lane].total++;
    const r = reachabilityFor(index, f.repo, f.id, f.package, aliasIndex);
    const analyser = analyserFor(aliasIndex, f.id);
    // Circular rows excluded: a depsGo row is the proof, not an independent finding to be covered.
    const independent = !ANALYSER_OUTPUT_LANES.has(f.lane);
    const inCoveredRepo = analyser && ranRepos.has(f.repo) && independent;
    if (inCoveredRepo) covered.total++;

    let why = null;
    if (r.reachability === 'reachable') { reach.proven++; byLane[f.lane].proven++; if (inCoveredRepo) covered.resolved++; }
    else if (r.reachability === 'reachability_unproven') { reach.unproven++; byLane[f.lane].unproven++; if (inCoveredRepo) covered.resolved++; }
    else {
      reach.unknown++; byLane[f.lane].unknown++;
      // A scanner finding is our OWN code: no analyser in the fleet answers reachability for it, and
      // the reason is distinct from a dependency in an unanalysed ecosystem. Collapsing the two
      // would hide that 90% of the fleet is a different, larger gap.
      why = r.refused === 'ambiguous-alias' ? 'ambiguous-alias'
        : f.kind === 'scanner' ? 'no-analyser-for-lane'
          : !analyser ? 'no-analyser-for-ecosystem'
            : !ranRepos.has(f.repo) ? 'analyser-did-not-run'
              : 'analysed-no-row';
      unknownBecause[why]++;
    }

    // SCOPE, not a cap. Counts above are always over the whole population; `rowScope` decides which
    // rows travel, it is STATED in the response, and the default is the informative set rather than
    // an arbitrary prefix. The whole population can run to tens of MB.
    const inScope = rowScope === 'all' || (lane && f.lane === lane)
      || (rowScope === 'evidenced' && (r.evidence || []).length > 0);
    if (inScope) {
      const determination = determinationForStatement({ state: 'exploitable' }, r);
      rows.push({
        repo: f.repo, id: f.id, package: f.package || null, severity: f.severity || null,
        kind: f.kind, lane: f.lane, rule: f.rule || null, file: f.file || null,
        determination,
        reachability: r.reachability,
        via: r.via || null, aliased: !!r.aliased, fanOut: r.fanOut || null,
        evidence: (r.evidence || []).map((e) => ({ source: e.source, method: e.method, confidence: e.confidence, detail: e.detail })),
        why, whyText: r.why || null,
        analyser: analyser ? analyser.analyser : null,
        // What each format would be able to say about this determination, and what it would lose.
        projection: determination ? summarise(project(determination, { kev: f.kev, epss: f.epss })) : null,
      });
    }
  }

  // Evidenced rows first — proven, then analysed-no-path, then unknown — and stable within each
  // band, so the table is deterministic and the informative rows are the ones a reader meets first.
  const RANK = { reachable: 0, reachability_unproven: 1 };
  rows.sort((a, b) => (RANK[a.reachability] ?? 2) - (RANK[b.reachability] ?? 2)
    || String(a.repo).localeCompare(b.repo) || String(a.id).localeCompare(b.id));

  return {
    total,
    reachability: reach,
    unknownBecause,
    // THREE DENOMINATORS, all true, published together so none can be quoted alone.
    denominators: {
      allFindings: { of: total, resolved: reach.proven + reach.unproven, pct: pct(reach.proven + reach.unproven, total),
        note: 'Every dependency finding, including ecosystems with no reachability analyser at all. The least meaningful of the three.' },
      analyserExists: { of: countWhere(unknownBecause, reach), resolved: reach.proven + reach.unproven, pct: null,
        note: 'Findings an analyser could in principle cover.' },
      analyserRan: { of: covered.total, resolved: covered.resolved, pct: pct(covered.resolved, covered.total),
        note: 'Findings in repos where the analyser actually produced evidence, EXCLUDING the analyser\'s own output lanes — measuring a tool against rows it emitted is circular. This is the coverage figure that means something.' },
    },
    analysers: REACHABILITY_ANALYSERS,
    // Named, never silent: an exclusion nobody can see reads as a tidier number.
    excludedLanes: { lanes: [...excluded].sort(), why: 'ruled not findings (metrics + correctness linters) — counting them as findings lacking an analyser inflates the gap' },
    reposWithEvidence: reposWithEvidence.size,
    analyserRan: { repos: ranRepos.size, basis: ranBasis,
      clearedNoFindings: ranIn ? [...ranIn].filter((r) => !reposWithEvidence.has(r)).length : null },
    byLane,
    rowScope: { mode: rowScope, lane, shown: rows.length, of: total,
      note: rowScope === 'evidenced'
        ? 'Rows carrying evidence. Counts above cover the WHOLE population; widen with ?rows=all or ?lane=<name>.'
        : 'Explicitly widened scope.' },
    rows,
  };
}

const pct = (n, d) => (d > 0 ? Number(((100 * n) / d).toFixed(1)) : null);
const countWhere = (why, reach) => reach.proven + reach.unproven + why['analyser-did-not-run'] + why['analysed-no-row'] + why['ambiguous-alias'];

function summarise(p) {
  const out = {};
  for (const [fmt, cell] of Object.entries(p.per)) {
    out[fmt] = { status: cell.status?.value || null, lost: cell.lost.length, narrowed: cell.narrowed.length };
  }
  if (p.enrichments.length) out.enrichments = p.enrichments.map((e) => `${e.format}:${e.category}`);
  return out;
}

export const routes = [
  // GET /api/cra/determinations?area=<slug> — determinations + WHY the unknowns are unknown.
  { method: 'GET', path: '/api/cra/determinations', handle: (ctx) => {
    const { send, query } = ctx;
    if (!authed(ctx)) return send(401, { ok: false, error: 'authentication required' });
    const paths = resolvePaths();
    const area = (query && query.get('area')) || null;
    const dir = process.env.CW_REPORTS_DIR || join(paths.root || '.', 'reports');
    const rollupPath = area ? join(dir, area, 'rollup.json') : (paths.rollup || null);
    if (!rollupPath || !existsSync(rollupPath)) {
      // configured:false is NOT "no determinations" — explicit uncertainty.
      return send(200, { ok: true, configured: false, reason: `no rollup at ${rollupPath || '(unset)'}`, area });
    }
    const rollup = loadJSON(rollupPath, null);
    if (!rollup) return send(503, { ok: false, error: 'rollup unreadable — refusing to report an empty determination set' });
    const at = nowISO();
    const aliasIndex = buildAliasIndex();
    const rows = (query && query.get('rows')) || 'evidenced';
    const lane = (query && query.get('lane')) || null;
    const view = determinationView(rollup, aliasIndex, at, { rows, lane });
    return send(200, {
      ok: true, configured: true, area, at,
      aliasIndex: aliasIndex.stats,
      // The fleet cannot prove absence; said here so the tab never has to infer it from a zero.
      canAssertUnreachable: proverCoverage(buildReachabilityIndex(rollup, at)).canAssertUnreachableStatic,
      ...view,
    });
  } },
];
