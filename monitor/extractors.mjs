// monitor/extractors.mjs — the category table, and the one module every consumer of a lane imports.
//
// Split out of rollup.mjs because that is a DRIVER: importing it performs a rollup, so nothing could
// import these. Eleven test files read rollup.mjs as TEXT and regexed a function body out with
// `new Function`, hand-injecting join/existsSync/_zero to make it run — asserting the behaviour of a
// function the test itself re-wired. Everything here is `(dir, filename) -> counts`: no driver
// state, no writes, no clock. That is where the split lands; below it is the rollup proper.
//
// THAT SPLIT HAPPENED AGAIN, 2026-09-05 to 09-23: this file was 2,504 lines and every reader in it
// now lives in a part module, grouped by what the lane reads. This module keeps SCANNER_SPECS, the
// WCAG lane and tool provenance, and re-exports every public name, so its importers never changed.
// Where each reader lives:
//   ./extractors/core.mjs           _zero, _emptyArtifact, the detail cap and row builders, the
//                                   agent-worktree set-aside, capMessage, stampUnknown
//   ./extractors/sarif.mjs          the SARIF reader: 21 lanes read through it, GuardDog calls it
//   ./extractors/sast-lint.mjs      per-language SAST and lint with formats of their own
//   ./extractors/supply-chain.mjs   advisories, second opinions, the Gradle wrapper, GuardDog, dep-scan,
//                                   dependency content
//   ./extractors/socket.mjs         Socket, which needs a vocabulary of its own to read
//   ./extractors/secrets.mjs        gitleaks (with its lane-local path helpers), TruffleHog, weakRandom
//   ./extractors/posture.mjs        hadolint, TLS/headers, CSPM, Scorecard, CI gaps, zizmor severity,
//                                   the jackson case-insensitive guard
//   ./extractors/dast.mjs           nuclei, Schemathesis, BOLA
//   ./extractors/tree-contents.mjs  vendored copies, stubs, minified code, model artefacts
//   ./extractors/agent-surface.mjs  agent instruction files and agent configuration
//   ./extractors/history.mjs        commit provenance and commit velocity: the history, not the tree
//   ./lane-kinds.mjs                what each lane is called and what it claims — not an extractor
// Each part's header says what it holds and why. A part never imports this module (that is the cycle
// bin/module-seams.mjs screens for), and every part must appear in the map above; both are asserted
// in monitor/test/extractors-source.test.mjs. A test that needs the readers' source as TEXT reads it
// through monitor/test/lib/extractors-source.mjs, never this file alone.
//
// THE SHAPE EVERY EXTRACTOR RETURNS — consumers depend on these distinctions:
//   null                       ABSENT. The category reports the void from checks-status provenance.
//                              Also how a tool's own refusal reads (Socket's {ok:false} husk, a
//                              quota refusal, any shape that is not an affirmed completion).
//   {ran:true}                 a real scan, counts are real
//   {ran:true, nosrc:true}     artifact empty, or a self-gated check (cspm) says it did not run
//   {ran:true, unparseable}    artifact corrupt
//   {ran:true, norules}        valid SARIF, a run executed, ZERO rules loaded — a configuration
//                              void, not a clean result (the semgrep empty-ruleset class)
//   {ran:true, neverran}       valid JSON, NO runs[] — a tool's error object or stub
//   {ran:true, toolfailed}     the tool's own output says it failed and produced nothing: SARIF whose
//                              invocation channel reports failure with zero results, or a nuclei
//                              artifact carrying lines but no record (see extractors/dast.mjs), or an
//                              empty artifact whose exit sidecar is above 1 (_emptyArtifact)
//
// Not cosmetic: cra/controls.mjs refuses to evidence a control from nosrc or unparseable — a control
// cannot be proven by a file nobody could read. neverran/toolfailed are wired the same way.
// `norules` joins the vocabulary here; wiring it downstream is tracked separately.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// safe-parse: a scanned repo can SHAPE the JSON its scanner emits. safeParseFile bounds size and
// nesting and refuses prototype-pollution keys; a hostile shape THROWS rather than parsing into a
// polluted object. Every adoption, here and in the part modules, keeps its site's existing catch
// semantics — the guard hardens the parse, it does not re-litigate what an unreadable artifact means.
import { safeParseFile } from './safe-parse.mjs';

