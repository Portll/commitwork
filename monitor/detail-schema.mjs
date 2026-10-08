// monitor/detail-schema.mjs — the one declaration of what a drill-down row is, per category;
// extractor, rollup and panel all derive from it. The whitelist is the safety argument: rows are
// built field by field from the schema, never by spreading a source object (scanner artifacts
// carry live secrets in undeclared fields). Types are bounds; sort is the determinism contract.

const STR_MAX = 240;
const PATH_MAX = 512;
const TEXT_MAX = 4000;   // must equal extractors.mjs MESSAGE_CAP — asserted by the tests
const SEVS = new Set(['crit', 'high', 'med', 'low']);

// Uncoercible values become the type's empty — never undefined, which vanishes from JSON.stringify.
// `text` truncates with an explicit marker; plain `str` truncates silently and is identifier-only.
const COERCE = {
  str: (v) => String(v == null ? '' : v).slice(0, STR_MAX),
  text: (v) => { const t = String(v == null ? '' : v); return t.length <= TEXT_MAX ? t : `${t.slice(0, TEXT_MAX)}… [truncated at ${TEXT_MAX} chars — see the scanner artifact for the full text]`; },
  path: (v) => String(v == null ? '' : v).replace(/^file:\/\/\/?/, '').slice(0, PATH_MAX),
  int: (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0),
  sev: (v) => (SEVS.has(String(v)) ? String(v) : ''),
  bool: (v) => v === true,
  // A real number kept to 3dp. `int` would truncate gitleaks' entropy 4.875 -> 4 and throw away
  // the only confidence signal that detector emits; 3dp is bounded so the sort stays byte-stable.
  num: (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : 0),
  // THREE states, and the third is the point: true / false / null.
  // `bool` maps everything that is not true to false, which would convert "no verifier exists for
  // this pattern" into "the service refused this credential". Those are opposite claims, and
  // collapsing them is the defect this field was added to fix.
  tri: (v) => (v === true ? true : (v === false ? false : null)),
};

