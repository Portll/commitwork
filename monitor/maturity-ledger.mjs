#!/usr/bin/env node
// monitor/maturity-ledger.mjs — the beta burn-down: how far each CHECK is from being able to
// support a measurement, and what fraction of its findings anyone has actually adjudicated.
//
// fact: commitwork is in beta and its false positives, missing lanes and unwired lanes are INSTRUMENT defects being redressed, not evidence about the security ecosystem / measuring them now and reporting them as a finding about scanners would conflate "our tool is unfinished" with "the ecosystem is broken" (expiry: at 1.0, prev: unknown)
// fact: the manifest declares 57 checks and only 47 map to a lane, so TEN checks cannot produce a finding at all / a per-LANE ledger cannot see them, because a check with no lane has no lane row to appear in (measured 2026-08-27, expiry: never, prev: missing)
//
// PER CHECK, NOT PER LANE — this is I6, and the ten invisible checks are why. A lane-granular
// ledger would report 47 of 47 and be wrong by omission: the checks that publish nothing are
// exactly the ones whose absence is easiest to miss, because nothing anywhere renders a row for
// them.
//
// FOUR STAGES, and the gap between two of them is the whole beta story:
//
//   declared   — named in the manifest. The floor; a check nobody declared does not exist.
//   wired      — reaches a lane that can carry findings, OR is DECLARED non-publishing (sbom,
//                npm-audit and friends produce artefacts, not findings; that is a design decision
//                and must not read as a gap).
//   producing  — that lane emitted rows in the latest rollup. Absence here is a burn-down item.
//   gradeable  — its rows carry a detector identity, so a finding can be attributed to something a
//                human or an upstream maintainer could act on.
//
// THE ADJUDICATED FRACTION IS FIRST-CLASS, not a footnote. It is the number that gates whether a
// baseline can be frozen at all: with 1,524 of 1,750 issues unadjudicated, no lane set is ready to
// be pre-registered however many lanes are wired. Wiring is the easy half.

import { isMainModule } from '../lib/is-main.mjs';

/** Checks that produce artefacts rather than findings. DECLARED, so their emptiness is not a gap. */
export const NON_PUBLISHING = Object.freeze({
  sbom: 'produces a CycloneDX document, not findings',
  'sbom-syft': 'produces an all-ecosystem SBOM, not findings',
  'npm-audit': 'advisory audit feeding the dep lane; its findings surface there',
  'yarn-audit': 'advisory audit feeding the dep lane; its findings surface there',
  'deps-updates': 'pending update inventory, not a security verdict',
  'deps-renovate': 'checks that update wiring exists; not a finding about code',
  'authz-test': 'a policy test that passes or fails; not a finding stream',
  'jackson-caseinsensitive-guard': 'a targeted guard with a boolean outcome',
  'sast-opengrep': 'comparison arm against the sast lane, excluded from totals',
  'sast-auto': 'comparison arm against the sast lane, excluded from totals',
});

export const STAGES = Object.freeze(['declared', 'wired', 'producing', 'gradeable']);

/**
 * Stage for one check. Ordered, and a check cannot reach a later stage without the earlier one —
 * a lane that emits rows carrying no detector identity is `producing`, never `gradeable`.
 */
export function stageFor({ declared, lane, nonPublishing, producedRows, hasDetectorIdentity }) {
  if (!declared) return { stage: null, why: 'not declared in any manifest — this check does not exist' };
  if (nonPublishing) return { stage: 'wired', why: `declared non-publishing: ${nonPublishing}`, terminal: true };
  if (!lane) return { stage: 'declared', why: 'declared but reaches no lane, so it cannot carry a finding anywhere' };
  if (!producedRows) return { stage: 'wired', why: 'has a lane but emitted no rows in the latest rollup' };
  if (!hasDetectorIdentity) return { stage: 'producing', why: 'emits rows, but they carry no detector identity — a finding here cannot be attributed to anything fixable' };
  return { stage: 'gradeable', why: 'emits rows carrying a detector identity' };
}

/**
 * Build the ledger.
 *
 * @param checks       [{ id, lane }] from the manifest joined to the lane registry
 * @param produced     Set of lane keys that emitted rows in the latest rollup
 * @param addressed    Set of lane keys whose rows carry a detector identity
 * @param adjudication { adjudicated, total } from the issue store
 */