// ── THE PART MODULES ─────────────────────────────────────────────────────────────────────────────
// Imported for SCANNER_SPECS, the WCAG lane and the export block below.
import { _zero, _emptyArtifact, _detailFor } from './extractors/core.mjs';
import { _sarifCounts, _sarifDetail } from './extractors/sarif.mjs';
import { _clippyCounts, _hlintCounts, _joernScanCounts, _bearerCounts, _sobelowCounts, _banditCounts, _brakemanCounts, _phpcsCounts, _pmdCounts, _shellcheckCounts, _actionlintCounts, _denoLintCounts, _denoCheckCounts, _cobolworkCounts, _rustfmtCounts, _cobolInventoryCounts } from './extractors/sast-lint.mjs';
import { _cargoAuditCounts, _bundlerAuditCounts, _trivyCounts, _malCounts, _govulnCounts, _gradleWrapperCounts, _depscanCounts, _guarddogCounts, _retireDetail, _depsContentCounts } from './extractors/supply-chain.mjs';
import { _socketCounts, _socketAlertCount, _socketAlertRows } from './extractors/socket.mjs';
import { _trufflehogCounts, _gitleaksCounts, _weakRandomCounts } from './extractors/secrets.mjs';
import { _hadolintCounts, _tlsHeaderCounts, _cspmCounts, _scorecardCounts, _actionsGapsCounts, _actionsHealthCounts, _testHermeticCounts, _jacksonGuardCounts, zizmorSev } from './extractors/posture.mjs';
import { _nucleiCounts, _schemathesisCounts, _bolaCounts } from './extractors/dast.mjs';
import { _vendorCounts, _stubCounts, _minifyCounts, _modelArtefactsCounts } from './extractors/tree-contents.mjs';
import { _agentInstructionsCounts, _agentConfigCounts } from './extractors/agent-surface.mjs';
import { _commitProvenanceCounts, _commitVelocityCounts } from './extractors/history.mjs';

// Re-exported unchanged, for the consumers that name this module.
export {
  _zero, _cmpStr, _detail, _detailFor, _ecosystemOf, DETAIL_CAP, MESSAGE_CAP, capMessage, stampUnknown,
} from './extractors/core.mjs';
export { regradeSocket, socketRefusal, _socketTypes } from './extractors/socket.mjs';
export { isTestPath, classifyContext, PUBLIC_BY_DESIGN } from './extractors/secrets.mjs';
export { SCANNER_LABELS, LANE_KINDS, LANE_KIND_NAMES, kindOf, TOTALS_EXCLUDE, METRIC_CATEGORIES, sumTotals, partitionByKind } from './lane-kinds.mjs';

// ── THE BUILD THAT PRODUCED THE FINDINGS ───────────────────────────────────────────────────────
// bin/commitwork.mjs writes tool-version-<checkId>.json beside each check's report, at the moment
// the check runs. This reads it back so a category can say WHICH BINARY produced its rows.
//
// ABSENT IS `not-recorded`, NEVER "current". The temptation is to fall back to whatever is
// installed now — that would attribute rows produced days ago to a binary that never touched them.
// Every rollup written before this shipped legitimately has no stamp, and saying so is the correct
// answer for them; guessing would silently convert an unknown into a confident falsehood.
//
// This is the half that was missing when trufflehog 3.96.0's Lob detector produced 1,311 false
// CRITICALs: the box's version was knowable, but not one of those findings carried it.
function _toolProvenance(dir, checkId) {
  if (!checkId) return { provenance: 'not-recorded' };
  const safe = String(checkId).replace(/[^A-Za-z0-9._-]/g, '_');
  const p = join(dir, `tool-version-${safe}.json`);
  if (!existsSync(p)) return { provenance: 'not-recorded' };
  let j; try { j = safeParseFile(p); } catch {
    return { provenance: 'unreadable' };   // a torn stamp is not an absent one
  }
  const tools = (j && j.tools) || {};
  const names = Object.keys(tools).sort();
  if (!names.length) return { provenance: 'not-recorded' };
  const out = {};
  for (const n of names) {
    const t = tools[n] || {};
    out[n] = t.state === 'present'
      ? (t.versionState === 'stated' ? t.version : null)
      : null;
  }
  // `unstated` travels as its own list rather than as a null nobody reads: a tool that cannot name
  // its build is a different problem from a tool that was not probed, and only one of them is
  // fixable by upgrading.
  const unstated = names.filter((n) => (tools[n] || {}).state === 'present' && (tools[n] || {}).versionState !== 'stated');
  const absent = names.filter((n) => (tools[n] || {}).state && (tools[n] || {}).state !== 'present');
  return {
    provenance: 'recorded',
    toolVersions: out,
    probedAt: j.probedAt || null,
    ...(unstated.length ? { toolsWithoutVersion: unstated } : {}),
    ...(absent.length ? { toolsAbsentAtRun: absent } : {}),
  };
}