// One entry per category that can produce a drill-down.
//   fields   — ordered [name, type, label]; order IS the panel's column order.
//   sort     — precedence order forming a total order (byte-determinism).
//   identity — the fields an authored annotation must name, ALL of them, no wildcard-by-omission.
//              `line` is excluded from every tuple — never key an identity on a line number.
//   note     — what one row of this category means (shown under the tab's coverage banner).
export const ROW_SCHEMAS = Object.freeze({
  sastCodeqlCpp: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per CodeQL C/C++ result. Extraction is degraded under build-mode none, so a low count is not a clean scan. `cwe` is whatever the rule itself asserts (sarif-read.mjs's cweOf()) — blank means the rule asserted none, never a guess.",
  },
  sastCCppcheck: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per cppcheck result. cppcheck writes SARIF to STDERR, so an absent artifact means the lane did not run rather than found nothing. Its `style` class is correctness, not a security verdict — severity comes from the SARIF level, never from the class name.",
  },
  sastCFlawfinder: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per flawfinder hit. LEXICAL matching: it flags dangerous FUNCTIONS, not proven dataflow, so a hit is a candidate and a zero is weaker evidence than a zero from sast-codeql-cpp. `cwe` comes from flawfinder's own tag.",
  },
  sastCodeqlSwift: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per CodeQL Swift result. Requires full Xcode; skips by tool otherwise. `cwe` per cweOf() — blank means the rule asserted none.",
  },
  sastCodeqlCsharp: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per CodeQL C# result, buildless (build-mode none). Razor .cshtml views and source generators are invisible to a buildless extractor — see the check's formatNotes. `cwe` per cweOf() — blank means the rule asserted none.",
  },
  sastCodeqlGo: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per CodeQL Go result. The database is built by tracing `go build` per module (bin/codeql-go-build.mjs), never the autobuilder, which would run the scanned repository's own build scripts. A module that does not compile leaves its files as extraction errors, which codeql-coverage subtracts, so a zero under reduced coverage is undetermined rather than clean. `cwe` per cweOf() — blank means the rule asserted none.",
  },
  sastCodeqlRust: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per CodeQL Rust result, buildless (no build.rs / proc-macro execution — probed 2026-08-26). Coverage is unmeasurable by construction (no expected-extracted-files baseline from the rust extractor), so zeros here always carry coverageIncomplete. `cwe` per cweOf() — blank means the rule asserted none.",
  },
  sastAuto: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Semgrep --auto result. A comparison arm against the sast lane, excluded from totals. `cwe` per cweOf() — blank means the rule asserted none.",
  },
  // Declared 2026-08-24 with the five lanes; joern/bearer/sobelow gained real parsers 2026-08-27
  // (clippy 2026-08-26), each written against real output — hlint's remains a stub
  // (_unverifiedShape in extractors.mjs). A schema here is a contract for the drill-down, not a
  // claim that rows exist. identity excludes `line` on all five, per the house rule: a finding
  // that moved is the same finding, and keying on a line number turns unrelated edits above it
  // into a state change.
  sastJoern: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Joern query result. joern-scan 4.x names no query id in its Result lines, so the query TITLE is the rule — stable per query, and the identity key.",
  },
  sastBearer: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Bearer finding. Bearer groups its JSON by severity key rather than emitting a flat array; the parser must flatten it.",
  },
  sastElixir: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Sobelow finding.",
  },
  lintRust: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per clippy diagnostic. Clippy emits NDJSON, not a JSON document, and --all-targets duplicates every diagnostic across bin and test targets; both must be handled by the parser.",
  },
  formatRust: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per file rustfmt would reformat (rule rustfmt) or could not parse (rule rustfmt/parse-error). line is the first differing hunk, payload only. sev is med where the repo declares rustfmt in CI or a rustfmt.toml, low where it does not.",
  },
  sastPython: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Bandit finding. `sev` is derived from issue_severity ALONE, never issue_confidence -- Bandit reports the two independently, and folding confidence into severity is the GuardDog capability-* defect (a likelihood-of-true-positive signal dressed as impact). Confidence rides in `message` as supplementary text instead of a new column, matching lintRust/lintGo's existing convention. `cwe` is Bandit's own issue_cwe.id, native to the tool's JSON (no SARIF cweOf() derivation needed -- Bandit has no SARIF format at all).",
  },
  lintPython: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per ruff finding, restricted to --select E,F,W,C90 --ignore S -- correctness/hygiene lint only; ruff's S-prefixed (bandit-equivalent) rules are deliberately excluded here so this lane cannot earn a green SAST row, the same rule lintGo/lintRust are held to. sastPython (Bandit) owns the security axis.",
  },
  lintGo: {
    fields: [['rule', 'str', 'Linter'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per golangci-lint issue. ruleId is the LINTER name (errcheck, ineffassign, staticcheck), not a rule number, so `rule` groups by linter rather than by individual check — which is the axis a reader triages on. Identity excludes line, as everywhere else.",
  },
  sastBrakeman: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Brakeman finding. `sev` comes from Brakeman's own `confidence` (High/Medium/Weak) — unlike Bandit, Brakeman has no separate severity axis, so confidence IS the only signal to map from; it also rides in `message` as readable context. `cwe` is Brakeman's native `cwe_id`, not derived — its SARIF output drops both confidence and CWE (checked directly against a real run, 2026-09-01), which is why this lane parses Brakeman's native JSON instead of going through the shared SARIF reader.",
  },
  depsBundlerAudit: {
    fields: [['rule', 'str', 'Advisory'], ['package', 'str', 'Gem'], ['version', 'str', 'Version'],
      ['sev', 'sev', 'Severity'], ['message', 'text', 'Title / patched']],
    sort: ['package', 'rule'],
    identity: ['rule', 'package'],
    note: "One row per Ruby gem advisory from bundler-audit. Unlike RustSec's cargo-audit, bundler-audit's `criticality` IS a real severity bucket (low/medium/high/critical) — but it can be null (measured: 15 of 40 rows in the verification fixture, run through the actual extractor), and a null criticality lands in undetermined rather than a guessed bucket. Same advisory universe as deps-osv (OSV imports the Ruby advisory DB too), so this lane is the second opinion, and its signal is disagreement.",
  },
  sastPhpPsalm: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'str', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Psalm taint result, read from psalm.sarif. `identity` excludes `line` deliberately: a taint path moves when unrelated code above it moves, and a line-keyed identity converts that into a state change. Psalm's taint rule ids are numeric (246 TaintedShell, 245 TaintedHtml, and so on), so `rule` carries the number and `message` carries the sentence — the number alone does not tell a reader what was found.",
  },
  sastPhp: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per phpcs finding under the pheromone/phpcs-security-audit ruleset. `sev` comes from `type` (ERROR/WARNING) ALONE — the ruleset's numeric `severity` field carries no real signal (measured: every message in the verification run reported severity:5, eval() and a dynamic mysqli param alike), so it is dropped rather than folded in as false precision. No `cwe` field: `source` is a dotted rule id (Security.BadFunctions.NoEvals.NoEvals) with no CWE mapping shipped by the ruleset or phpcs itself.",
  },
  lintJava: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per PMD violation, scoped to the errorprone/bestpractices/multithreading/performance rule categories only — codestyle, documentation and design are excluded so this stays a correctness/hygiene lint, the same restriction lintPython places on ruff's S-rules. PMD's own category/java/security.xml (2 rules: HardCodedCryptoKey, InsecureCryptoIv) is also excluded — that axis is sastCodeqlJava's territory, and a linter must never earn a green SAST row. `sev` folds PMD's 1-5 priority scale (1=High..5=Low) to high/med/low: 1-2 high, 3 med, 4-5 low. No `cwe` field: PMD's JSON renderer carries no CWE mapping for any rule.",
  },
  mobileManifest: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'Manifest'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per AndroidManifest.xml / Info.plist finding. `rule` is the lane's own dotted id (mobile/exported-no-permission, mobile/debuggable, mobile/cleartext-traffic, mobile/allow-backup) and `sev` comes from the SARIF level alone. No `cwe` field: none of the rules carries a CWE tag, and cweOf() would return an empty join rather than a mapping — so none is declared instead of inventing one. What it deliberately does NOT report is the load-bearing part: a LAUNCHER activity with exported=\"true\" is exempt (it must be exported for the app to start), and the ABSENCE of allowBackup or networkSecurityConfig is never a finding, because absence is the platform default rather than a decision. A lane that fires on ~100% of its subjects measures the platform, not the application — the GuardDog capability-* shape. Verified against real output 2026-09-01: a deliberately bad manifest yields 7 findings (5 error / 2 warning) and a well-formed one yields ZERO.",
  },
  nodeHazards: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Node/JS construct that is a defect BY PRESENCE rather than by reachability: TLS verification disabled, a cipher deriving its own IV, an unsafe YAML schema, a template bypassing its engine's auto-escaping. sastSemgrep answers whether untrusted input REACHES a sink and structurally cannot answer this one \u2014 a taint engine that finds no path reports nothing while the construct sits there. `sev` is the SARIF level, and it is deliberately uneven: TLS off and cipher-without-IV are errors, unescaped templates and cookie downgrades warnings, weak hash and the deprecated X-XSS-Protection header notes, because md5 for a checksum is not a vulnerability. No `cwe` field: the rules carry no CWE tag and cweOf() would return an empty join. Findings already adjudicated in source (cw-hazards-ignore, nosemgrep, or codeql[...]) are excluded from results and counted in run.properties.suppressedCount instead \u2014 this fleet's parseReport does not read SARIF's own suppressions field, so leaving them in results would publish adjudicated work as live.",
  },
  sastCobol: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'],
      ['evidence', 'str', 'Evidence'], ['cwe', 'str', 'Weakness'], ['fingerprint', 'str', 'Identity'], ['message', 'text', 'Message'],
      ['impact', 'text', 'Impact'], ['remedy', 'text', 'Fix'], ['reach', 'str', 'Reach'], ['effect', 'str', 'Effect'],
      // APPENDED, never inserted: field order is the panel's column order. Both came from the
      // retired cobolSecurity lane (2026-09-26), which read the same report.
      ['program', 'str', 'Program'], ['model', 'str', 'Flow model']],
    sort: ['file', 'line', 'rule', 'message'],
    // KEYED ON THE FINGERPRINT, not on rule|file. Two findings of one rule in one program are two
    // findings, and rule|file collapsed them into one; the fingerprint is cobolwork's own
    // line-independent identity (program id + section/paragraph + content anchor), so a program
    // that moves keeps it while `file` changes. identityIsKey is what makes monitor/issue-store.mjs
    // key the row this way — see scannerIdentityParts for why that is opt-in rather than implied.
    identity: ['fingerprint'],
    identityIsKey: true,
    note: "One row per cobolwork finding over COBOL, JCL and CICS source — the only lane on the roster that reports code findings in any of it (cobolCoverage and mainframeSecrets read the same trees for coverage and credentials). `evidence` is cobolwork's own statement of what kind of claim the row makes, and it decides where the row is counted: `path` (untrusted input traced to an OS command, dynamic SQL, a dynamic call or file, or an outbound channel), `construct` (a defect wherever it sits — a password in job data, an authority grant), `tampering` (text the compiler ignores carrying a payload, a copybook shadowing a system one), `advisory` (a pinned compiler with a published CVE), `exposure` and `change` are counted at cobolwork's severity. `coverage` rows are where the analysis stopped following — a pointer, an ALTERed GO TO, a program not in the tree — and carry no severity: they are counted under `undetermined`, never as findings. `context` rows describe the estate (a PARM entry point, a scheduler product in use), carry no severity, and are counted under `context`, beside the totals. None of the kinds claims exploitability: `path` is a route found by reading the code, not by running it. Severity is cobolwork's own crit/high/med/low, read from its native JSON rather than SARIF because SARIF collapses crit into high and publishes info as low. `fingerprint`, where the report carries one, is cobolwork's line-independent identity for the finding; the block records the scheme in `fingerprintVersion`. Its column is labelled Identity, not Fingerprint: admin/test/scanner-findings-route.test.mjs forbids a gitleaks source field name anywhere in the /api/state body, and a panelSchema label rides that payload. A report that states no evidence at all is still read - severity decides, and info is undetermined - so no single cobolwork version is required. `cwe` is the rule's declared CWE, blank where the rule declares none. `impact` and `remedy`, for a defect rule, are cobolwork's own statement of what the finding lets someone do and the standard fix, the same for every finding of the rule; an info row carries neither, and a report from before the tool stated them is read with those columns blank and `remediationRead: false` in the block, so blank there means the tool did not answer, not that the finding has no fix. `reach` and `effect`, where the estate declared the facts, are cobolwork's own statement of who can drive the finding (`open` to any user, or `restricted`) and what reaching it runs as (`privileged`); both are blank where the estate declared no such fact, and `reachRead: false` in the block marks a report from before the tool stated them at all, so blank never reads as `not reachable`. `program` is the program the finding sits in, where cobolwork names one, and a message ends `(N sources reach this statement)` when several sources reach one sink. `model` is the report's flow model, the analysis that decides which paths exist at all: monitor/issue-store.mjs refuses to close an issue as fixed when its row disappears under a different model, because that reading was never compared. The flow `trace` is not copied - it names every data item on the route - and stays in the report on disk. cobolwork's vocabulary - the reserved words, registers, system names, exception conditions and intrinsic functions its parser recognises - was re-derived from ISO/IEC 1989 drafts and fifteen vendor language references on 2026-09-25, replacing lists transcribed in part from another implementation's data files. A FALL in compile-undefined-name across that boundary is a SCOPE CHANGE and not remediation: the replaced lists carried no ISO exception-condition name at all, so EC-BOUND-SUBSCRIPT, EC-ARGUMENT-FUNCTION, EC-I-O-AT-END and 128 others were reported as names the program never declared, and they are words. Measured over six corpus repositories with the lists as the only variable: 290 findings to 219, of which 97 disappear because every name they reported is now attested by a cited document, 8 keep their identity and lose names, and 26 APPEAR because twelve ISO 2023 words are still unattested - the 2023 text is paywalled and only its contents preview is public. So a row that vanishes across that boundary, or whose message shortens, is the scanner learning words it should always have known rather than code being fixed. cobolwork/provenance/words.json names the document that attests each word.",
  },
  depsRustAudit: {
    fields: [['rule', 'str', 'Advisory'], ['package', 'str', 'Crate'], ['version', 'str', 'Version'],
      ['sev', 'sev', 'Severity'], ['message', 'text', 'Title / patched']],
    sort: ['package', 'rule'],
    identity: ['rule', 'package'],
    note: "One row per RustSec advisory from cargo-audit. sev is EMPTY by design — RustSec publishes CVSS vectors, not scores, so every row counts in undetermined and the vector rides in the message. The deps-osv row for the same crate carries OSV's severity; this lane is the second opinion, and its signal is disagreement.",
  },
  lintHaskell: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per hlint suggestion. Style, not security — this category is excluded from published totals.",
  },
  // ── evidence with a file and a line ───────────────────────────────────────────────────────────
  secrets: {
    // sev is now DERIVED FROM VERIFICATION and is empty for the common case. It used to be
    // uniformly `high` because _gitleaksCounts set total===high — for a detector that performs no
    // verification at all. Measured 2026-08-24: 2,368 rows at high, none verified, while the
    // sibling TruffleHog lane found 3 live credentials in the whole fleet. An empty sev here means
    // the row is counted in `undetermined`, outside crit/high/med/low, which is the honest state.
    // FIELD ORDER IS THE PANEL'S COLUMN ORDER, so the three added 2026-08-24 are APPENDED, not
    // inserted. The first draft put them between `sev` and `commit`, which silently moved Commit
    // two columns right — admin/test/derived-rows.test.mjs caught it against the captured bytes of
    // the retired literal renderer. Appending keeps every pre-existing column in its original
    // position, so that reference still holds as a prefix and a future reorder still fails loudly.
    // APPENDED 2026-08-29, at the end, for the reason the paragraph above gives. The extractor has
    // been emitting both since it learned to (extractors.mjs:1317) and the panel's thead has been
    // declaring both — the SCHEMA was the only one of the three that had not caught up, so the
    // deriver produced 10 columns against a thead of 12 and the lane's own guard went red. The fix
    // is to catch the schema up rather than narrow the thead: trimming would have made the test
    // pass by discarding two facts the extractor already computes.
    //   context         — where the match sits (same 'str' type the sast and iac lanes use)
    //   publicByDesign  — the rule matched a credential that is MEANT to be public. It is why `sev`
    //                     is null on those rows (:1306), so without this column the panel shows an
    //                     empty severity and no reason for it, which reads as a missing verdict
    //                     rather than a deliberate one.
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'],
      ['commit', 'str', 'Commit'], ['redacted', 'bool', 'Redacted'],
      ['verified', 'tri', 'Verified'], ['entropy', 'num', 'Entropy'], ['testPath', 'bool', 'Test path'],
      ['context', 'str', 'Context'], ['publicByDesign', 'bool', 'Public by design']],
    sort: ['file', 'line', 'rule'],
    identity: ['rule', 'file'],
    note: 'One row per secret gitleaks matched in the working tree. Values are never carried — the rule that fired, and where. `verified` is true only if an issuing service confirmed the credential is live; null means no verifier could be asked, which is NOT the same as safe. `testPath` marks a fixture or test file, where a credential is usually deliberate.',
  },
  secretsBetterleaks: {
    // The `secrets` shape, from the same row builder, with confidence appended: betterleaks emits it
    // per finding, and it is why most generic-* rows read as candidates rather than verdicts.
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'],
      ['commit', 'str', 'Commit'], ['redacted', 'bool', 'Redacted'],
      ['verified', 'tri', 'Verified'], ['entropy', 'num', 'Entropy'], ['testPath', 'bool', 'Test path'],
      ['context', 'str', 'Context'], ['publicByDesign', 'bool', 'Public by design'], ['confidence', 'str', 'Confidence']],
    sort: ['file', 'line', 'rule'],
    identity: ['rule', 'file'],
    note: 'One row per secret betterleaks matched in the working tree, under the same scope file as gitleaks. Values are never carried. `verified` comes from betterleaks --validation: true when the issuing service accepted the credential, false when it rejected or revoked it, null when the rule has no validator or the check errored, which is NOT the same as safe. `confidence` is betterleaks\' own low/medium/high; low marks a generic pattern match.',
  },
  secretsHistory: {
    // Raw/RawV2/Redacted exist in the artifact and are NOT declared — the only reason they cannot
    // reach a browser. Do not add them.
    // sev mirrors `verified` — exactly how the count splits it. Two columns, one fact, kept so a
    // severity sort does not see every history row as blank.
    // `verified` is TRI, not bool. Measured 2026-09-02 over 488 rows in 60 artifacts: 49 true, 439
    // false — and all 439 carried a VerificationError, every one a DNS failure against a placeholder
    // host. Not one was a refusal by an issuing service. Under `bool`, COERCE mapped all of them to
    // the word `false`, so the panel published "this credential was refused" for a population that
    // was entirely "nobody could ask". That is the same collapse COERCE.tri was added to fix on the
    // sibling `secrets` lane.
    fields: [['detector', 'str', 'Detector'], ['file', 'path', 'File'], ['line', 'int', 'Line'],
      ['sev', 'sev', 'Severity'], ['commit', 'str', 'Commit'], ['verified', 'tri', 'Verified'],
      ['verificationError', 'str', 'Why unverified']],
    sort: ['file', 'line', 'detector', 'commit'],
    identity: ['detector', 'file'],
    note: 'One row per secret found in git HISTORY. `verified` true is a credential the detector could still authenticate with — rotate first, scrub second. NULL means no verifier could be asked (the reason is in verificationError), which is not the same as safe and not the same as refused. The check runs --results=verified,unknown, so rows a verifier positively refuted are not published here at all.',
  },
  sastSemgrep: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per Semgrep pattern match. `cwe` is whatever the rule itself asserts (sarif-read.mjs's cweOf()) — blank means the rule asserted none, never a guess.",
  },
  sastCodeql: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per CodeQL result — each traces a source-to-sink path; the full flow stays in codeql.sarif and is not published here. `cwe` per cweOf() — blank means the rule asserted none.',
  },
  sastCodeqlJava: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per CodeQL (Java) result. `cwe` per cweOf() — blank means the rule asserted none.',
  },
  sastCodeqlPython: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per CodeQL (Python) result. Extracted under build-mode none, so this lane ran no code from the scanned repository. `cwe` per cweOf() — blank means the rule asserted none.',
  },
  sastCodeqlRuby: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per CodeQL (Ruby) result. Extracted under build-mode none, so this lane ran no code from the scanned repository. `cwe` per cweOf() — blank means the rule asserted none.',
  },
  sastGo: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message'], ['cwe', 'str', 'Weakness'], ['corroboratedBy', 'str', 'Corroborated by']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: "One row per gosec finding. `cwe` per cweOf() — blank means the rule asserted none.",
  },
  depsGradleDeclared: {
    fields: [['rule', 'str', 'Advisory'], ['file', 'path', 'Declared in'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Package']],
    sort: ['rule', 'file', 'message'],
    // Keyed on advisory + the file that DECLARED the coordinate, never on the package alone: the
    // same advisory legitimately arrives through several packages, and collapsing those would
    // report one finding where the project has several distinct routes to it.
    identity: ['rule', 'file'],
    note: 'One row per OSV advisory against a Gradle-declared dependency or its transitive closure. '
      + 'Resolution is DECLARED, not built: constraints, resolutionStrategy, platform BOMs and plugins '
      + 'can each pin a different version, so these rows are a floor on the exposure and never a ceiling. '
      + 'Each message states whether the package is direct or transitive.',
  },
  iac: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per infrastructure-as-code misconfiguration (trivy config).',
  },
  actionsPosture: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per CI-workflow weakness (zizmor). This is the part of the supply chain that runs holding repository credentials.',
  },
  dockerfile: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per hadolint rule on a Dockerfile.',
  },
  shellLint: {
    fields: [['rule', 'str', 'Code'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule'],
    identity: ['rule', 'file'],
    note: 'One row per shellcheck code (SCxxxx) per script. Identity is code+file, never line: a '
      + 'quoting fix three lines above must not re-open a finding that has not changed.',
  },
  actionsLint: {
    fields: [['rule', 'str', 'Kind'], ['file', 'path', 'Workflow'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['file', 'line', 'rule'],
    // actionlint has only a coarse `kind`; message (which does not move like line) is the third
    // identity component so distinct findings in one workflow do not merge.
    identity: ['rule', 'file', 'message'],
    note: 'One row per actionlint finding per workflow. HIGH is untrusted input interpolated into '
      + 'an inline run block — a script-injection sink, and a live RCE on pull_request_target.',
  },
  vendorAssets: {
    // severitySource: how the grade was reached. Blank sev WITH a source is a declared absence;
    // blank sev with none is a lane that never graded.
    fields: [['package', 'str', 'Package'], ['version', 'str', 'Version'], ['file', 'path', 'File'],
      ['id', 'str', 'Advisory'], ['sev', 'sev', 'Severity'], ['severitySource', 'str', 'Graded by'],
      ['severityReason', 'str', 'Why not'], ['cvssVia', 'str', 'CVSS from'],
      ['cwe', 'str', 'Weakness'], ['cwePillar', 'str', 'Weakness class'],
      ['capec', 'str', 'Attack pattern'], ['capecVia', 'str', 'Pattern via'],
      ['attack', 'str', 'ATT&CK'], ['attackTactic', 'str', 'Tactic'],
      ['capecReason', 'str', 'Pattern gap'], ['summary', 'text', 'Summary']],
    sort: ['file', 'id', 'package'],
    // `version` is IN the tuple: a suppression on vendored code must not survive the upgrade it
    // reasoned about — the suppression evaporating is the safe failure.
    identity: ['package', 'version', 'file', 'id'],
    note: 'One row per advisory against a VENDORED bundle — third-party code committed into this repo, which every manifest-gated dependency lane skips by definition. Files the scanner could not identify are counted separately and are a coverage void, not a clean result.',
  },
  stubs: {
    // The hygiene lane; excluded from `totals` on purpose (a TODO is not a vulnerability).
    // `context` (2026-08-28): 'comment' where the marker is a note somebody left, 'code' where the
    // same WORD appears in an identifier, a string or a prop. Both twins ship a to-do feature, so
    // `todo` is a domain noun in their source — measured, 1,040 memory-layer rows of which 10 held the CAPS
    // word. Only comment-context rows enter the count; code-context rows are carried in
    // `undetermined` and keep their row here, so nothing is hidden.
    fields: [['marker', 'str', 'Marker'], ['file', 'path', 'File'], ['line', 'int', 'Line'],
      ['sev', 'sev', 'Severity'], ['context', 'str', 'Context'], ['message', 'text', 'Detail']],
    sort: ['file', 'line', 'marker', 'message'],
    identity: ['marker', 'file'],
    note: 'One row per unfinished-work marker (TODO / FIXME / placeholder / not-implemented). Excluded from the severity headline by design — a TODO is not a vulnerability.',
  },
  weakRandom: {
    // `fn` is the EVIDENCE for a clock finding, not decoration: `let timestamp = SystemTime::now()`
    // is a defect because it sits in `generate_api_key`, and a row without the function name cannot
    // be judged. `context` splits source from test/bench, where deterministic randomness is right.
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'],
      ['sev', 'sev', 'Severity'], ['context', 'str', 'Context'], ['fn', 'str', 'Function'],
      ['message', 'text', 'Detail']],
    sort: ['file', 'line', 'rule'],
    // NOT keyed on line — the house rule. A weak source moves when code above it moves, and a
    // line-keyed identity converts that movement into a fixed-and-reopened pair.
    identity: ['rule', 'file', 'fn'],
    note: 'One row per non-cryptographic RNG or clock reading that becomes a credential. A finding needs BOTH the weak source AND a credential-shaped assignment target (or a credential-generating enclosing function) — neither half is published alone, because Math.random() is correct for jitter and wrong only for a value an attacker benefits from guessing. Rows in test/bench/fixture paths carry sev \'\' and are counted under `undetermined`.',
  },
  mainframeSecrets: {
    // The same producer and the same row shape as `secrets` — one gitleaks, two rule packs — so the
    // fields are its fields deliberately rather than by copy: a divergence here would be two shapes
    // for one concept, free to drift apart. What differs is the corpus and the rules, which is why
    // it is a separate category and not a second file under the first one.
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'],
      ['sev', 'sev', 'Severity'], ['commit', 'str', 'Commit'], ['redacted', 'bool', 'Redacted'],
      ['verified', 'tri', 'Verified'], ['entropy', 'num', 'Entropy'],
      ['testPath', 'bool', 'Test path'], ['context', 'str', 'Context']],
    sort: ['file', 'line', 'rule'],
    identity: ['rule', 'file'],
    note: 'One row per mainframe credential match from gitleaks running cobolwork\'s rule pack: jcl-racf-password (PASSWORD= on a JOB statement), tso-logon-password, racf-command-password (ADDUSER/ALTUSER), cobol-value-credential (a credential in a VALUE clause, which is compiled INTO the load module and survives cleaning the source), embedded-sql-connect-password and cics-signon-password. `verified` is null throughout: gitleaks performs no verification, and every row therefore counts as undetermined rather than high — the same correction the `secrets` lane carries. These shapes are found by NO default rule in gitleaks or TruffleHog, confirmed against positive controls on 2026-09-16.',
  },
  cobolCoverage: {
    // No severity column, deliberately. Every row is a fact about what was read; a severity here
    // would turn "this copybook is somewhere else" into a defect nobody found.
    fields: [['kind', 'str', 'Kind'], ['name', 'str', 'Name'], ['count', 'num', 'Count'],
      ['message', 'text', 'What this means for coverage']],
    sort: ['kind', 'name'],
    identity: ['kind', 'name'],
    note: 'One row per coverage fact from cobolwork inventory: missing-copybook (a COPY that resolved to nothing in this tree, so the fields it defines were never read), unreadable (a file that could not be parsed — an EBCDIC conversion, a binary member with a COBOL extension, or a genuine failure), and source-format (how many files parsed as fixed, free, variable or terminal reference format). Every row is `undetermined` by construction: this lane finds no vulnerabilities, and its purpose is to stop a scan that read less than it appears to have read from being published as a clean one.',
  },
  minifiedCode: {
    // Readability is the signal — the files every other lane excludes are the most-scrutinised.
    // `capped` is declared because rowsFor() has no passthrough.
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['sev', 'sev', 'Severity'],
      ['capped', 'bool', 'Capped'], ['metric', 'str', 'Metric'], ['message', 'text', 'Detail']],
    sort: ['file', 'rule', 'metric', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per file×obfuscation-rule (minified-source / minified-oversize / unscannable-void / exec-redirection / dynamic-exec-nonliteral / exec-decode-pair / computed-dangerous-member / bidi-homoglyph / low-alphabet / entropy-blob / packer-signature / distributed-assembler). Readability is the signal, not a line.',
  },
  accessibility: {
    // A WCAG row is a criterion, not a violation site; `unchecked` is a first-class state.
    fields: [['criterion', 'str', 'Criterion'], ['name', 'str', 'Name'], ['level', 'str', 'Level'],
      ['state', 'str', 'State'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Why']],
    sort: ['criterion', 'state', 'name'],
    identity: ['criterion', 'name'],
    note: 'One row per WCAG 2.2 success criterion. `unchecked` means this scanner CANNOT decide it statically — it is not a pass, and it blocks conformance.',
  },
  // ── Deno: correctness rows, and neither is a vulnerability ────────────────────────────────────
  denoLint: {
    // `int`, not `num` — COERCE implements only str/text/path/int/sev/bool.
    fields: [['rule', 'str', 'Rule'], ['path', 'path', 'Path'], ['line', 'int', 'Line'],
      ['sev', 'sev', 'Severity'], ['message', 'text', 'Message']],
    sort: ['rule', 'path', 'line'],
    identity: ['rule', 'path'],
    note: 'One row per deno lint diagnostic. deno lint does not rank severity, so every row is `low` and the COUNT carries the signal — a ranking here would be invented. This lane measures code, not dependencies: Deno has no vulnerability lane at all (see monitor/coverage-manifest.mjs).',
  },
  denoTypes: {
    // One row per distinct TS code with `count`, not one per occurrence.
    fields: [['rule', 'str', 'TS code'], ['count', 'int', 'Occurrences'],   // `int` — see denoLint above
      ['sev', 'sev', 'Severity'], ['message', 'text', 'First message']],
    sort: ['count', 'rule'],
    identity: ['rule'],
    note: 'One row per distinct TypeScript error code from `deno check`, with its occurrence count. NOT a vulnerability lane — it measures correctness, and is excluded from the severity headline (TOTALS_EXCLUDE) so lint volume cannot drown real security findings.',
  },

  // ── evidence about a target rather than a file ────────────────────────────────────────────────
  dast: {
    // The host is dropped at the extractor; port+proto are carried (they name the SERVICE).
    // `port` is a string — the int coercion turns absent into 0, and 0 is a legible port number.
    fields: [['rule', 'str', 'Template'], ['path', 'path', 'Path'], ['port', 'str', 'Port'],
      ['proto', 'str', 'Proto'], ['sev', 'sev', 'Severity'], ['name', 'str', 'Name']],
    sort: ['port', 'path', 'rule', 'name'],
    identity: ['rule', 'path', 'port', 'proto'],
    note: 'One row per nuclei template match against a LIVE target. The hostname is stripped at the extractor — the PORT and PROTOCOL survive, because they say which service was hit, and the host says which machine.',
  },
  tlsHeaders: {
    fields: [['issue', 'str', 'Issue'], ['target', 'str', 'Target'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail']],
    sort: ['target', 'issue', 'message'],
    identity: ['issue', 'target'],
    note: 'One row per missing security header or TLS/certificate defect on a live endpoint.',
  },
  bola: {
    // The schema follows the producer (bin/authz-bola.mjs) rather than inventing fields.
    fields: [['probe', 'str', 'Probe'], ['path', 'path', 'Path'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail']],
    sort: ['path', 'probe', 'message'],
    identity: ['probe', 'path'],
    note: 'One row per object-level authorisation probe that returned another principal\'s object.',
  },
  apiFuzz: {
    fields: [['operation', 'str', 'Operation'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail']],
    sort: ['operation', 'message'],
    identity: ['operation'],
    note: 'One row per API operation that 500d or broke its own declared contract under schemathesis.',
  },
  // ── evidence about a package or a control ─────────────────────────────────────────────────────
  gradleWrapper: {
    fields: [['rule', 'str', 'Check'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail']],
    sort: ['rule', 'message'],
    identity: ['rule'],
    note: 'One row per Gradle wrapper integrity check. This lane verifies the wrapper FETCH PATH — '
      + 'where ./gradlew downloads its Gradle distribution from, and what the committed '
      + 'gradle-wrapper.jar and gradlew script are — WITHOUT running anything. It does NOT establish '
      + 'that running the wrapper is safe: build.gradle configuration-time code, gradle.properties '
      + 'jvmargs, settings.gradle pluginManagement and sub-module wrappers are all outside it, and a '
      + 'zero here must not be read as covering them.',
  },
  depsReachability: {
    fields: [['id', 'str', 'Advisory'], ['package', 'path', 'Package'], ['sev', 'sev', 'Severity'],
      ['reachability', 'str', 'Reachability'], ['insight', 'text', 'Insight']],
    sort: ['id', 'package'],
    identity: ['id', 'package'],
    note: 'One row per dep-scan finding over the dependency graph. `reachability` is `exploitable` ONLY where dep-scan adjudicated a path to the vulnerable symbol; everything else is `unadjudicated` — which is NOT a finding of unreachable, and must never be rendered as one. When the analyser produced no slices at all the category carries reachabilityState:not-produced and no reachability counts whatsoever.',
  },
  supplyChainPosture: {
    // `suggestion` + `note` (2026-08-28): a control that measures a PRACTICE rather than a weakness
    // — Fuzzing, CII-Best-Practices, Contributors, Packaging — is capped at `low` and says so on
    // the row. Without the field the cap is invisible and reads as a scoring quirk.
    fields: [['control', 'str', 'Control'], ['score', 'str', 'Score'], ['sev', 'sev', 'Severity'],
      ['suggestion', 'bool', 'Suggestion'], ['note', 'text', 'Note'],
      ['message', 'text', 'Detail'], ['docs', 'str', 'Docs']],
    sort: ['control', 'message'],
    identity: ['control'],
    note: 'One row per SCORED OpenSSF Scorecard check below 10. A check Scorecard could not determine (score -1) has NO row here on purpose — it is carried in the category\'s `undetermined` count instead, because an undetermined control is not a failing one. Identity is the control name alone: Scorecard reports one repo per run, and the score moves while the control does not.',
  },
  cspm: {
    // `suggestion` / `claimedSeverity` / `note` (2026-08-28): every FAIL here is a repository
    // SETTING, capped at `low` by operator ruling. `claimedSeverity` carries the platform's own
    // severity so the downgrade is auditable rather than silent — the same shape advisory-reach
    // uses for a demoted MAL- row, and the reason a reader can still see what GitHub claimed.
    fields: [['control', 'str', 'Control'], ['resource', 'str', 'Resource'], ['sev', 'sev', 'Severity'],
      ['suggestion', 'bool', 'Suggestion'], ['claimedSeverity', 'str', 'Platform severity'],
      ['note', 'text', 'Note'], ['message', 'text', 'Detail']],
    sort: ['control', 'resource', 'message'],
    identity: ['control', 'resource'],
    note: 'One row per failing GitHub posture control (Prowler/OCSF) — branch protection, secret scanning, and the rest of the standing configuration.',
  },
  maliciousPackages: {
    fields: [['id', 'str', 'Advisory'], ['package', 'str', 'Package'], ['version', 'str', 'Version'],
      ['ecosystem', 'str', 'Ecosystem'], ['advisory', 'str', 'Link']],
    sort: ['package', 'version', 'id'],
    identity: ['id', 'package'],
    note: 'One row per curated malware verdict (OSV MAL-). This is a confirmed verdict, not a heuristic.',
  },
  supplyChainHeuristic: {
    fields: [['rule', 'str', 'Rule'], ['package', 'str', 'Package'], ['version', 'str', 'Version'],
      ['message', 'text', 'Detail']],
    sort: ['package', 'version', 'rule', 'message'],
    identity: ['rule', 'package'],
    // No `kind` FIELD on purpose. The family is fully determined by the rule prefix, which every row
    // already carries, so declaring it would duplicate one fact in two columns — and the golden
    // master correctly refused it as a silent restyle. The split lives in the CATEGORY counts
    // (`capability`, `verdicts`), where it changes what is published as a finding, which is the part
    // that matters.
    note: 'One row per GuardDog signal, in TWO families told apart by the rule prefix. A VERDICT (threat-*, typosquatting, '
      + 'metadata_mismatch, bundled_binary, provenance_regression) is an adjudication and carries the '
      + 'lane\'s severity. A CAPABILITY (capability-*) is DESCRIPTION — this package can open a '
      + 'socket or spawn a process, which almost every real package can — and carries NO severity: it '
      + 'is counted under the category\'s `capability` field, outside crit/high/med/low. On '
      + 'sweep-20260820120254 capability rows were 602 of 675, across 255 packages including '
      + '@fortawesome/fontawesome-free. Publishing those as findings is the Lob-detector defect at 89% '
      + 'of a lane: a descriptive signal wearing a verdict\'s clothes.',
  },
  supplyChain: {
    // claimKind/sevReason are APPENDED, not slotted next to `sev` where they read better: the
    // golden master pins this lane byte-for-byte against the retired renderer, and appending keeps
    // that pin checkable as a prefix instead of re-baselining it. Socket sends no description, so
    // `Detail` is empty on every row anyway and nothing is pushed off the useful part of the table.
    fields: [['rule', 'str', 'Alert'], ['package', 'str', 'Package'], ['version', 'str', 'Version'],
      ['ecosystem', 'str', 'Ecosystem'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail'],
      ['claimKind', 'str', 'Kind'], ['sevReason', 'str', 'Why']],
    sort: ['package', 'version', 'rule'],
    // Ecosystem is part of the place (`requests` on npm ≠ PyPI); version stays OUT — re-keying on
    // a moving field is the line-number defect in different clothes.
    identity: ['rule', 'package', 'ecosystem'],
    note: 'One row per Socket supply-chain alert. `rule` is the alert TYPE, and the type is the '
      + 'only severity signal Socket sends — the alert is {type, policy, url, manifest} and `policy` '
      + 'is "warn" on all 35,488 of them. `claimKind` says which of five things the row claims '
      + '(licenceSpdxDisj is 98.3% of the lane and is policy, not vulnerability) and `sevReason` '
      + 'says why an undetermined row could not be graded. The type read as a version string until '
      + '2026-08-10: the extractor walked ecosystem/package/version and named those levels '
      + 'package/version/rule, so every published row was transposed one level and the alert type '
      + 'was never emitted at all.',
  },
  commitProvenance: {
    // `file` is the branch name (or HEAD when detached): the schema needs a place-ish key and a
    // commit has no path. Identity is the commit plus the rule — a sha never moves, so this is the
    // one lane where the natural key is also the stable one. No line, by the house rule.
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'Branch'], ['sha', 'str', 'Commit'],
      ['sev', 'sev', 'Severity'], ['cwe', 'str', 'Weakness'], ['message', 'text', 'Detail']],
    sort: ['sha', 'rule'],
    identity: ['rule', 'sha'],
    note: 'One row per commit-provenance finding over the last N commits: an unsigned commit on a branch expected signed (only where manifests/branch-protection.json says requireSigned), a merge authored by a machine with no `authorized by <person>` marker, an author/committer split between two humans, or a machine author absent from the target\'s declared bot list. `message` carries classification words only — the lane never emits subjects, bodies, names or emails, so identities are read with `git show --format=fuller <sha>` rather than from this row. `cwe` is the lane\'s own table (CWE-347 for the signature rule, CWE-345 for the other three). Rows whose path lies under a nested agent worktree (.claude/worktrees/<name>/) are set aside under `worktrees`, severity intact, and are not in these counts.',
  },
  depsJvm: {
    fields: [['id', 'str', 'Advisory'], ['package', 'str', 'Package'], ['version', 'str', 'Version'],
      ['sev', 'sev', 'Severity'], ['fixed', 'str', 'Fixed in']],
    sort: ['package', 'version', 'id'],
    identity: ['id', 'package'],
    note: 'One row per JVM dependency advisory (trivy).',
  },
  depsGo: {
    fields: [['id', 'str', 'Advisory'], ['package', 'str', 'Package'], ['sev', 'sev', 'Severity'],
      ['reachability', 'str', 'Reachability'], ['prover', 'str', 'Prover'], ['proofKind', 'str', 'Proof'],
      ['message', 'text', 'Detail']],
    sort: ['package', 'id'],
    identity: ['id', 'package'],
    note: 'One row per Go advisory. `reachability` is TYPED, not prose: `reachable` means govulncheck '
      + 'traced a call path to the vulnerable symbol, `unproven` means it did not — which is NOT a '
      + 'finding of unreachable, and this lane never asserts one. `prover` and `proofKind` exist '
      + 'because a second engine (dep-scan, depsReachability) now makes reachability claims of its own '
      + 'from a static slice rather than the compiler\'s call graph: two engines writing the word '
      + '"reachable" into free text would make very different claims look identical.',
  },
  depsRetire: {
    fields: [['component', 'str', 'Library'], ['version', 'str', 'Version'], ['id', 'str', 'Advisory'], ['sev', 'sev', 'Severity'], ['file', 'str', 'Found in'], ['message', 'text', 'Summary']],
    sort: ['component', 'version', 'id'],
    identity: ['component', 'id'],
    note: 'One row per known-vulnerable library found BY CONTENT, not by manifest. `Found in` is the file the library was detected inside, which is the point of the category: it is frequently a bundle belonging to some OTHER package, so the row names a library the lockfile never declares. Read it as a complement to deps-osv/npm-audit, never as a duplicate of them.',
  },
  depsContent: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'Lockfile key'], ['package', 'str', 'Package'],
      ['sev', 'sev', 'Severity'], ['cwe', 'str', 'Weakness'], ['message', 'text', 'Detail']],
    sort: ['file', 'rule', 'message'],
    // No line: a lockfile entry is re-serialised on every `npm install`, and the same package at a
    // new offset is the same finding. (rule, lockfile key, package) is the place.
    identity: ['rule', 'file', 'package'],
    note: 'One row per dependency-content finding from bin/deps-content.mjs: an install hook that fetches or executes (dep-install-exec), a registry package with no or a sha1 integrity hash (dep-missing-integrity / dep-weak-integrity), or an installed version that disagrees with the lockfile (dep-version-drift). `file` is the lockfile key (node_modules/<pkg>), never a source path. A hook\'s command is never carried: it is attacker-authored text. `cwe` is the rule\'s declared weakness (CWE-829, CWE-494, CWE-1357). Rows whose path lies under a nested agent worktree (.claude/worktrees/<name>/) are set aside under `worktrees`, severity intact, and are not in these counts.',
  },
  agentInstructions: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['sev', 'sev', 'Severity'],
      ['cwe', 'str', 'Weakness'], ['message', 'text', 'Detail']],
    sort: ['file', 'rule'],
    // No line: an instruction file is prose that is re-flowed freely, and the same hidden
    // character or directive at a new line is the same finding. (rule, file) is the place.
    identity: ['rule', 'file'],
    note: 'One row per file×rule from bin/agent-instructions.mjs over the files an agent reads as instructions (CLAUDE.md, AGENTS.md, .cursorrules, copilot-instructions, README, docs/): hidden-unicode (bidi controls, zero-width space, tag characters — the one definition minify-detect shares), html-comment-directive (a comment addressing an agent, carrying a shell verb or a URL), agent-directive-exec (fetch-and-execute outside an Install section), agent-directive-exfil (a credential path or variable paired with a send sink), encoded-blob (a 200+ character base64/hex run), directive-split-across-files (a line telling the reader to act on a linked or @-referenced instruction file that carries a fetch-and-execute or credential-to-sink payload; the row is on the referring file and names the target), directive-in-command-file (an exec/exfil directive in an executed prompt under .claude/commands/ or .cursor/rules/, no heading or cue exemption), guard-bypass-directive (an un-negated instruction in such a file to pass --no-verify, disable a hook or turn a CW_GUARD off) and instruction-env-indirection (a directive whose target is an environment variable or a fetched substitution). `message` carries counts, line numbers, paths, variable names and hosts only: the file is addressed to the model that will read this row. `cwe` is CWE-1427 for the directive rules, CWE-506 for encoded-blob, CWE-693 for guard-bypass-directive and CWE-829 for instruction-env-indirection. Rows whose path lies under a nested agent worktree (.claude/worktrees/<name>/) are set aside under `worktrees`, severity intact, and are not in these counts.',
  },
  agentConfig: {
    // `key` is the server name, hook event, permission entry or env KEY NAME — the thing the finding
    // is about. There is no `line`: agent config is keyed, and a configured value is never carried.
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['key', 'str', 'Server / key'],
      ['sev', 'sev', 'Severity'], ['cwe', 'str', 'Weakness'], ['message', 'text', 'Detail']],
    sort: ['file', 'rule', 'key', 'message'],
    identity: ['rule', 'file', 'key'],
    note: 'One row per agent-configuration finding in the scanned repository: an MCP server on a non-loopback host, one that shells out, or one whose host or binary is resolved from an environment variable at run time (mcp-host-from-env); a hook that fetches from the network or evaluates inline code; a hook whose command names a script in the tree and that script, read, fetches, pipes into a shell or reads a credential path (hook-script-content — a script outside the tree or unreadable is counted in summary.unreadableHookScripts, never judged clean; read for settings files and every file a settings include reaches); a fenced bash/sh block in a .claude/commands/ prompt that does the same (command-file-shell); a permission grant broad enough to be no bound at all; a Bash grant beside no permissions.deny entry covering credential reads (permissions-deny-missing, low); or an env value shaped like a credential. `key` names the server, hook event, permission entry or env KEY — the configured value is withheld by design. `cwe` is the rule\'s own declaration (RULE_CWE in bin/agent-config.mjs). A config file the scanned configuration includes (its `include` array, followed inside the tree only) is judged by the same rules and its rows carry its own path. Rows whose path lies under a nested agent worktree (.claude/worktrees/<name>/) are set aside under `worktrees`, severity intact, and are not in these counts.',
  },
  commitVelocity: {
    // `file` carries the author identity the burst belongs to; there is no line, and no file content
    // is read — only commit metadata (author, timestamp, changed paths).
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'Author'], ['sev', 'sev', 'Severity'],
      ['cwe', 'str', 'Weakness'], ['message', 'text', 'Detail']],
    sort: ['rule', 'file', 'message'],
    identity: ['rule', 'file'],
    note: 'One row per author whose commit, CI-file or credential-file edit rate crossed a per-hour threshold no human sustains — the machine-speed signal the July 2026 intrusion buried in routine noise. Metadata only: author, timestamp and changed-path classes, never file content. `cwe` is CWE-799 (improper control of interaction frequency). Rows whose path lies under a nested agent worktree (.claude/worktrees/<name>/) are set aside under `worktrees`, severity intact, and are not in these counts.',
  },
  modelArtefacts: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'],
      ['sev', 'sev', 'Severity'], ['cwe', 'str', 'Weakness'], ['message', 'text', 'Detail']],
    sort: ['file', 'rule', 'line'],
    // (rule, file) is the place. `line` is display only: a binary artefact has none, and a python
    // call that moves down a file is the same unpinned load, not a fixed one and a new one.
    identity: ['rule', 'file'],
    note: 'One row per file×rule from bin/model-artefacts.mjs: a pickle-family artefact whose opcode stream names an os/subprocess/builtins-class global (pickle-dangerous-global), a safetensors file whose header length or JSON is invalid (safetensors-header-invalid), a dataset loader config carrying a template marker or a remote scheme in a data path field (dataset-config-template / dataset-config-remote-scheme), python that trusts hub remote code or loads from a hub without a commit-sha revision (hf-trust-remote-code / hf-unpinned-revision), a Keras config carrying a Lambda layer (keras-lambda-layer — serialised Python that runs on load; read from a .keras zip, keras_metadata.pb or a Keras-2 .h5 model_config attribute), and a TensorFlow graph whose NodeDefs name a filesystem op (tf-graph-file-op: ReadFile/WriteFile) or a Python op (tf-graph-python-op: PyFunc-class). Detail carries module names, opcode counts, key paths, op names and sanitised layer names — never file contents. The summary declares `unreadable` and `skippedOversize` counts; a zero here with either non-zero is a partial read, not a clean one. Rows whose path lies under a nested agent worktree (.claude/worktrees/<name>/) are set aside under `worktrees`, severity intact, and are not in these counts.',
  },
  actionsGaps: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'Workflow'], ['job', 'str', 'Job'], ['step', 'str', 'Step'],
      ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['cwe', 'str', 'Weakness'], ['message', 'text', 'Detail']],
    sort: ['file', 'rule', 'job'],
    // (rule, workflow, job) is the place: a job keeps its finding when steps are added above it.
    identity: ['rule', 'file', 'job'],
    note: 'One row per job×rule from bin/actions-gaps.mjs: a job whose runs-on names the self-hosted label (self-hosted-runner), a workflow_run or pull_request_target job that checks out or downloads the triggering run\'s head (workflow-run-trigger — `step` names the first step that does), a job with no permissions: block on itself or the workflow (permissions-absent), and a job whose run step pipes a command into tee, cat, head, tail, sed, awk, cut, tr, sort, uniq or grep on a shell with no pipefail, so the step exits with the pipe\'s last command (exit-masked-by-pipe — `step` names the first such step). Detail carries the form of the match, the trigger names and command names — never a script body, an action reference or an expression. The summary declares `unparseable` and `unreadable` counts; a zero here with either non-zero is a partial read, not a clean one. Rows whose path lies under a nested agent worktree (.claude/worktrees/<name>/) are set aside under `worktrees`, severity intact, and are not in these counts.',
  },
  actionsHealth: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'Workflow'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail']],
    sort: ['file', 'rule'],
    // (rule, workflow) is the place: a red streak is one finding however long it grows.
    identity: ['rule', 'file'],
    note: 'One row per rule×workflow from bin/actions-health.mjs, read through gh api: a workflow whose last runs on the default branch all failed (ci-red-streak) and, once per repository, jobs Actions refused to start (ci-never-started, file .github/workflows). A void report (no github.com origin, no gh, no access, no runs) is a lane that did not measure, never a clean zero.',
  },
  testHermetic: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'Test binary'], ['test', 'str', 'Test'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail']],
    sort: ['file', 'test', 'rule'],
    // (rule, binary, test) is the place: a test keeps its finding when code moves around it.
    identity: ['rule', 'file', 'test'],
    note: 'One row per failing test from bin/hermetic-test.mjs, which runs cargo test with an empty HOME, debug info off and the operator\'s declared prepare steps: test-failed (file is the test binary\'s source), build-failed, prepare-failed (the detail carries its last output) and disk-headroom (the build against a hosted runner\'s free disk).',
  },
  jacksonCaseInsensitive: {
    fields: [['rule', 'str', 'Rule'], ['file', 'path', 'File'], ['line', 'int', 'Line'], ['sev', 'sev', 'Severity'], ['message', 'text', 'Detail']],
    sort: ['file', 'line', 'rule'],
    // (rule, file) is the place: the toggle keeps its finding when lines above it move.
    identity: ['rule', 'file'],
    note: 'One row per line that enables jackson-databind ACCEPT_CASE_INSENSITIVE_PROPERTIES, from bin/guard-jackson-caseinsensitive.mjs: configure(..., true) or .enable(...) in Java, accept-case-insensitive-properties or accept_case_insensitive_properties set true in Spring YAML or properties. The toggle is the precondition for CVE-2026-54515 (medium), so a row means the precondition holds whatever jackson version is installed. The matched line is not published. Paths the guard could not read are counted in `unreadable` and are never a clean result.',
  },
});

