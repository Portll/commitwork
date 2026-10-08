#!/usr/bin/env node
// monitor/detector-identity.mjs — the address an upstream fix would be sent to.
//
// WHAT A DETECTOR IS, AND WHY IT IS NOT THE LANE. A lane is which scanner ran. A detector is the
// smallest unit an upstream maintainer could FIX: TruffleHog's MongoDB detector, Scorecard's
// Branch-Protection check, Prowler's githubactions_workflow_security_scan. The leverage claim —
// one defect fixed at source propagates to every downstream user of that scanner, permanently —
// is a claim about detectors, and it needs an identity to be a claim about anything at all.
//
// fact: FOUR lanes published `(unnamed)` as their only rule — cspm, supplyChainPosture, secretsHistory, accessibility — 1,571 rows with no identity between them (measured 2026-08-26, expiry: never, prev: broken)
// fact: all four carry an identity the extractor did not read, confirmed against live artifacts / the data was never missing, it was one field over — the same shape as GuardDog, where 673 of 676 rows carried an empty package name because the parser looked for `name@version` and the tool writes `On package: <name> version: <ver>` (expiry: never, prev: broken)
//
// So this is not a coverage bound to disclose. It is four field reads, and it takes the leverage
// claim from 39 of 43 lanes to 43 of 43.
//
// EXTRACTION IS DECLARED, NEVER INFERRED. One entry per tool. A tool absent from the table returns
// `{ id: null, why: 'no extractor declared' }` — loudly unknown rather than quietly absent, because
// a detector silently reading null is exactly how the four lanes above published 1,571 anonymous
// rows without anyone noticing.
//
// THE ADDRESS PROPERTY, which is the whole point: two findings that share a detector id are
// closable by ONE upstream fix. Anything that breaks that equivalence — folding two detectors into
// one id, or splitting one detector across two — breaks the leverage arithmetic, so the id is the
// tool's own identifier verbatim and is never normalised into prose.

/** Per-tool extraction. Field paths measured against live artifacts 2026-08-26. */
export const DETECTOR_SOURCES = Object.freeze({
  // TruffleHog JSON-lines: `DetectorName` is the detector's own name; DetectorType is its numeric
  // twin and is NOT used as the id — a number is not an address a maintainer can act on.
  trufflehog: { path: ['DetectorName'], example: 'MongoDB' },
  // OpenSSF Scorecard: 18 named checks per run; the row IS the check.
  scorecard: { path: ['name'], example: 'Branch-Protection' },
  // Prowler OCSF. `finding_info.analytic.uid` is the clean field; `metadata.event_code` carries the
  // same value and is the fallback. The composite `finding_info.uid` also contains it
  // (`prowler-github-<check>-<owner>-<owner>-<repo>`) and is deliberately NOT parsed — extracting an
  // id by slicing a string that also encodes repo coordinates would break on the first repo whose
  // name contains a hyphen.
  prowler: { path: ['finding_info', 'analytic', 'uid'], fallback: ['metadata', 'event_code'], example: 'githubactions_workflow_security_scan' },
  // WCAG: the success criterion is the identity. The detector is our own check of that criterion,
  // so the id is the criterion number — an upstream fix here is a fix to bin/a11y-scan.mjs.
  a11y: { path: ['id'], example: '1.4.4' },
  // SARIF-shaped lanes: the rule id already IS the detector address — a semgrep registry rule, a
  // CodeQL query, a gitleaks rule, a GuardDog heuristic. Declared explicitly rather than left to a
  // default, so adding a lane is a decision rather than an omission.
  semgrep: { path: ['ruleId'], alt: ['rule'], example: 'javascript.express.security.audit.xss' },
  codeql: { path: ['ruleId'], alt: ['rule'], example: 'js/request-forgery' },
  gitleaks: { path: ['RuleID'], alt: ['rule'], example: 'generic-api-key' },
  guarddog: { path: ['ruleId'], alt: ['rule'], example: 'typosquatting' },
  gosec: { path: ['ruleId'], alt: ['rule'], example: 'G104' },
  trivy: { path: ['ruleId'], alt: ['rule'], example: 'DS-0026' },
  osv: { path: ['id'], example: 'CVE-2026-33671' },
});

const dig = (obj, path) => {
  let cur = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return null;
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- read-only traversal, nothing is assigned
    cur = cur[k];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : null;
};

/**
 * The detector identity for one raw row from one tool.
 *
 * @returns {{ id: string|null, address: string|null, why: string|null }}
 *   `address` is `<tool>/<id>` — globally unique, so two lanes running the same underlying tool
 *   land on one address and one upstream fix closes both.
 *   `why` is populated ONLY when id is null, and says which kind of null it is.
 */
export function detectorFor(tool, row) {
  const t = String(tool || '').toLowerCase();
  const spec = DETECTOR_SOURCES[t];
  if (!spec) return { id: null, address: null, why: `no extractor declared for tool '${tool}'` };
  if (!row || typeof row !== 'object') return { id: null, address: null, why: 'row is not an object' };

  const id = dig(row, spec.path)
    || (spec.fallback ? dig(row, spec.fallback) : null)
    || (spec.alt ? dig(row, spec.alt) : null);

  if (!id) return { id: null, address: null, why: `tool '${t}' declared, but this row carries no ${spec.path.join('.')}` };
  return { id, address: `${t}/${id}`, why: null };
}

/**
 * Group findings by detector address. This is the leverage arithmetic made explicit: each returned
 * bucket is one upstream fix, and its size is how many findings that fix would close.
 *
 * Rows with no identity are NOT dropped — they collect under `unaddressed`, with their reasons
 * counted, because a leverage figure computed over a silently reduced denominator is exactly the
 * flattering-rate defect this repository exists to catch.
 */
export function byDetector(rows, toolOf = (r) => r && r.tool) {
  const buckets = new Map();
  const unaddressed = [];
  const reasons = {};
  for (const r of rows || []) {
    const { address, why } = detectorFor(toolOf(r), r);
    if (!address) {
      unaddressed.push(r);
      const k = String(why || 'unknown');
      reasons[k] = (reasons[k] || 0) + 1;
      continue;
    }
    if (!buckets.has(address)) buckets.set(address, []);
    buckets.get(address).push(r);
  }
  const total = (rows || []).length;
  return {
    buckets,
    unaddressed,
    report: {
      rows: total,
      addressed: total - unaddressed.length,
      unaddressed: unaddressed.length,
      detectors: buckets.size,
      reasons,
      // The single number the leverage claim rests on: how many findings the biggest single
      // upstream fix would close.
      largestBucket: [...buckets.entries()].reduce((m, [a, v]) => (v.length > m.n ? { address: a, n: v.length } : m), { address: null, n: 0 }),
    },
  };
}

export default { DETECTOR_SOURCES, detectorFor, byDetector };