// ── the seven categories that used to have no category at all ──────────────────────────────────
// Each of these checks WROTE an artifact on every sweep and had a remediationPrompt written for it,
// but no SCANNER_SPECS row — so the rollup never spoke for them, `scanners` had no key, and the
// panel's triage card rendered `no live counts`. That pill means "the rollup never spoke for this
// check", which an operator reads as "nothing to see"; in fact hadolint had been reporting
// Dockerfile errors and trufflehog had been scanning git history into a number nobody aggregated.
// A category here is NOT new evidence — it is evidence that was already on disk reaching a total.
// Every one returns null when the artifact is ABSENT, so the ran/skipped/noscan join below reports
// the void; a written-but-empty artifact is `ran:true` with zeroes, which is a real clean result.
// (Those readers now live in ./extractors/secrets.mjs, supply-chain.mjs and posture.mjs. The note is
// kept here, beside the table it is the history of.)
const SCANNER_SPECS = [
  ['depsJvm', 'deps-jvm', (d) => _trivyCounts(d, 'trivy-jvm.json')],
  ['sastSemgrep', 'sast', (d) => _sarifDetail(d, 'semgrep.sarif', 'sastSemgrep')],
  ['sastCodeql', 'sast-codeql', (d) => _sarifDetail(d, 'codeql.sarif', 'sastCodeql', 'sast-codeql')],
  ['sastCodeqlJava', 'sast-codeql-java', (d) => _sarifDetail(d, 'codeql-java.sarif', 'sastCodeqlJava', 'sast-codeql-java')],
  // Python and Ruby run under build-mode NONE — CodeQL extracts them without building the source
  // root, so these two lanes execute nothing from the scanned repository and need no container.
  // That is what separates them from CodeQL C/C++, which has no build-mode none and must autobuild.
  // Kept as their own categories for the reason sastCodeqlJava is: a lane must never be able to
  // stand in for one that did not run. 48 of the 100randomrepos corpus carry .py sources.
  ['sastCodeqlPython', 'sast-codeql-python', (d) => _sarifDetail(d, 'codeql-python.sarif', 'sastCodeqlPython', 'sast-codeql-python')],
  ['sastCodeqlRuby', 'sast-codeql-ruby', (d) => _sarifDetail(d, 'codeql-ruby.sarif', 'sastCodeqlRuby', 'sast-codeql-ruby')],
  // Added 2026-08-24; until 2026-08-27 neither joern nor bearer was installed on any machine in
  // this fleet, and both lanes correctly resolved to tool-unavailable — noscan, never a clean
  // zero. They are separate categories rather than folded into sastSemgrep for the reason
  // sastCodeqlJava is: a lane must never be able to stand in for one that did not run.
  ['sastCodeqlCpp', 'sast-codeql-cpp', (d) => _sarifDetail(d, 'codeql-cpp.sarif', 'sastCodeqlCpp', 'sast-codeql-cpp')],
  ['sastCCppcheck', 'sast-c-cppcheck', (d) => _sarifDetail(d, 'cppcheck.sarif', 'sastCCppcheck', 'sast-c-cppcheck')],
  ['sastCFlawfinder', 'sast-c-flawfinder', (d) => _sarifDetail(d, 'flawfinder.sarif', 'sastCFlawfinder', 'sast-c-flawfinder')],
  ['sastCodeqlSwift', 'sast-codeql-swift', (d) => _sarifDetail(d, 'codeql-swift.sarif', 'sastCodeqlSwift', 'sast-codeql-swift')],
  // Added 2026-08-24. Its own category, not folded into sastCodeql: before it, C# reached the
  // rollup only through maliciousPackages (osv reading packages.lock.json), which never reads C#.
  ['sastCodeqlCsharp', 'sast-codeql-csharp', (d) => _sarifDetail(d, 'codeql-csharp.sarif', 'sastCodeqlCsharp', 'sast-codeql-csharp')],
  // Rust's FIRST security reading of source (2026-08-26). Coverage is structurally unmeasurable —
  // the rust extractor emits successes but no expected-extracted-files baseline — so every run
  // carries coverageIncomplete; that is fail-closed, not a defect (see codeql-coverage.mjs).
  ['sastCodeqlRust', 'sast-codeql-rust', (d) => _sarifDetail(d, 'codeql-rust.sarif', 'sastCodeqlRust', 'sast-codeql-rust')],
  ['sastCodeqlGo', 'sast-codeql-go', (d) => _sarifDetail(d, 'codeql-go.sarif', 'sastCodeqlGo', 'sast-codeql-go')],
  ['sastAuto', 'sast-auto', (d) => _sarifDetail(d, 'semgrep-auto.sarif', 'sastAuto')],
  // All three graduated 2026-08-27 against real runs (see each parser's comment for what the
  // probe overturned — joern's artifact even changed name, because the JSON its check promised
  // does not exist in the installed tool).
  ['sastJoern', 'sast-joern', (d) => _joernScanCounts(d, 'joern.txt')],
  ['sastBearer', 'sast-bearer', (d) => _bearerCounts(d, 'bearer.json')],
  ['sastElixir', 'sast-elixir-sobelow', (d) => _sobelowCounts(d, 'sobelow.json')],
  // The two lint lanes below carry lint- names and lint- categories deliberately. Clippy ships no
  // security rule pack and no taint analysis, and hlint is a style tool; a sast- name on either
  // would let a lint-clean repository earn a green SAST row. Both join TOTALS_EXCLUDE and
  // METRIC_CATEGORIES below for the same reason denoLint does — a Haskell project with 400 style
  // suggestions must not publish 400 findings.
  ['lintRust', 'lint-rust-clippy', (d) => _clippyCounts(d, 'clippy.json')],
  ['formatRust', 'format-rust-rustfmt', (d) => _rustfmtCounts(d, 'rustfmt.json')],
  ['sastPython', 'sast-python-bandit', (d) => _banditCounts(d, 'bandit.json')],
  ['lintPython', 'lint-python-ruff', (d) => _sarifDetail(d, 'ruff.sarif', 'lintPython')],
  ['sastBrakeman', 'sast-ruby-brakeman', (d) => _brakemanCounts(d, 'brakeman.json')],
  ['depsBundlerAudit', 'deps-ruby-bundler-audit', (d) => _bundlerAuditCounts(d, 'bundler-audit.json')],
  ['sastPhp', 'sast-php-phpcs', (d) => _phpcsCounts(d, 'phpcs.json')],
  ['sastPhpPsalm', 'sast-php-psalm', (d) => _sarifDetail(d, 'psalm.sarif', 'sastPhpPsalm', 'sast-php-psalm')],
  ['lintJava', 'lint-java-pmd', (d) => _pmdCounts(d, 'pmd.json')],
  ['mobileManifest', 'mobile-manifest', (d) => _sarifDetail(d, 'mobile-manifest.sarif', 'mobileManifest')],
  ['nodeHazards', 'node-hazards', (d) => _sarifDetail(d, 'node-hazards.sarif', 'nodeHazards')],
  ['sastCobol', 'sast-cobol-cobolwork', (d) => _cobolworkCounts(d, 'cobolwork.json')],
  ['depsRustAudit', 'deps-rust-audit', (d) => _cargoAuditCounts(d, 'cargo-audit.json')],
  ['lintHaskell', 'lint-haskell-hlint', (d) => _hlintCounts(d, 'hlint.json')],
  ['iac', 'iac-config', (d) => _sarifDetail(d, 'trivy-config.sarif', 'iac')],
  ['supplyChain', 'supply-chain-socket', (d) => _socketCounts(d, 'socket.json')],
  // Deliberately NOT merged into supplyChain. Socket alerts and OSV MAL- records are different
  // evidence from different feeds with different run provenance, and supply-chain-socket has never
  // completed a scan in this fleet (0 pass / 40 token-skip / 25 noscan, 2026-07-31). Folding a live
  // lane into a dead one's key would launder the dead one's reputation — the category stays separate
  // so each reports its OWN ran/skipped/noscan.
  ['maliciousPackages', 'deps-osv', (d) => _malCounts(d, 'osv.sarif')],
  // GuardDog is the HEURISTIC half and is kept apart from maliciousPackages for the same reason:
  // MAL- is a curated verdict ("this package is malware"), GuardDog is a registry-metadata signal
  // ("this package is worth a look"). Summing them would let a typosquat suspicion inflate the
  // confirmed-malware number, which is the one number that must never need a caveat.
  ['supplyChainHeuristic', 'supply-chain-guarddog', (d) => _guarddogCounts(d, 'guarddog.sarif')],
  ['secrets', 'secrets-gitleaks', (d) => _gitleaksCounts(d, 'gitleaks.json')],
  // Same row shape as gitleaks; the verdict is inline (betterleaks --validation), so no sidecar file.
  ['secretsBetterleaks', 'secrets-betterleaks', (d) => _gitleaksCounts(d, 'betterleaks.json', null, 'secretsBetterleaks')],
  ['dast', 'dast-nuclei', (d) => _nucleiCounts(d, 'nuclei.jsonl')],
  ['bola', 'dast-authz-bola', (d) => _bolaCounts(d, 'authz-bola.json')],
  ['stubs', 'stub-detect', (d) => _stubCounts(d, 'stub.json')],
  ['weakRandom', 'weak-random', (d) => _weakRandomCounts(d, 'weak-random.json')],
  ['minifiedCode', 'minify-detect', (d) => _minifyCounts(d, 'minify.json')],
  // No general-purpose lane here reads COBOL — not CodeQL, not semgrep, not PMD. Three lanes do,
  // each asking something else: sastCobol above (cobolwork's findings), `cobolCoverage` (what the
  // tree holds and what could not be read, so `sastCobol: 0` over missing copybooks is not read as
  // clean), and `mainframeSecrets` (gitleaks with cobolwork's credential pack). The last overlaps
  // sastCobol on one shape only — see LANE_KINDS in lane-kinds.mjs.
  ['cobolCoverage', 'cobol-inventory', (d) => _cobolInventoryCounts(d, 'cobol-inventory.json')],
  ['mainframeSecrets', 'secrets-cobol-jcl', (d) => _gitleaksCounts(d, 'gitleaks-mainframe.json', 'gitleaks-mainframe-verify.json', 'mainframeSecrets')],
  ['vendorAssets', 'vendor-scan', (d) => _vendorCounts(d, 'vendor-scan.json')],
  // ── the seven that had a scanner, an artifact and a remediation prompt but no category ────────
  // Each of these ran on every sweep and wrote a report nothing aggregated, so `scanners` had no
  // key for them and the panel's triage card said `no live counts` — which reads as "nothing to
  // see" for checks that were, in hadolint's case, reporting Dockerfile errors the whole time.
  // `secretsHistory` is kept separate from `secrets` for the reason the header above gives: they
  // are different tools with different run provenance over different corpora (git history vs the
  // working tree), and one number would credit whichever ran to whichever did not.
  ['secretsHistory', 'secrets', (d) => _trufflehogCounts(d, 'trufflehog.json')],
  ['sastGo', 'sast-go-gosec', (d) => _sarifDetail(d, 'gosec.sarif', 'sastGo')],
  ['lintGo', 'lint-go-golangci', (d) => _sarifDetail(d, 'golangci.sarif', 'lintGo')],
  // Gradle projects that commit no lockfile: coordinates read from version catalogs and build
  // files, transitive closure from deps.dev, matched against OSV. ITS OWN CATEGORY rather than an
  // alias onto depsJvm, deliberately — its resolution is DECLARED, so its counts carry a caveat
  // (constraints, resolutionStrategy, BOMs and plugins can each override a declared version) that
  // merging into Trivy's would silently drop. Same count, different epistemic status; a shared
  // bucket cannot hold both.
  ['depsGradleDeclared', 'deps-gradle-declared', (d) => _sarifDetail(d, 'gradle-deps.sarif', 'depsGradleDeclared')],
  ['depsGo', 'deps-go-govulncheck', (d) => _govulnCounts(d, 'govulncheck.json')],
  ['depsRetire', 'deps-retire', (d) => _retireDetail(d, 'retire.json')],
  ['dockerfile', 'dockerfile-lint', (d) => _hadolintCounts(d, 'hadolint.json')],
  ['tlsHeaders', 'tls-headers', (d) => _tlsHeaderCounts(d, 'tls-headers.json')],
  ['apiFuzz', 'api-fuzz', (d) => _schemathesisCounts(d, 'schemathesis.ndjson')],
  ['cspm', 'cspm-github', (d) => _cspmCounts(d, 'cspm-github.json')],
  // Kept apart from cspm for the reason secretsHistory is kept apart from secrets: different tools,
  // different corpora, different run provenance. They also DISAGREE by design — Prowler reports a
  // control it cannot read as failing, Scorecard reports it as undetermined — and one merged number
  // would resolve that disagreement silently in favour of whichever ran last.
  ['supplyChainPosture', 'posture-scorecard', (d) => _scorecardCounts(d, 'scorecard.json')],
  // Deliberately NOT merged into the CVE lane, and deliberately excluded from the severity SUM
  // (TOTALS_EXCLUDE) — the two read the same advisory data, so summing them double-counts. This
  // lane exists for the SECOND OPINION: an independent engine over the same dependency graph, whose
  // disagreement with osv is the signal. Merging them would resolve that disagreement silently.
  ['depsReachability', 'deps-reachability', (d) => _depscanCounts(d, 'depscan.json')],
  // Static: reads the wrapper's declared distributionUrl and hashes the two committed artifacts.
  // Runs no Gradle, needs no container, and is the cheapest real signal on a JVM repo.
  ['gradleWrapper', 'gradle-wrapper', (d) => _gradleWrapperCounts(d, 'gradle-wrapper.json')],
  // The CI configuration is the part of the supply chain that runs holding repository credentials,
  // and no code scanner looks at it. zizmor audits it statically and OFFLINE, so unlike the cspm
  // lane beside it this one needs no token and cannot be gated into a permanent void.
  ['actionsPosture', 'actions-zizmor', (d) => _sarifDetail(d, 'zizmor.sarif', 'actionsPosture', null, zizmorSev)],
  ['accessibility', 'a11y-wcag', (d) => _a11yCounts(d, 'a11y.json')],
  // The two Deno lanes. Both are CORRECTNESS, not vulnerability — see TOTALS_EXCLUDE below and the
  // note on deno-check in manifests/security-baseline.json. They exist because a Deno repo would
  // otherwise be scored on the unconditional checks alone: no advisory database covers Deno's
  // URL/JSR import graph and osv-scanner rejects deno.lock, so its dependencies are checked against
  // nothing at all. Measuring the code is not a substitute for that, and neither lane pretends to
  // be; the void is declared in monitor/coverage-manifest.mjs where it can be read directly.
  ['denoLint', 'deno-lint', (d) => _denoLintCounts(d, 'deno-lint.json')],
  ['denoTypes', 'deno-check', (d) => _denoCheckCounts(d, 'deno-check.log')],
  // Kept apart from actionsPosture (zizmor) for the reason denoLint is kept apart from denoTypes:
  // they measure different properties of the same file, and one row would let a green posture audit
  // stand in for a correctness lint that never ran.
  ['actionsLint', 'actions-actionlint', (d) => _actionlintCounts(d, 'actionlint.json')],
  ['shellLint', 'shell-lint', (d) => _shellcheckCounts(d, 'shellcheck.json')],
  ['depsContent', 'deps-content', (d) => _depsContentCounts(d, 'deps-content.json')],
  ['agentInstructions', 'agent-instructions', (d) => _agentInstructionsCounts(d, 'agent-instructions.json')],
  ['commitProvenance', 'commit-provenance', (d) => _commitProvenanceCounts(d, 'commit-provenance.json')],
  // The target's own agent configuration: what an agent running in that repo may execute, where it
  // reaches, and what standing credential it holds. No other lane reads these files.
  ['agentConfig', 'agent-config', (d) => _agentConfigCounts(d, 'agent-config.json')],
  ['commitVelocity', 'commit-velocity', (d) => _commitVelocityCounts(d, 'commit-velocity.json')],
  ['modelArtefacts', 'model-artefacts', (d) => _modelArtefactsCounts(d, 'model-artefacts.json')],
  ['actionsGaps', 'actions-gaps', (d) => _actionsGapsCounts(d, 'actions-gaps.json')],
  ['actionsHealth', 'actions-health', (d) => _actionsHealthCounts(d, 'actions-health.json')],
  ['testHermetic', 'test-hermetic', (d) => _testHermeticCounts(d, 'test-hermetic.json')],
  // The one control keeping a medium jackson-databind CVE unreachable. It was a 'generic' lane with no
  // category, so a violation reached no total and no issue.
  ['jacksonCaseInsensitive', 'jackson-caseinsensitive-guard', (d) => _jacksonGuardCounts(d, 'jackson-guard.txt')],
];

