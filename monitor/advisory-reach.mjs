// advisory-reach.mjs — can the advisory that matched actually REACH the installed artifact?
//
// Measured 2026-08-24 on the 100-repository corpus, after fixture-paths.mjs removed the 24
// dependabot-core rows: the malicious-packages lane was 3 for 3 FALSE.
//
// fact: firebase/firebase-js-sdk, closure-net MAL-2026-276 — the npm package was REAL malware (99.99.1, published 2026-01-12, taken down 2026-01-16), but firebase's yarn.lock pins a git specifier resolving to 0.0.0 from a google-org commit of 2025-09-05, four months before the squat existed / the registry is never consulted, so the advisory describes something the repo never installed (expiry: never, prev: wrong)
// fact: logseq/logseq, fs@0.0.1-security MAL-2025-21003 — `0.0.1-security` IS npm's own security-holder placeholder, so the row reports the TAKEDOWN as the malware (expiry: never, prev: wrong)
//
// Both advisories carry `SEMVER introduced: 0` — every version, no discrimination. osv-scanner
// and npm audit matched on NAME alone. That is an unverified result dressed as a finding, and the house rule is
// that over-reporting is not the safe direction: a fabricated critical costs more than a missed
// one, because it is the number a reader can check.
//
// THE RULE: this file decides ONE decidable question — could the advisory's SEMVER range have
// matched this version? npm's registry REQUIRES semver, so a version with no `major.minor.patch`
// was never resolved from npm, and an npm-ecosystem SEMVER range cannot have matched it. The two
// namespaces are provably disjoint, which is why this cannot demote a registry-sourced package.
//
// WHAT IT DOES NOT DECIDE — and the caller must not imply otherwise: whether the installed
// artifact is safe. A git dependency can be compromised at its source. This file says the
// ADVISORY does not reach it, never that the package is clean.
//
// Classify, never drop (fixture-paths.mjs's rule, and for the same reason). An unreachable row
// keeps its id, package, version, path and its original claim; it moves OUT of crit/high/med/low
// into `unknown` — the vocabulary already in use for 980 unscored rows fleet-wide — and is
// counted under `undetermined`: unmeasured is neither pass nor finding.
//
// KNOWN RESIDUAL (accepted, deliberately): `-security` is an ordinary semver prerelease tag and
// npm does not reserve it, so the loose form /-security$/ would demote any `9.9.9-security` an
// attacker cares to publish. Only the exact literal `0.0.1-security` is matched. An attacker who
// still controls a name could pre-publish exactly that and win a demotion — to `undetermined`,
// which is SURFACED, not to clean. That is the bound on the damage and it is why the routing
// matters more than the detector.
//
// SCOPE: MAL- rows in the npm ecosystem only. A non-npm ecosystem is left alone — Packagist
// accepts `dev-master`, and a rule written for npm would demote every Composer finding.
//
// Env: CW_ADVISORY_REACH=off disables classification entirely; read at CALL time.

import { unknown } from './unknown.mjs'; // ONE predicate for "this is not a result"; the reason comes from its closed set

/** Lockfile basename → OSV ecosystem. Basename only: a vendored lockfile maps the same as a root
 *  one, which is correct — the ecosystem is a property of the file format, not of its depth. */
export const ECOSYSTEM = Object.freeze({
  'package-lock.json': 'npm', 'yarn.lock': 'npm', 'pnpm-lock.yaml': 'npm',
  'requirements.txt': 'PyPI', 'poetry.lock': 'PyPI', 'Pipfile.lock': 'PyPI', 'uv.lock': 'PyPI',
  'go.mod': 'Go', 'go.sum': 'Go', 'Cargo.lock': 'crates.io', 'Gemfile.lock': 'RubyGems',
  'composer.lock': 'Packagist', 'pom.xml': 'Maven', 'gradle.lockfile': 'Maven',
});

export const ecosystemOf = (uri) => ECOSYSTEM[String(uri || '').split('/').pop()] || '';

/** npm's security-holder placeholder. The EXACT string, never a suffix match — see the header. */
export const SECURITY_HOLDER = '0.0.1-security';

const MAL_ID = /^MAL-\d{4}-\d+$/;

/** Anchored, no nested quantifier over a shared class — linear on any input. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const isSemver = (v) => typeof v === 'string' && SEMVER.test(v);

export const enabled = () => process.env.CW_ADVISORY_REACH !== 'off';

/**
 * Decide whether an advisory could have reached the installed version.
 * @param {{id?: string, version?: string, ecosystem?: string, path?: string}} row
 * @returns {{reachable: boolean, code: string|null, reason: string|null}}
 */