/** Categories that publish a drill-down. Replaces the hand-maintained DETAIL_KEYS. */
export const detailKeys = () => Object.keys(ROW_SCHEMAS);

// Identity tuple an annotation must fully name. null for an unknown category — a validation
// error, never "matches nothing".
export const identityFor = (key) => (ROW_SCHEMAS[key] ? [...ROW_SCHEMAS[key].identity] : null);

// Does this category's declared identity ALSO key its issues in monitor/issue-store.mjs?
// Opt-in, one lane at a time, because 22 of these categories declare an identity their rows carry
// in full (measured 2026-09-24) and every one of them is keyed rule|file today: inferring it would
// re-key all 22 at once and publish a fix for every open issue in them.
export const identityIsKey = (key) => !!(ROW_SCHEMAS[key] && ROW_SCHEMAS[key].identityIsKey);

/** The schema as the panel needs it: columns + note, no coercion internals. */
export function panelSchema() {
  const out = {};
  for (const [key, s] of Object.entries(ROW_SCHEMAS)) {
    // identity travels too. Without it the panel had to hardcode `rule` in every annotate button,
    // so a lane keyed on `detector` posted rule:undefined and the write was refused.
    out[key] = { columns: s.fields.map(([name, type, label]) => ({ name, type, label })), note: s.note, identity: [...s.identity] };
  }
  return out;
}