// WCAG 2.2 conformance, by success criterion (bin/a11y-scan.mjs).
//
// A level-A failure is `high` and AA is `med`, because the levels are not a severity gradient of
// the same thing: level A criteria exclude people from using the interface at all. `unchecked` is
// counted rather than dropped — a criterion nobody could decide is an open question, and a category
// that reported only failures would let a page with 3 fails and 9 undecided criteria look better
// than it is.
//
// WHERE IT IS COUNTED CHANGED 2026-08-28, and the reasoning above is kept because it was never the
// wrong half. `unchecked` used to land in `low`, which made "a machine cannot decide this" into a
// FINDING — the grey-is-not-red violation, with the scanner's own sentence for why it could not
// decide sitting in the message field of a row published as a low. MEASURED on memory-layer: 7 of the
// lane's 12 rows were `unchecked`, so 58% of this repo's a11y findings were criteria nobody had
// looked at, and 7 of its 188 published lows had no claim behind them at all. `undetermined` is the
// field that already exists for exactly this, on its own axis outside crit/high/med/low, and the
// row still travels with `state` and `why` intact — visibility was never what `low` was buying.
function _a11yCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  if (j.ran !== true) return { ..._zero(), ran: true, nosrc: true };  // nothing served to audit
  const crit = Array.isArray(j.criteria) ? j.criteria : [];
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const r of crit) {
    let b = null;
    if (r.state === 'fail') { b = r.level === 'A' ? 'high' : 'med'; }
    else if (r.state === 'unchecked') { b = 'undetermined'; }
    if (!b) continue;                       // a PASS is not a finding; it is not published as a row
    c[b] = (c[b] || 0) + 1;
    // `total` is the findings total and an undetermined criterion is not a finding, so it does not
    // enter it — the same split cspm makes above, for the same reason.
    if (b !== 'undetermined') c.total++;
    // `why` is the scanner's own sentence for an UNCHECKED criterion — the reason a machine cannot
    // decide it. That sentence is the entire value of the row: it tells a human what to go and do.
    // sev '' is the schema's legal no-severity value (detail-schema COERCE.sev). An undetermined
    // criterion HAS no severity; giving it one is the assertion this change exists to remove.
    rows.push({ criterion: r.id, name: r.name, level: r.level, state: r.state,
      sev: b === 'undetermined' ? '' : b, message: r.why });
  }
  return { ...c, ..._detailFor('accessibility', rows) };
}

// The names the rollup and its tests both need. `_`-prefixed internals are exported too — the tests
// that used to regex them out of rollup.mjs now import them, which is the entire point of the split.
export {
  _sarifCounts, _sarifDetail, _trivyCounts, _nucleiCounts, _malCounts,
  _weakRandomCounts, _socketCounts, _socketAlertCount, _trufflehogCounts, _hadolintCounts, _govulnCounts,
  _tlsHeaderCounts, _cspmCounts, _scorecardCounts, _depscanCounts, _gradleWrapperCounts, _schemathesisCounts, _gitleaksCounts, _guarddogCounts,
  SCANNER_SPECS, _a11yCounts, _stubCounts, _minifyCounts, _bolaCounts, _socketAlertRows,
  _toolProvenance, _vendorCounts, _depsContentCounts, _agentInstructionsCounts, _commitProvenanceCounts, _agentConfigCounts, _modelArtefactsCounts, _commitVelocityCounts,
  _actionsGapsCounts, _actionsHealthCounts, _testHermeticCounts, _jacksonGuardCounts, zizmorSev,
};
