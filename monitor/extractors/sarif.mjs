// monitor/extractors/sarif.mjs — the one SARIF lane reader, shared by every scanner that emits SARIF.
//
// Lifted unchanged from monitor/extractors.mjs on 2026-09-22. It is the most-shared extractor in the
// module: 21 SCANNER_SPECS lanes read through _sarifDetail (Semgrep and its --auto arm, the eight
// CodeQL lanes, cppcheck, flawfinder, gosec, golangci-lint, ruff, Psalm, trivy-config, zizmor, the
// mobile-manifest and node-hazards rule packs, and the Gradle declared-deps floor), and GuardDog
// calls _sarifCounts directly. That last edge is why it moved before GuardDog can: a GuardDog part
// module would otherwise have to import it back through the barrel.
//
// The vocabulary it returns (nosrc / emptyArtifact / unparseable / neverran / toolfailed / norules)
// is documented once, at the head of monitor/extractors.mjs, because every extractor shares it.
// Why message text is capped, and why rows are rebuilt field by field rather than copied, is at
// MESSAGE_CAP in ./core.mjs.
//
// monitor/extractors.mjs re-exports both functions, so its importers see no change.

import { join } from 'node:path';
import { readSarif, ruleIndex, cweOf, isSuppressed, sarifBand } from '../sarif-read.mjs';
import { classifyPath } from '../fixture-paths.mjs'; // a test corpus is a different population, not a cleaner one
import { coverageForLane, coverageLicensesAZero } from '../codeql-coverage.mjs'; // an unread file cannot testify that it is empty
import { _zero, _detailFor, capMessage } from './core.mjs';

