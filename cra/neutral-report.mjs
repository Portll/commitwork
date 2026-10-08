// cra/neutral-report.mjs — the neutral report, published.
//
// cra/vex.mjs has always collected ONE statement set and projected it into CycloneDX VEX, CSAF 2.0,
// CSAF 2.1 and OpenVEX. That intermediate is the superset, and it had no schema and no consumer
// outside cra/ — taxonomy class 1.30, structured data with no schema, filed against three other
// artifacts in this tree before this one.
//
// WHAT IT CARRIES THAT NO TARGET FORMAT CAN. The standards model findings; this models findings and
// the reliability of the looking. Every field in `looking` is computed by the fleet today and has
// nowhere to go in any of the four outputs:
//
//   coverage      the lane ran and was half-blind, and whether the gap was MEASURED or merely signalled
//   voids         a lane produced nothing trustworthy, WITH its cause — absence of a finding is not a finding
//   fixtures      findings describing a test corpus rather than the software
//   vintage       which scanner build produced these rows, and whether one batch had several
//   corroboration how many independent analysts saw it (measured here: 96.15% saw one)
//   reachability  who proved it and how — CycloneDX's justification enum is the wrong axis
//   vdb           the advisory database's build date, which bounds what an ABSENCE means
//
// NOTHING IS INVENTED. Every value is read from an artifact that already exists, and a field the
// rollup does not carry is `null` with the reason, never a default that reads as measured. That is
// the whole discipline: a superset that fabricates is worse than a standard that omits.
import { readFileSync } from 'node:fs';
import { collectStatements, fidelityFor } from './vex.mjs';

export const SPEC_VERSION = 'commitwork-report/1.0';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Per-lane coverage, read from the rollup's own scanner blocks. Absent ⇒ absent, never 'full'. */
export function coverageOf(rollup) {
  const out = [];
  for (const [lane, s] of Object.entries((rollup && rollup.scanners) || {})) {
    if (!s || typeof s !== 'object') continue;
    // A lane with no coverage key predates the field. That is its own state and must not be
    // reported as 'full' — the distinction between "measured complete" and "never asked" is the
    // one this whole file exists to keep.
    if (!s.coverage) continue;
    out.push({
      lane,
      coverage: ['full', 'reduced', 'unknown'].includes(s.coverage) ? s.coverage : 'unknown',
      ...(s.coverageBasis ? { basis: s.coverageBasis } : {}),
      reason: s.coverageReason || s.reducedReason || s.unknownReason || null,
    });
  }
  return out.sort((a, b) => a.lane.localeCompare(b.lane));
}

/** Voids WITH their cause. A count of unknowns with no per-item reason is a number nobody can check. */
export function voidsOf(rollup) {
  const out = [];
  for (const [lane, s] of Object.entries((rollup && rollup.scanners) || {})) {
    if (!s || !num(s.noscan)) continue;
    if (s.noscanReason) out.push({ lane, repo: null, reason: String(s.noscanReason) });
  }
  for (const r of (rollup && rollup.repos) || []) {
    for (const v of r.noscanReasons || []) {
      if (v && v.check && v.reason) out.push({ lane: String(v.check), repo: r.name || null, reason: String(v.reason) });
    }
  }
  return out.sort((a, b) => a.lane.localeCompare(b.lane) || String(a.repo).localeCompare(String(b.repo)));
}

/** Fixture rows, summed from the per-category detail blocks that carry them. */
export function fixturesOf(rollup) {
  let rows = 0, broken = 0, seen = false;
  for (const s of Object.values((rollup && rollup.scanners) || {})) {
    const d = s && s.detail;
    if (!d || typeof d.fixtureRows !== 'number') continue;
    seen = true; rows += d.fixtureRows; broken += num(d.brokenOnPurposeRows) || 0;
  }
  if (!seen) return null;
  return { rows, brokenOnPurpose: broken,
    note: 'Classified, never dropped: these rows describe a test corpus rather than the software, and are counted apart rather than removed from the evidence.' };
}

/** Which scanner build produced the rows. Reads rollup.vintage.code, written by monitor/vintage.mjs. */
export function vintageOf(rollup) {
  const c = rollup && rollup.vintage && rollup.vintage.code;
  if (!c) return { distinct: 0, recorded: 0, unrecorded: 0, mixed: false,
    note: 'this rollup predates the runner-vintage receipt — the build that produced these rows is UNRECORDED, which is not the same as one build' };
  return {
    distinct: num(c.distinct) ?? 0,
    recorded: num(c.recorded) ?? 0,
    unrecorded: num(c.unrecorded) ?? 0,
    mixed: c.mixed === true,
    note: c.note || null,
  };
}

/** The advisory database's build date — the bound on what an ABSENCE can mean. */
export function vdbOf(rollup) {
  for (const s of Object.values((rollup && rollup.scanners) || {})) {
    if (s && s.vdb && (s.vdb.builtAt || s.vdb.image)) {
      return { image: s.vdb.image || null, builtAt: s.vdb.builtAt || null, pulledAt: s.vdb.pulledAt || null, bound: s.vdb.bound || null };
    }
  }
  return null;
}

/**
 * Build the neutral report. Same inputs as buildAll, so the two cannot describe different worlds.
 * @returns the document; validate it with `node bin/validate-artifact.mjs commitwork-report <file>`
 */
export function buildReport(product, manufacturer, rollup, ledgerEntries, annDoc, atIso, opts = {}) {
  const statements = collectStatements(product, rollup, ledgerEntries, annDoc, atIso);
  return {
    $schema: '../schema/commitwork-report.schema.json',
    specVersion: SPEC_VERSION,
    generated: atIso,
    product: { name: product.name, version: product.version || null, repos: product.repos || [] },
    manufacturer: manufacturer || null,
    statements,
    looking: {
      coverage: coverageOf(rollup),
      voids: voidsOf(rollup),
      fixtures: fixturesOf(rollup),
      vintage: vintageOf(rollup),
      corroboration: (rollup && rollup.corroboration) || null,
      reachability: (rollup && rollup.scanners && rollup.scanners.depsReachability) || null,
      vdb: vdbOf(rollup),
    },
    fidelity: fidelityFor(statements, opts),
  };
}

/** Convenience for the CLI paths that already hold file paths rather than parsed documents. */
export function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