const _cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The total order a category's rows are stored in. Exported so tests can assert determinism. */
export function comparatorFor(key) {
  const s = ROW_SCHEMAS[key];
  if (!s) return () => 0;
  const types = Object.fromEntries(s.fields.map(([n, t]) => [n, t]));
  return (a, b) => {
    for (const f of s.sort) {
      const t = types[f];
      const d = (t === 'int') ? ((a[f] || 0) - (b[f] || 0)) : _cmp(String(a[f] ?? ''), String(b[f] ?? ''));
      if (d) return d;
    }
    return 0;
  };
}

// Build rows by construction, not filtering — an undeclared input key is never read. Returns
// null when the category has no schema (the extractor then reports counts only).
export function rowsFor(key, items) {
  const s = ROW_SCHEMAS[key];
  if (!s || !Array.isArray(items)) return null;
  const rows = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const row = {};
    for (const [name, type] of s.fields) row[name] = COERCE[type](it[name]);
    rows.push(row);
  }
  rows.sort(comparatorFor(key));
  return rows;
}

// Assert a published row set against its schema — violations reported, never silently repaired.
export function validateRows(key, rows) {
  const s = ROW_SCHEMAS[key];
  if (!s) return [`${key}: no schema declared, so its rows cannot be published`];
  if (!Array.isArray(rows)) return [`${key}: rows is not an array`];
  const declared = new Set(s.fields.map(([n]) => n));
  declared.add('repo');                       // prepended by the rollup's fleet flatten
  declared.add('annotation');                 // attached by the rollup's scanner-annotations overlay
  const out = [];
  for (let i = 0; i < rows.length && out.length < 20; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') { out.push(`${key}[${i}]: not an object`); continue; }
    for (const k of Object.keys(r)) if (!declared.has(k)) out.push(`${key}[${i}]: undeclared field '${k}'`);
    for (const [name, type] of s.fields) {
      if (!(name in r)) { out.push(`${key}[${i}]: missing declared field '${name}'`); continue; }
      const v = r[name];
      if (type === 'int' && !Number.isInteger(v)) out.push(`${key}[${i}].${name}: expected int`);
      if (type === 'bool' && typeof v !== 'boolean') out.push(`${key}[${i}].${name}: expected bool`);
      if ((type === 'str' || type === 'path' || type === 'text') && typeof v !== 'string') out.push(`${key}[${i}].${name}: expected string`);
      if (type === 'str' && typeof v === 'string' && v.length > STR_MAX) out.push(`${key}[${i}].${name}: exceeds ${STR_MAX}`);
      if (type === 'path' && typeof v === 'string' && v.length > PATH_MAX) out.push(`${key}[${i}].${name}: exceeds ${PATH_MAX}`);
      if (type === 'text' && typeof v === 'string' && v.length > TEXT_MAX + 80) out.push(`${key}[${i}].${name}: exceeds ${TEXT_MAX}`);
      if (type === 'sev' && v !== '' && !SEVS.has(v)) out.push(`${key}[${i}].${name}: '${v}' is not a severity bucket`);
    }
  }
  return out;
}

