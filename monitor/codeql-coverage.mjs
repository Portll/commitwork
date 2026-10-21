// monitor/codeql-coverage.mjs — did the CodeQL lane actually READ the language it claims to cover?
//
// THE FAILURE THIS EXISTS FOR. A CodeQL run whose extractor could not resolve types, could not
// find a build, or hit a restore failure emits WELL-FORMED SARIF with an empty `results` array and
// a ZERO exit code (C# "Failed to determine type" extractor errors are one form). Nothing
// downstream can tell that apart from a clean repository — same bytes, same shape, same verdict.
//
// WHY NOT GATE ON THE DIAGNOSTIC QUERY. `<lang>/diagnostic/database-quality` is PRESENT in good and
// degraded runs alike. Gating on it marks complete scans unreliable, which is
// over-reporting — the mirror failure, and the more expensive direction for a tool whose claim is
// reporting that survives scrutiny.
//
// fact: the denominator is FILES OF THIS LANGUAGE (the manifest's per-lane `appliesIfSourceExt`), never a naive successfully/expected ratio / `expected-extracted-files` lists every file in the SOURCE ARCHIVE, other languages included, so a raw ratio reports every polyglot repo as degraded (expiry: never, prev: wrong)
//
// fact: under the language-aware measure cpp and swift are the lanes that read less than they claim / both are lanes whose build mode the CLI does not fully support, an asymmetry a raw ratio hides (expiry: on re-measure, prev: unknown)
//
// codeqlCoverage() is pure and deterministic: same SARIF + same extension list ⇒ same verdict, no
// I/O and no clock. The two helpers at the foot of the file resolve the extension list from the
// manifest and are the only part that touches disk.

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractionFailure, subtractedBy, sameFile } from './sarif-read.mjs';

/** Ratio at or above which a lane is considered to have read its language. Chosen from measured
 *  runs, NOT invented: healthy lanes sit at a median of 1.00, a few unextracted incidental files
 *  (Python in a C++ repo) land just under 0.90, and genuinely degraded lanes sit well below it. */
export const COVERAGE_FLOOR = 0.9;

const SUCCESS_ID = /successfully-extracted-files$/;
const EXPECTED_ID = /expected-extracted-files$/;

/** Every notification location in a SARIF, split by descriptor id. A SARIF that carries neither
 *  notification is not "fully covered" — it is UNMEASURABLE, and those are different claims. */
function extractionSets(sarif) {
  const succeeded = new Set(), expected = new Set(), failed = [];
  for (const run of (sarif && sarif.runs) || []) {
    for (const inv of run.invocations || []) {
      for (const n of inv.toolExecutionNotifications || []) {
        const f = extractionFailure(n);
        if (f) { failed.push(f.uri); continue; }
        const id = (n.descriptor && n.descriptor.id) || '';
        const uri = ((n.locations || [])[0] || {}).physicalLocation?.artifactLocation?.uri;
        if (!uri) continue;
        if (SUCCESS_ID.test(id)) succeeded.add(uri);
        else if (EXPECTED_ID.test(id)) expected.add(uri);
      }
    }
  }
  // CodeQL lists a file that failed to parse among the successes too (js and go do), so a success
  // set taken at its word reads a partial extraction as complete.
  // A suffix match subtracts only when it names exactly one file (see failedMembers); an ambiguous
  // failure subtracts none, so the count may include a failed file and the reason says the path was ambiguous.
  const subtracted = subtractedBy(failed, succeeded);
  for (const u of subtracted) succeeded.delete(u);
  // A failure whose path matched no single success is still a file that was not read: it stays in
  // the success count, so that count is a CEILING rather than a measurement, and says so.
  const ambiguous = [...new Set(failed)].filter((f) => !subtracted.has(f) && ![...subtracted].some((u) => sameFile(f, u))).sort();
  return { succeeded, expected, failed: [...new Set(failed)].sort(), ambiguous };
}