export function classify(row) {
  const ok = (code = null, reason = null) => ({ reachable: true, code, reason });
  if (!enabled()) return ok();
  const r = row || {};

  // MAL- only. A scored CVE has a real range and real version evidence; this rule is about
  // blanket `introduced: 0` malware records, and widening it would be a different claim.
  if (!MAL_ID.test(String(r.id || ''))) return ok();

  const eco = r.ecosystem || ecosystemOf(r.path);
  if (eco !== 'npm') return ok();

  // FAIL CLOSED. An absent version means the message grammar did not parse, not that the version
  // is unusual — and `isSemver('')` is false, so demoting here would turn every parse failure
  // into a silent demotion. A row we cannot read stays exactly as the scanner published it.
  const version = typeof r.version === 'string' ? r.version.trim() : '';
  if (!version) return ok();

  // `unknown`/`unknownReason` are set ALONGSIDE this file's own words, which is unknown.mjs's
  // stated migration path. Without them a demoted row fell through LEGACY_STATE_TO_REASON's
  // `undetermined` entry to 'not-adjudicated' — "the analyser ran and declined to determine this
  // one" — which is the opposite of what happened: the analyser asserted a critical, and this
  // file determined the assertion describes something else. 'subject-mismatch' is that state.
  if (version === SECURITY_HOLDER) {
    return { reachable: false, code: 'security-holder', ...unknown('subject-mismatch'),
      reason: `version ${SECURITY_HOLDER} is npm's security-holder placeholder, published in place of a removed package — this is the takedown, not the malware` };
  }

  if (!isSemver(version)) {
    return { reachable: false, code: 'non-semver', ...unknown('subject-mismatch'),
      reason: `version '${version}' is not a semver, so it was not resolved from the npm registry and the advisory's SEMVER range cannot have matched it; this says nothing about whether the installed source is safe` };
  }

  return ok();
}

/** Wording published beside the counts. States the scope limit, not a verdict. */
export const NOTE = 'An undetermined row matched a malicious-package advisory by NAME, but the advisory could not have reached the installed version — a non-semver version was never resolved from the npm registry, and 0.0.1-security is npm\'s own takedown placeholder. Each row keeps its original claim and remains in the artifact; none is counted as crit/high/med/low. This decides reachability of the ADVISORY only, never whether the installed source is safe. Set CW_ADVISORY_REACH=off to count them as published.';

/**
 * Carry an osv row's demotion across to the npm row that describes the SAME advisory.
 *
 * npm audit erases the provenance osv-scanner keeps. Measured 2026-08-24, fleet-wide there is
 * exactly ONE malware row in the npm lane — firebase's closure-net — and npm reports its version
 * as `0.0.0` (what the git checkout's package.json declares) with the advisory range `>=0`. That
 * is a valid semver, so the non-semver rule cannot see what the osv row plainly shows. Left alone,
 * one dependency would be undetermined in one lane and critical in the other: the lane
 * contradicting itself about a single package is worse than the defect this file corrects.
 *
 * The join is deliberately narrow — SAME repo, SAME package name, and the npm row's id must
 * appear in the osv row's alias group (osv-scanner publishes it in rule.deprecatedIds, read from
 * the artifact and never from the network). Nothing is inferred from the name alone: two lanes
 * reporting the same package under unrelated advisories stay independent.
 *
 * Deliberately NOT the general alias collapse. osv and npm still emit two rows for one advisory
 * and that duplication is untouched here; this only stops the pair disagreeing about severity.
 *
 * @param {Array} osvRows rows from parseOsv, already classified
 * @param {Array} npmRows rows from parseNpm
 * @returns {Array} npmRows, with matching rows demoted
 */
export function inheritUndetermined(osvRows, npmRows) {
  if (!enabled()) return npmRows || [];
  const demoted = (osvRows || []).filter((r) => r && r.undetermined);
  if (!demoted.length) return npmRows || [];
  return (npmRows || []).map((n) => {
    if (!n || n.undetermined) return n;
    const twin = demoted.find((o) => o.package && o.package === n.package
      && Array.isArray(o.aliases) && o.aliases.includes(n.id));
    if (!twin) return n;
    return { ...n, severity: 'unknown', undetermined: true, unknown: true, unknownReason: twin.unknownReason || 'subject-mismatch', undeterminedCode: twin.undeterminedCode,
      undeterminedReason: `${twin.undeterminedReason} — carried from ${twin.id}, which names this advisory in its alias group; npm audit reports the version as '${n.version || twin.version}' and does not record that it came from outside the registry`,
      claimedSeverity: n.severity };
  });
}

/**
 * Split rows by reachability. Mirrors fixture-paths.partition: both halves plus a report, so the
 * caller can always recover what was set aside. `unclassified` counts MAL rows that matched
 * neither detector — the residue, measured rather than assumed to be zero.
 * @param {Array} rows
 */
export function partition(rows) {
  const kept = []; const undetermined = []; const byCode = {};
  let malSeen = 0;
  for (const r of rows || []) {
    const isMal = MAL_ID.test(String((r && r.id) || ''));
    if (isMal) malSeen++;
    const c = classify(r);
    if (c.reachable) { kept.push(r); continue; }
    undetermined.push({ ...r, undetermined: true, unknown: true, unknownReason: c.unknownReason, undeterminedCode: c.code, undeterminedReason: c.reason });
    byCode[c.code] = (byCode[c.code] || 0) + 1;
  }
  return {
    kept,
    undetermined,
    report: {
      enabled: enabled(),
      total: (rows || []).length,
      malicious: malSeen,
      undetermined: undetermined.length,
      unclassified: malSeen - undetermined.length,
      byCode,
      note: undetermined.length ? NOTE : '',
    },
  };
}

export default { classify, partition, inheritUndetermined, isSemver, ecosystemOf, enabled, ECOSYSTEM, SECURITY_HOLDER, NOTE };