// The same declaration as a JSON Schema document. Generated, asserted equal to the checked-in
// copy; regenerate with `node monitor/detail-schema.mjs --write`.
export function jsonSchema() {
  const TYPE = { str: { type: 'string', maxLength: STR_MAX }, path: { type: 'string', maxLength: PATH_MAX },
    text: { type: 'string', maxLength: TEXT_MAX + 80 },
    int: { type: 'integer' }, bool: { type: 'boolean' }, sev: { type: 'string', enum: ['', ...SEVS] },
    num: { type: 'number' },
    // `null` is a LEGAL, MEANINGFUL value here, not an absence — "no verifier could be asked".
    // Typing this as boolean would make the schema reject the honest state and force a caller to
    // pick true or false, which is the collapse the tri-state exists to prevent.
    tri: { type: ['boolean', 'null'] } };
  // annotationView(a), attached by the rollup's scanner-annotations overlay.
  const ANNOTATION = {
    type: 'object', additionalProperties: false,
    required: ['action', 'at', 'reason', 'who', 'whoKind'],
    properties: {
      action: { type: 'string', enum: ['accept', 'false-positive', 'wont-fix'] },
      at: { type: 'string' }, reason: { type: 'string' },
      who: { type: 'string' }, whoKind: { type: 'string' },
    },
  };
  const properties = {};
  for (const [key, s] of Object.entries(ROW_SCHEMAS)) {
    const props = { repo: { type: 'string', description: 'prepended by the rollup fleet flatten' },
      annotation: ANNOTATION };
    for (const [name, type, label] of s.fields) props[name] = { ...TYPE[type], title: label };
    properties[key] = {
      type: 'array', description: s.note,
      items: { type: 'object', additionalProperties: false, required: s.fields.map(([n]) => n), properties: props },
    };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://commitwork.portll.net/schema/scanner-finding.schema.json',
    title: 'scannerFindings — per-category drill-down rows in rollup.json',
    description: 'GENERATED from monitor/detail-schema.mjs — do not hand-edit. `additionalProperties: false` is '
      + 'the load-bearing clause: these rows are served to a browser over a published tunnel, and the artifacts '
      + 'they are built from (trufflehog.json, gitleaks.json) carry live credential material in fields this '
      + 'schema does not name.',
    type: 'object', additionalProperties: false, properties,
  };
}

export const _limits = Object.freeze({ STR_MAX, PATH_MAX, TEXT_MAX, SEVS: [...SEVS] });

// `node monitor/detail-schema.mjs --write` regenerates the checked-in copy. Guarded on argv so
// importing this module stays pure — it is read by the rollup, the panel server and the tests.
if (isMainModule(import.meta.url) && process.argv.includes('--write')) {
  const { writeFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'scanner-finding.schema.json');
  writeFileSync(p, `${JSON.stringify(jsonSchema(), null, 2)}\n`);
  console.log(`wrote ${p}`);
}
import { isMainModule } from '../lib/is-main.mjs';
