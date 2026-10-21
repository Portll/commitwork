// monitor/extractors/sarif.mjs — the one SARIF lane reader, shared by every scanner that emits SARIF.
//
// The most-shared extractor in the module: most SCANNER_SPECS lanes that emit SARIF read through
// _sarifDetail (Semgrep and its --auto arm, the CodeQL lanes, cppcheck, flawfinder, gosec,
// golangci-lint, ruff, Psalm, trivy-config, zizmor, the mobile-manifest and node-hazards rule packs,
// and the Gradle declared-deps floor), and GuardDog calls _sarifCounts directly, so it is a part
// module of its own rather than something GuardDog would import back through the barrel.
//
// The vocabulary it returns (nosrc / emptyArtifact / unparseable / neverran / toolfailed / norules)
// is documented once, at the head of monitor/extractors.mjs, because every extractor shares it.
// Why message text is capped, and why rows are rebuilt field by field rather than copied, is at
// MESSAGE_CAP in ./core.mjs.
//
// monitor/extractors.mjs re-exports both functions.

import { join } from 'node:path';
import { readSarif, ruleIndex, cweOf, isSuppressed, sarifBand, ruleTitle } from '../sarif-read.mjs';
import { classifyPath } from '../fixture-paths.mjs'; // a test corpus is a different population, not a cleaner one
import { classifyWorktreePath } from '../worktree-paths.mjs'; // a second checkout is the same population counted twice
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
  // pattern. A repository's test corpus can hold most of its criticals, and those describe the
  // fixtures rather than the software.
  const fx = { crit: 0, high: 0, med: 0, low: 0, total: 0, byPattern: {}, rows: [] };
  const sup = { crit: 0, high: 0, med: 0, low: 0, total: 0, rows: [] };
  const wt = { crit: 0, high: 0, med: 0, low: 0, total: 0, byName: {}, rows: [] };
  for (const run of r.runs) {
    const rules = ruleIndex(run);
    for (const res of run.results) {
      const rule = rules[res.ruleId] || {};
      let b = sarifBand(res, rule);
      if (sevOf) b = sevOf(String(res.ruleId || rule.id || ''), b) || b;
      const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
      const uri = (loc && loc.artifactLocation && loc.artifactLocation.uri) || '';
      // Suppressed in source: out of the counts like a fixture, and enumerable rather than dropped.
      if (isSuppressed(res)) {
        sup[b]++; sup.total++;
        sup.rows.push({ rule: res.ruleId || rule.id || '', file: uri, line: Number(loc && loc.region && loc.region.startLine) || 0, sev: b });
        continue;
      }
      // Before the fixture test: a worktree copy of a fixture is still a copy. Measured 2026-10-08:
      // one Dockerfile published as three iac rows, two of them agent-worktree copies, and 42 issues
      // keyed on such copies closed as FIXED when the worktree was deleted.
      const copy = classifyWorktreePath(uri);
      if (copy.worktree) {
        wt[b]++; wt.total++;
        wt.byName[copy.name] = (wt.byName[copy.name] || 0) + 1;
        wt.rows.push({ rule: res.ruleId || rule.id || '', file: uri, line: Number(loc && loc.region && loc.region.startLine) || 0, sev: b, pattern: copy.pattern, canonical: copy.canonical });
        continue;
      }
      const cls = classifyPath(uri);
      if (cls.fixture) {
        fx[b]++; fx.total++;
        fx.byPattern[cls.pattern] = (fx.byPattern[cls.pattern] || 0) + 1;
        // ENUMERABLE, not merely counted, so a fixture-path finding can be reached from the
        // published side as well as in the raw SARIF. These rows stay out of c[b] and out of
        // `collect`, so no headline number moves.
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
  if (wt.total) {
    c.worktrees = { ...wt, of: wt.total + c.total, note: `${wt.total} of ${wt.total + c.total} findings describe a copy of this repository under a worktree path and are excluded from these counts. Each row names the path it stands for. Set CW_WORKTREE_PATHS=off to count them.` };
  }
  // norules (zero rules loaded, zero results, runs present) is a void for the rule-driven engines
  // this function reads — the semgrep-empty-ruleset class; the fact comes from sarif-read.mjs
  if (r.norules) return { ...c, norules: true };
  // A CodeQL lane whose extractor read only part of its language produces well-formed SARIF, an
  // empty results[] and a zero exit — byte-indistinguishable from a clean repository. `coverageOf`
  // names the check id whose appliesIfSourceExt is the denominator. Attached for EVERY state, not
  // only the bad one, so a missing field never has to be read as "covered".
  if (coverageOf) {
    const cov = coverageForLane(r.runs, coverageOf);
    c.coverage = cov;
    // The count stays exactly as measured — findings that WERE found are real. What changes is the
    // licence to read the remainder as clean: an unread file cannot testify that it is empty.
    if (!coverageLicensesAZero(cov)) c.coverageIncomplete = true;
  }
  // Files the tool abandoned or read only in part. The findings it did produce stand; its silence
  // about these files is not evidence, so coverage reads reduced and names them.
  const partial = (r.partialAnalysis || []).filter((p) => !classifyWorktreePath(p.uri).worktree);
  if (partial.length) {
    const byReason = {};
    for (const p of partial) for (const why of p.reasons) byReason[why] = (byReason[why] || 0) + 1;
    const PARTIAL_ROWS_MAX = 200;
    c.partialAnalysis = {
      files: partial.length, byReason, rows: partial.slice(0, PARTIAL_ROWS_MAX),
      truncated: Math.max(0, partial.length - PARTIAL_ROWS_MAX),
    };
    c.coverageIncomplete = true;
    const reasons = Object.entries(byReason).map(([k, n]) => `${n} ${k}`).join(', ');
    const said = `${partial.length} file(s) were read only in part (${reasons}), so this count is silent about them rather than clean`;
    if (!c.coverage || c.coverage.state === 'covered' || c.coverage.state === 'no-language') {
      c.coverage = { state: 'partial', partialFiles: partial.length, reason: said };
    } else {
      c.coverage = { ...c.coverage, partialFiles: partial.length, reason: `${c.coverage.reason || ''}${c.coverage.reason ? '; ' : ''}${said}` };
    }
  }
  // Rules the engine could not evaluate are a property of the ruleset, not of these files: stated,
  // so their silence is not read as clean, and kept out of coverage (sarif-read.mjs ruleFailures).
  const failedRules = r.ruleFailures || [];
  if (failedRules.length) {
    c.rulesNotEvaluated = {
      rules: failedRules.length,
      notices: failedRules.reduce((n, x) => n + x.notices, 0),
      rows: failedRules,
      note: `${failedRules.length} rule(s) could not be evaluated by this engine; they contribute nothing to these counts, which are silent about what those rules look for.`,
    };
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

// Rule titles ride beside the rows as one {rule: title} map rather than as a row field: a title is
// the same for every hit of a rule, and a row field would add a column to every SARIF table.
export function _sarifDetail(dir, file, key, coverageOf = null, sevOf = null) {
  const rows = [];
  const titles = new Map();
  const wantsCwe = CWE_ROW_KEYS.has(key);
  const c = _sarifCounts(dir, file, (res, rule, b) => {
    const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
    const id = String(res.ruleId || (rule && rule.id) || '');
    const title = ruleTitle(rule);
    if (id && title) titles.set(id, title);
    rows.push({
      rule: id,
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
  const ruleTitles = titles.size ? Object.fromEntries([...titles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : null;
  return { ...c, ..._detailFor(key, rows), ...(ruleTitles ? { ruleTitles } : {}) };
}