export function buildMaturityLedger({ checks = [], produced = new Set(), addressed = new Set(), adjudication = null, at = null } = {}) {
  const rows = checks.map((c) => {
    const nonPublishing = NON_PUBLISHING[c.id] || null;
    const s = stageFor({
      declared: true, lane: c.lane || null, nonPublishing,
      producedRows: c.lane ? produced.has(c.lane) : false,
      hasDetectorIdentity: c.lane ? addressed.has(c.lane) : false,
    });
    return { check: c.id, lane: c.lane || null, stage: s.stage, why: s.why, ...(s.terminal ? { terminal: true } : {}) };
  }).sort((a, b) => a.check.localeCompare(b.check));

  const tally = {};
  for (const st of STAGES) tally[st] = rows.filter((r) => r.stage === st).length;

  // Checks that COULD reach `gradeable` — a declared non-publishing check never will, by design, so
  // including it in the denominator would manufacture a permanent shortfall.
  const eligible = rows.filter((r) => !r.terminal);
  const gradeable = eligible.filter((r) => r.stage === 'gradeable').length;

  const adjudicated = adjudication ? adjudication.adjudicated : null;
  const total = adjudication ? adjudication.total : null;

  return {
    at,
    rows,
    summary: {
      checksDeclared: rows.length,
      nonPublishingByDesign: rows.filter((r) => r.terminal).length,
      eligibleForFindings: eligible.length,
      tally,
      gradeableFraction: eligible.length ? Number((gradeable / eligible.length).toFixed(3)) : 0,
      // FIRST-CLASS, and deliberately sitting beside the wiring numbers rather than below them.
      adjudicatedFraction: total ? Number((adjudicated / total).toFixed(4)) : null,
      adjudicated, adjudicableTotal: total,
      // UNCONDITIONAL, and stating both numbers. An earlier version branched on adjudicated/total
      // < 0.05 and fell to a vague sentence at 0.0771 — a magic threshold deciding whether a reader
      // is told the actual figures. The numbers are the message; there is no fraction at which a
      // reader stops needing them.
      readiness: total
        ? `${gradeable} of ${eligible.length} checks gradeable; ${adjudicated} of ${total} findings adjudicated (${(adjudicated / total * 100).toFixed(1)}%). Wiring and adjudication are independent — a fully wired fleet with an unadjudicated corpus cannot support a frozen baseline, and the wiring number alone would suggest otherwise.`
        : `${gradeable} of ${eligible.length} checks gradeable; adjudication unknown — no issue store was supplied, which is not the same as none adjudicated`,
    },
  };
}

export default { NON_PUBLISHING, STAGES, stageFor, buildMaturityLedger };

// ---- CLI --------------------------------------------------------------------------------------

if (isMainModule(import.meta.url)) {
  const { readFileSync } = await import('node:fs');
  const { join, dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { SCANNER_CHECKS } = await import('./scanner-checks.mjs');
  const { issuesPathFor } = await import('./store-paths.mjs');
  const { rateBase } = await import('./closure-provenance.mjs');

  const manifest = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
  const laneOf = new Map(Object.entries(SCANNER_CHECKS).map(([lane, check]) => [check, lane]));
  const checks = manifest.checks.map((c) => ({ id: c.id, lane: laneOf.get(c.id) || null }));

  const doc = JSON.parse(readFileSync(issuesPathFor(CW), 'utf8'));
  const rb = rateBase(doc).report;
  const adjudication = { adjudicated: rb.eligibleForRate, total: rb.totalIssues };

  // WITHOUT THIS THE LEDGER LIES BY OMISSION. An earlier CLI passed no rollup and every check read
  // `wired` — not because nothing produces, but because nothing was asked. A maturity ledger whose
  // default is "I did not look" reported as "not yet producing" is the false-clean this repository
  // exists to catch, committed by the burn-down itself.
  const produced = new Set(); const addressed = new Set();
  let rollupRead = null;
  try {
    const { outDirFor } = await import('./area.mjs');
    const { loadRegistry } = await import('./registry.mjs');
    const roll = JSON.parse(readFileSync(join(outDirFor(null, loadRegistry({ quiet: true })), 'rollup.json'), 'utf8'));
    rollupRead = roll.sliceId || 'unknown-slice';
    for (const [lane, rows] of Object.entries(roll.scannerFindings || {})) {
      if (!Array.isArray(rows) || !rows.length) continue;
      produced.add(lane);
      if (rows.some((r) => r && (r.rule || r.id || r.control || r.detector))) addressed.add(lane);
    }
  } catch (e) {
    process.stderr.write(`[ledger] no rollup read (${String(e.message).slice(0, 80)}) — producing/gradeable are UNKNOWN, not zero\n`);
  }

  const led = buildMaturityLedger({ checks, produced, addressed, adjudication, at: process.env.CW_NOW || new Date().toISOString() });
  led.summary.rollupRead = rollupRead;
  process.stdout.write(`${JSON.stringify(led.summary, null, 2)}\n\nSTAGE  CHECK\n`);
  for (const r of led.rows) process.stdout.write(`${String(r.stage).padEnd(10)} ${r.check}${r.terminal ? '  (by design)' : ''}\n`);
}