function matcher(exts) {
  const clean = (exts || []).filter((e) => typeof e === 'string' && e.startsWith('.'));
  if (!clean.length) return null;
  const alt = clean.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- alt joins file extensions that are regex-escaped on the line above
  return new RegExp('(' + alt + ')$', 'i');
}

/**
 * Coverage verdict for one CodeQL SARIF.
 *
 * @param {object} sarif        parsed SARIF document
 * @param {string[]} sourceExts the lane's `appliesIfSourceExt` from the manifest
 * @returns {{state:string, ratio:number|null, extracted:number, expected:number, reason:string}}
 *
 * fact: `covered` — the extractor read >= COVERAGE_FLOOR of this language's files, so a zero here is a REAL zero and may be published as such (expiry: never, prev: unknown)
 * fact: `partial` — it read less, so the findings are real but their ABSENCE is not / a zero or low count under this state is undetermined, never clean (expiry: never, prev: broken)
 * fact: `unmeasurable` — no expected-extracted-files baseline, or the lane declares no extensions / this is the GREY state and must be rendered as neither a pass nor a failure (expiry: never, prev: broken)
 * fact: `no-language` — the repo holds no files of this language, so the lane correctly found nothing / that is a legitimate empty, not a void (expiry: never, prev: unknown)
 */
export function codeqlCoverage(sarif, sourceExts) {
  const rx = matcher(sourceExts);
  if (!rx) return { state: 'unmeasurable', ratio: null, extracted: 0, expected: 0,
    reason: 'the lane declares no appliesIfSourceExt, so there is no language-scoped denominator to measure against' };

  const { succeeded, expected, failed, ambiguous } = extractionSets(sarif);
  if (!expected.size) return { state: 'unmeasurable', ratio: null, extracted: 0, expected: 0,
    reason: 'this SARIF carries no expected-extracted-files baseline — coverage cannot be computed, which is not the same as complete' };

  const ex = [...expected].filter((u) => rx.test(u)).length;
  const su = [...succeeded].filter((u) => rx.test(u)).length;

  // A lane may report SUCCESSES for this language while the archive baseline enumerates none of it
  // (the Rust extractor does, beside a polyglot archive's js/py/rb baselines). Read as
  // `no-language`, that would LICENSE a zero, so a degraded run would be publishable as clean.
  // Successes without a denominator are unmeasurable, which licenses nothing.
  if (ex === 0 && su > 0) return { state: 'unmeasurable', ratio: null, extracted: su, expected: 0,
    reason: `the extractor reports ${su} success(es) for this language but the archive baseline enumerates none of it — the denominator is absent, so coverage is unknowable, which is not the same as complete` };
  if (ex === 0) return { state: 'no-language', ratio: null, extracted: su, expected: 0,
    reason: 'the source archive contains no files with this lane\'s extensions, so an empty result is the correct answer rather than a void' };

  // The ratio can legitimately EXCEED 1: the success list includes files the archive baseline does
  // not enumerate. Only the low side is a coverage claim, so clamp for reporting and never treat
  // >1 as an anomaly to escalate.
  const ratio = su / ex;
  const failedHere = failed.filter((u) => rx.test(u));
  const named = failedHere.length
    ? `; failed to parse: ${failedHere.slice(0, 5).join(', ')}${failedHere.length > 5 ? `, +${failedHere.length - 5} more` : ''}` : '';
  const ambiguousHere = (ambiguous || []).filter((u) => rx.test(u));
  const withFailed = {
    ...(failedHere.length ? { failed: failedHere } : {}),
    ...(ambiguousHere.length ? { extractedIsCeiling: true, ambiguous: ambiguousHere } : {}),
  };
  const ceiling = ambiguousHere.length
    ? ` — at most, because ${ambiguousHere.length} failed path(s) could not be matched to one extracted file, so a file that was not read is still counted here`
    : '';
  if (ratio >= COVERAGE_FLOOR) return { state: 'covered', ratio, extracted: su, expected: ex, ...withFailed,
    reason: `extracted ${su} of ${ex} ${ratio >= 1 ? '' : 'expected '}files carrying this lane's extensions${named}${ceiling}` };

  return { state: 'partial', ratio, extracted: su, expected: ex, ...withFailed,
    reason: `extracted only ${su} of ${ex} files carrying this lane's extensions (${Math.round(ratio * 100)}%)${named}${ceiling}`
      + '. Findings reported are real; the ABSENCE of findings in the unread remainder is not evidence of absence, '
      + 'so a zero or a low count under this state is undetermined rather than clean.' };
}