export function _sarifCounts(dir, file, collect, coverageOf = null, sevOf = null) {
  // Maps sarif-read states onto this file's vocabulary; 'unreadable' joins 'absent' as null
  // (a non-affirmed completion reads through checks-status provenance, never as counts)
  const r = readSarif(join(dir, file));
  if (r.state === 'absent' || r.state === 'unreadable') return null;
  // `empty` has TWO live meanings and this is the one place that must not merge them: a self-gated
  // check with genuinely no source, and a tool killed before it wrote a byte. Both keep `nosrc` so
  // existing consumers still render grey; `emptyArtifact` is the discriminator a void-carry needs.
  if (r.state === 'empty') return { ..._zero(), ran: true, nosrc: true, emptyArtifact: true };
  if (r.state === 'unparseable') return { ..._zero(), ran: true, unparseable: true };
  if (r.state === 'never-ran') return { ..._zero(), ran: true, neverran: true };
  if (r.state === 'tool-failed') return { ..._zero(), ran: true, toolfailed: true };
  const c = { ..._zero(), ran: true };
  // Findings under a test-fixture path are counted SEPARATELY, never silently dropped: the raw
  // SARIF on disk is untouched and `fixtures` states how many were set aside and under which
  // pattern. Measured 2026-08-24: dependabot-core contributed 730 of the fleet's 800 criticals and
  // 723 were spec/fixtures — real numbers describing a test corpus rather than the software (C3).
  const fx = { crit: 0, high: 0, med: 0, low: 0, total: 0, byPattern: {}, rows: [] };
  const sup = { crit: 0, high: 0, med: 0, low: 0, total: 0, rows: [] };
  for (const run of r.runs) {
    const rules = ruleIndex(run);
    for (const res of run.results) {
      const rule = rules[res.ruleId] || {};
      let b = sarifBand(res, rule);
      if (sevOf) b = sevOf(String(res.ruleId || rule.id || ''), b) || b;
      const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
      const uri = (loc && loc.artifactLocation && loc.artifactLocation.uri) || '';
      // Suppressed in source: out of the counts like a fixture, and enumerable rather than dropped.
      // Measured 2026-10-07: 19 of opengrep's 156 results on this repository carried a nosemgrep.
      if (isSuppressed(res)) {
        sup[b]++; sup.total++;
        sup.rows.push({ rule: res.ruleId || rule.id || '', file: uri, line: Number(loc && loc.region && loc.region.startLine) || 0, sev: b });
        continue;
      }
      const cls = classifyPath(uri);
      if (cls.fixture) {
        fx[b]++; fx.total++;
        fx.byPattern[cls.pattern] = (fx.byPattern[cls.pattern] || 0) + 1;
        // ENUMERABLE, not merely counted. _malCounts already kept `rows` here and this call site did
        // not, in the same commit — so a malicious package under a fixture path could be looked at
        // and a hardcoded key under one could not, across every SARIF lane (semgrep, codeql, gosec,
        // iac, dockerfile, shellcheck). The header's promise that a finding "keeps its place in the
        // artifact" was true for one branch and false for the bulk. The raw SARIF always held these
        // rows; nothing could reach them from the published side, which is a weaker failure than
        // dropping them and still weaker than the promise. Counts are untouched: these rows stay
        // out of c[b] and out of `collect`, so no headline number moves.
        fx.rows.push({
          rule: res.ruleId || rule.id || '',
          file: uri,
          line: Number(loc && loc.region && loc.region.startLine) || 0,
          sev: b,
          pattern: cls.pattern,
          ...(cls.intent ? { intent: cls.intent, intentBasis: cls.intentBasis } : {}),
        });
        continue;   // out of the published counts, enumerable in `fixtures.rows`, untouched on disk
      }
      c[b]++; c.total++;
      if (collect) collect(res, rule, b);
    }
  }
  // Stated as a fraction, so a shrinking published count is visible rather than merely true.
  if (fx.total) {
    c.fixtures = { ...fx, of: fx.total + c.total, note: `${fx.total} of ${fx.total + c.total} findings are under a test-fixture path and are excluded from these counts. They remain in the SARIF artifact on disk. Set CW_FIXTURE_PATHS=off to count them.` };
  }
  if (sup.total) {
    c.suppressed = { ...sup, note: `${sup.total} finding(s) carry an in-source suppression and are excluded from these counts. They remain in the SARIF artifact on disk.` };
  }
  // norules (zero rules loaded, zero results, runs present) is a void for the rule-driven engines
  // this function reads — the semgrep-empty-ruleset class; the fact comes from sarif-read.mjs
  if (r.norules) return { ...c, norules: true };
  // A CodeQL lane whose extractor read only part of its language produces well-formed SARIF, an
  // empty results[] and a zero exit — byte-indistinguishable from a clean repository. `coverageOf`
  // names the check id whose appliesIfSourceExt is the denominator. Attached for EVERY state, not
  // only the bad one: a consumer that sees the field on partial runs and nothing on covered ones
  // cannot tell "covered" from "this lane predates the guard".
  if (coverageOf) {
    const cov = coverageForLane(r.runs, coverageOf);
    c.coverage = cov;
    // The count stays exactly as measured — findings that WERE found are real. What changes is the
    // licence to read the remainder as clean: an unread file cannot testify that it is empty.
    if (!coverageLicensesAZero(cov)) c.coverageIncomplete = true;
  }
  return c;
}
// Categories whose rows carry a `cwe` field — true source-weakness SAST, where the join in
// corroborate.mjs's markSastPlaceCorroboration() (repo|file|CWE, tighter than the file-only
// fallback) is meaningful. Deliberately excludes lintGo (a linter, never a SAST-shaped verdict —
// see its own note), iac/actionsPosture/depsGradleDeclared (different finding shapes, out of
// scope for this join) and any lane not yet wired here.
const CWE_ROW_KEYS = new Set([
  'sastSemgrep', 'sastAuto', 'sastGo',
  'sastCodeql', 'sastCodeqlJava', 'sastCodeqlPython', 'sastCodeqlRuby',
  'sastCodeqlCpp', 'sastCodeqlSwift', 'sastCodeqlCsharp', 'sastCodeqlRust', 'sastCodeqlGo',
  'sastCCppcheck', 'sastCFlawfinder',
]);
// sastBrakeman is NOT in this set: it is a _brakemanCounts row (cwe already comes from Brakeman's
// own cwe_id field, not from _sarifDetail's SARIF-tag extraction), and CWE_ROW_KEYS only governs
// what _sarifDetail attaches. Its own row schema still declares a cwe field, populated directly.

export function _sarifDetail(dir, file, key, coverageOf = null, sevOf = null) {
  const rows = [];
  const wantsCwe = CWE_ROW_KEYS.has(key);
  const c = _sarifCounts(dir, file, (res, rule, b) => {
    const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
    rows.push({
      rule: String(res.ruleId || (rule && rule.id) || ''),
      file: String((loc && loc.artifactLocation && loc.artifactLocation.uri) || '').replace(/^file:\/\/\/?/, ''),
      line: Number(loc && loc.region && loc.region.startLine) || 0,
      sev: b,
      message: capMessage(String((res.message && res.message.text) || '')),
      // The rule asserts what it asserts; an empty join means "no CWE tag on this rule", never a
      // guess. See sarif-read.mjs's cweOf() header for why nothing here infers one.
      ...(wantsCwe ? { cwe: cweOf(rule).join(', ') } : {}),
    });
  }, coverageOf, sevOf);
  if (!c || c.nosrc || c.unparseable || c.norules || c.neverran || c.toolfailed) return c; // absent, or a husk with nothing to detail
  return { ...c, ..._detailFor(key, rows) };
}