/** True when a lane's own count may be published as a clean/complete result. `partial` and
 *  `unmeasurable` both fail this — over-reporting a void as a pass is the failure this file exists
 *  to prevent, and an unmeasurable lane has not earned a pass either. */
export const coverageLicensesAZero = (v) => !!v && (v.state === 'covered' || v.state === 'no-language')
  // A file that failed to parse was not read, whatever the ratio: the floor was measured for the
  // UNEXPLAINED gap, and a named failure is an additional reason not to license a zero.
  && !(Array.isArray(v.failed) && v.failed.length);

// ── The denominator's source ─────────────────────────────────────────────────────────────────────
// `appliesIfSourceExt` is already declared per lane in the baseline manifest and is already the
// gate deciding whether a lane runs on a repo at all. Reusing it means the guard's denominator and
// the lane's own applicability can never disagree — a second hand-maintained list here would drift
// silently, and the drift would look like a coverage change.

/** Read at CALL time, never at module load: a `const` here would defeat CW_BASELINE_MANIFEST for
 *  every test that sets it afterwards, so the test would pass while proving nothing. */
const manifestPath = () => process.env.CW_BASELINE_MANIFEST
  || fileURLToPath(new URL('../manifests/security-baseline.json', import.meta.url));

let extCache = null;
/**
 * The `appliesIfSourceExt` a lane declares, or null when the lane, the manifest or the field is
 * absent. Null is deliberately distinct from `[]`: "this lane declares no extensions" and "the
 * manifest could not be read" are different facts, and codeqlCoverage() renders both as
 * `unmeasurable` rather than letting either become a pass.
 *
 * Memoised on (path, mtime, size) exactly as scan-scope memoises the same file — a re-read per
 * finding across a fleet sweep is the kind of cost that turns into a sweep that never finishes.
 */
export function laneSourceExts(checkId, { path = manifestPath() } = {}) {
  let stamp;
  try {
    const st = statSync(path);
    stamp = `${path}:${st.mtimeMs}:${st.size}`;
  } catch { return null; }              // unreadable manifest ⇒ no denominator ⇒ unmeasurable
  if (!extCache || extCache.stamp !== stamp) {
    let checks = [];
    try { checks = JSON.parse(readFileSync(path, 'utf8')).checks || []; } catch { return null; }
    const byId = new Map();
    for (const c of checks) if (c && c.id) byId.set(c.id, Array.isArray(c.appliesIfSourceExt) ? c.appliesIfSourceExt : null);
    extCache = { stamp, byId };
  }
  return extCache.byId.has(checkId) ? extCache.byId.get(checkId) : null;
}

/**
 * Coverage for one lane, resolving the denominator from the manifest. This is the form the
 * extractor calls: it takes the check id rather than an extension list so no caller has to keep a
 * copy of the list.
 *
 * A lane that is not a CodeQL lane, or declares no extensions, returns `unmeasurable` — which
 * `coverageLicensesAZero` treats as NOT licensing a zero. That is the fail-closed direction: a new
 * lane wired in here without a declared extension list does not silently inherit a pass.
 */
export function coverageForLane(sarifRuns, checkId) {
  return codeqlCoverage({ runs: sarifRuns }, laneSourceExts(checkId));
}
