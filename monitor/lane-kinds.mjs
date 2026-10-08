// monitor/lane-kinds.mjs — the lane register: what each scanner lane is CALLED, what it CLAIMS,
// and how those claims sum into a headline.
//
// Lifted out of monitor/extractors.mjs on 2026-09-05, unchanged. It was never an extractor: an
// extractor is (dir, filename) -> counts, and nothing here reads a file. It sat in that module
// only because the headline arithmetic grew where the categories were first written down.
//
// THE ADJACENCY IT GIVES UP, AND WHY THAT IS SAFE. The banner below used to read "beside the specs
// that earn them", and the tables genuinely must agree: every SCANNER_SPECS key needs a label here,
// and every label here needs a spec. That agreement is asserted in BOTH directions by
// monitor/test/scanner-registry.test.mjs, so it is held by a test rather than by two tables
// happening to sit near each other — which is the stronger of the two, and was already true before
// this move. Proximity was never the guard.
//
// monitor/extractors.mjs re-exports every public name below, so its 47 importers are untouched.
// ── THE DISPLAY NAMES, BESIDE THE SPECS THAT EARN THEM ───────────────────────────────────────────
// admin/index.html kept its own SCANNER_LABEL map and derived the coverage table's category set from
// it — `const ALL = Object.keys(SCANNER_LABEL)`. That map had TWELVE entries against this list's
// twenty-five, and the thirteen it lacked were not merely unlabelled: they were dropped from the
// table AND from its denominator. Measured on client-d 2026-08-06, the header read "12/12 categories"
// — full coverage of the programme — while eleven categories the rollup had spoken for were
// invisible, two of them (tls-headers, api-fuzz) sitting on unreported coverage gaps. A section
// built to refuse "0 findings means clean" was itself answering a question nobody asked.
//
// So the names live HERE, one row per spec, enforced by a test that compares the two key sets. A
// scanner cannot now be added without being named, and cannot be named without appearing. The panel
// still ships a fallback copy for rollups written before this shipped, and unions whatever it is
// given with the payload's own keys — belt and braces, because the failure mode is silence.
export const SCANNER_LABELS = Object.freeze({
  secrets: 'Secrets · Gitleaks',
  secretsBetterleaks: 'Secrets · Betterleaks',
  secretsHistory: 'Secrets in history · TruffleHog',
  sastSemgrep: 'SAST · Semgrep',
  sastCodeql: 'SAST · CodeQL (JS/TS)',
  sastCodeqlJava: 'SAST · CodeQL (Java)',
  sastCodeqlPython: 'SAST · CodeQL (Python)',
  sastCodeqlRuby: 'SAST · CodeQL (Ruby)',
  sastGo: 'SAST · gosec (Go)',
  sastCodeqlCpp: 'SAST · CodeQL (C/C++)',
  sastCCppcheck: 'SAST · cppcheck (C/C++)',
  sastCFlawfinder: 'SAST · flawfinder (C/C++, lexical)',
  sastCodeqlSwift: 'SAST · CodeQL (Swift)',
  sastCodeqlCsharp: 'SAST · CodeQL (C#)',
  sastCodeqlRust: 'SAST · CodeQL (Rust)',
  sastCodeqlGo: 'SAST · CodeQL (Go)',
  sastAuto: 'SAST · Semgrep --auto (comparison arm)',
  sastJoern: 'SAST · Joern (CPG, C/C++/binary)',
  sastBearer: 'Data-flow · Bearer (privacy/PII)',
  sastElixir: 'SAST · Sobelow (Elixir/Phoenix)',
  lintRust: 'Lint · clippy (Rust, not a security scan)',
  formatRust: 'Format · rustfmt (Rust, not a security scan)',
  sastPython: 'SAST · Bandit (Python)',
  lintPython: 'Lint · ruff (Python, not a security scan)',
  lintGo: 'Lint · golangci-lint (Go, not a security scan)',
  sastBrakeman: 'SAST · Brakeman (Ruby)',
  depsBundlerAudit: 'Ruby gem advisories · bundler-audit (second opinion)',
  sastPhp: 'SAST · phpcs + security-audit (PHP)',
  sastPhpPsalm: 'SAST · Psalm taint (PHP)',
  lintJava: 'Lint · PMD (Java, not a security scan)',
  mobileManifest: 'Mobile manifest · Android/iOS exported surface',
  nodeHazards: 'Node hazards · unsafe-by-presence constructs (JS/TS + templates)',
  sastCobol: 'SAST · cobolwork (COBOL, JCL, CICS)',
  depsRustAudit: 'RustSec advisories · cargo-audit (second opinion)',
  lintHaskell: 'Lint · hlint (Haskell, not a security scan)',
  depsGradleDeclared: 'Gradle declared deps · deps.dev + OSV (floor)',
  depsJvm: 'JVM CVEs · Trivy',
  depsGo: 'Go CVEs · govulncheck',
  depsRetire: 'JS library CVEs · Retire.js',
  maliciousPackages: 'Malicious packages · OSV MAL-',
  supplyChain: 'Supply chain · Socket',
  supplyChainHeuristic: 'Supply-chain heuristics · GuardDog',
  vendorAssets: 'Vendored assets',
  iac: 'IaC config · Trivy',
  dockerfile: 'Dockerfile · hadolint',
  cspm: 'Cloud posture · GitHub CSPM',
  supplyChainPosture: 'Supply-chain posture · OpenSSF Scorecard',
  depsReachability: 'Dependency reachability · OWASP dep-scan',
  gradleWrapper: 'Gradle wrapper integrity',
  actionsPosture: 'CI posture · zizmor',
  dast: 'DAST · nuclei',
  bola: 'Authz / BOLA',
  tlsHeaders: 'TLS + security headers',
  apiFuzz: 'API fuzz · Schemathesis',
  accessibility: 'Accessibility · WCAG',
  weakRandom: 'Insufficient randomness · credentials',
  denoLint: 'Deno lint',
  denoTypes: 'Deno type check',
  actionsLint: 'CI correctness · actionlint',
  shellLint: 'Shell · shellcheck',
  stubs: 'Stubs / unfinished work',
  minifiedCode: 'Minified / obfuscated code',
  cobolCoverage: 'COBOL coverage · copybooks resolved, formats, unreadable',
  mainframeSecrets: 'Mainframe credentials · RACF, JCL, TSO, CICS signon',
  depsContent: 'Dependency content · lockfile integrity + install hooks',
  agentInstructions: 'Agent instructions · hidden characters + injected directives',
  commitProvenance: 'Commit provenance · signatures, bots, identity',
  agentConfig: 'Agent config · MCP servers, hooks, permission grants',
  commitVelocity: 'Commit velocity · machine-speed activity',
  modelArtefacts: 'Model artefacts · pickle, safetensors, dataset configs, hub loads',
  actionsGaps: 'CI gaps · self-hosted runners, triggering-head checkouts, absent permissions',
  actionsHealth: 'CI health · red streaks, jobs never started, billed minutes',
  testHermetic: 'Hermetic tests · cargo test on an empty home, disk headroom',
  jacksonCaseInsensitive: 'Config guard · Jackson case-insensitive properties (CVE-2026-54515)',
});
// ── THE HEADLINE, SUMMED ─────────────────────────────────────────────────────────────────────────
// `totals` was dependency CVEs alone; everything else sat one level down in `scanners` and reached
// no headline. A repo with 88 leaked secrets and no CVEs reported 0 crit / 0 high and rendered as
// CLEAN. The headline now sums the CVE feed AND every security scanner category — minus the lanes
// declared non-additive below, where summing makes the number WRONG rather than big.
//
// ── WHAT EACH LANE CLAIMS (2026-08-26) ───────────────────────────────────────────────────────────
// Three independent axes, previously two hand-kept lists plus their comments:
//   kind       — WHAT is claimed. Severity is orthogonal to it: `high` means a different thing, and
//                asks for a different act, in each. Summing across kinds is the category error that
//                put 29,771 Socket licence alerts on course for the vulnerability headline (D15).
//   additive   — does this lane reach the flat severity sum. false ⇒ `why` states which of the two
//                unrelated reasons: `duplicate` (another lane already counted this data) or
//                `not-a-vulnerability` (real defects, wrong headline). The old single list
//                collapsed those; maliciousPackages and stubs were never the same case.
//   actionable — may a row be handed to somebody as work (operator ruling D4, 2026-08-13;
//                monitor/issue-store.mjs ingestArea).
// maliciousPackages proves the axes are independent: non-additive AND emphatically actionable.
//
// kinds: vulnerability (exploitable) · posture (a control's state) · integrity (is this artifact
// what it claims) · policy (a rule WE chose) · hygiene (a real defect, not a security claim).
const V = 'vulnerability'; const P = 'posture'; const I = 'integrity';
const POL = 'policy'; const H = 'hygiene';
const lane = (kind, why = '') => ({ kind, additive: !why, actionable: why !== 'not-a-vulnerability', why });
export const LANE_KINDS = Object.freeze({
  accessibility: lane(POL),                 // WCAG conformance — a standard we adopted
  actionsLint: lane(V),                     // untrusted input into `run:` is live RCE
  actionsPosture: lane(P),
  apiFuzz: lane(V),
  bola: lane(V),
  cspm: lane(P),
  dast: lane(V),
  denoLint: lane(H, 'not-a-vulnerability'),
  denoTypes: lane(H, 'not-a-vulnerability'),
  depsGo: lane(V),
  depsGradleDeclared: lane(V),
  depsJvm: lane(V),
  depsReachability: lane(V, 'duplicate'),   // dep-scan reads the advisory data parseOsv counted
  depsRetire: lane(V),
  dockerfile: lane(P),
  gradleWrapper: lane(I),
  iac: lane(P),
  lintHaskell: lane(H, 'not-a-vulnerability'),
  lintRust: lane(H, 'not-a-vulnerability'),
  formatRust: lane(H, 'not-a-vulnerability'),
  sastPython: lane(V),
  lintPython: lane(H, 'not-a-vulnerability'),
  lintGo: lane(H, 'not-a-vulnerability'),
  sastBrakeman: lane(V),
  // Same advisory universe as deps-osv (OSV imports the Ruby advisory DB), so counting it would
  // double every gem advisory; it exists for the second opinion, exactly like depsRustAudit below.
  depsBundlerAudit: lane(V, 'duplicate'),
  sastPhp: lane(V),
  sastPhpPsalm: lane(V),
  lintJava: lane(H, 'not-a-vulnerability'),
  // An exported component with no permission is reachable by any app on the device, and a
  // debuggable build is a live foothold — attack surface, not hygiene. lane(V), additive: nothing
  // else in the fleet reads the manifest, so these counts duplicate no other lane's.
  mobileManifest: lane(V),
  // Constructs that are defects by PRESENCE rather than by reachability — TLS verification
  // off, a cipher with no IV, a template bypassing its own escaping. sastSemgrep owns the
  // reachable question and structurally cannot own this one, so these counts duplicate nothing.
  nodeHazards: lane(V),
  sastCobol: lane(V),                       // the only lane that reports COBOL code findings
  // Same advisory universe as deps-osv (OSV imports RustSec), so counting it would double every
  // Rust advisory; it exists for the second opinion, exactly like depsReachability.
  depsRustAudit: lane(V, 'duplicate'),
  maliciousPackages: lane(I, 'duplicate'),  // MAL- records are inside cveTotals already
  minifiedCode: lane(I),
  // Additive, with one overlap stated rather than hidden. gitleaks' default pack has no rule for any
  // of these shapes (measured against positive controls), and five of the six find what sastCobol
  // cannot: a JOB-card PASSWORD=, a TSO LOGON, a VALUE clause, EXEC SQL CONNECT, CICS SIGNON. The
  // sixth, racf-command-password, fires on the same in-stream ADDUSER/ALTUSER ... PASSWORD(...) line
  // that sastCobol reports as jcl-instream-credential (measured 2026-09-26 on a synthetic job). That
  // line is graded once — crit in sastCobol — and sits in this lane's `undetermined`, because gitleaks
  // verifies nothing. Each rule reaches lines the other does not, so neither lane duplicates the other.
  mainframeSecrets: lane(V),
  // Coverage is not a vulnerability and must never reach the severity headline: an unresolved
  // copybook is a fact about what was read. It stays actionable — somebody can go and find it.
  cobolCoverage: lane(I, 'not-a-vulnerability'),
  sastAuto: lane(V, 'duplicate'),           // comparison arm over sastSemgrep's rule packs
  sastBearer: lane(V),
  sastCodeql: lane(V),
  sastCodeqlCpp: lane(V),
  sastCCppcheck: lane(V),
  sastCFlawfinder: lane(V),
  sastCodeqlCsharp: lane(V),
  sastCodeqlRust: lane(V),
  sastCodeqlGo: lane(V),
  sastCodeqlJava: lane(V),
  sastCodeqlPython: lane(V),
  sastCodeqlRuby: lane(V),
  sastCodeqlSwift: lane(V),
  sastElixir: lane(V),
  sastGo: lane(V),
  sastJoern: lane(V),
  sastSemgrep: lane(V),
  secrets: lane(V),
  secretsBetterleaks: lane(V, 'duplicate'),  // second engine over gitleaks' scope file and rules
  secretsHistory: lane(V),
  shellLint: lane(H),                       // additive: SC2086-class quoting defects are injection
  // vulnerability, and additive: a guessable API key is exploitable on its own, and no other lane
  // in the roster counts it (CodeQL ships no Rust query for it, clippy no lint, bearer one
  // language). Nothing to double-count against.
  weakRandom: lane(V),
  stubs: lane(H, 'not-a-vulnerability'),    // ~4019 TODOs, all `high` by _countArray convention
  supplyChain: lane(POL),                   // Socket, 97.9% licence policy — see D15
  supplyChainHeuristic: lane(I),
  supplyChainPosture: lane(P),
  tlsHeaders: lane(P),
  vendorAssets: lane(V),
  // integrity, additive: is the locked tree what it claims, and what does it do on install. The
  // advisory lanes read the same lockfile for a different question (published CVEs), so nothing
  // here duplicates their counts.
  depsContent: lane(I),
  // vulnerability, additive: a directive an agent will obey is exploitable on its own, and no
  // other lane reads an instruction file (minify-detect's bidi rule over prose counts a hidden
  // character, not the directive it hides — a different claim about the same line).
  agentInstructions: lane(V),
  // Is this commit what it claims — made by whom it says, signed where signing is expected. No
  // other lane reads the object graph for identity, so nothing to double-count against.
  commitProvenance: lane(I),
  // posture: the state of the controls an agent runs under. Additive — no other lane reads an MCP
  // declaration, a hook or a permission grant, so there is nothing to double-count against.
  agentConfig: lane(P),
  commitVelocity: lane(I),
  // vulnerability, additive: a pickle naming os.system executes on load and a loader template
  // executes on read. No other lane opens a model artefact or a dataset config, so nothing here
  // duplicates another lane's counts.
  modelArtefacts: lane(V),
  // posture, additive: a runner choice, a trigger-plus-checkout shape and a missing permissions
  // block are states of the CI controls. zizmor reports the trigger and the absent block too, but
  // it is absent on hosted runners and never emits self-hosted-runner at the fleet's persona.
  actionsGaps: lane(P),
  // hygiene, not a vulnerability: platform state (red streaks, never-started jobs, billed minutes).
  actionsHealth: lane(H, 'not-a-vulnerability'),
  // hygiene, not a vulnerability: runs repo code (cargo test) to find real defects.
  testHermetic: lane(H, 'not-a-vulnerability'),
  // posture, additive: the state of the one control keeping CVE-2026-54515 unreachable. depsJvm
  // counts the advisory; this counts the toggle that makes it exploitable, a different claim.
  jacksonCaseInsensitive: lane(P),
});
export const LANE_KIND_NAMES = Object.freeze([V, P, I, POL, H]);
export const kindOf = (category) => (LANE_KINDS[category] || {}).kind || '';

// Both derived, sorted so the published order is stable by construction rather than by accident of
// declaration. Membership is asserted against the pre-derivation literals in
// monitor/test/lane-kinds.test.mjs — the table may not silently re-base the headline.
const laneNames = Object.keys(LANE_KINDS);
export const TOTALS_EXCLUDE = Object.freeze(laneNames.filter((k) => !LANE_KINDS[k].additive).sort());
export const METRIC_CATEGORIES = new Set(laneNames.filter((k) => !LANE_KINDS[k].actionable).sort());

// Exported and pure so the arithmetic is testable without running a sweep — the previous headline
// was wrong for months precisely because nothing asserted what it summed.
export function sumTotals(cveTotals, scanners, exclude = TOTALS_EXCLUDE) {
  const skip = new Set(exclude);
  const sev = (k) => Object.entries(scanners || {})
    .filter(([name, v]) => v && !skip.has(name))
    .reduce((n, [, v]) => n + (Number(v[k]) || 0), 0);
  return {
    ...cveTotals,
    crit: cveTotals.crit + sev('crit'),
    high: cveTotals.high + sev('high'),
    med: cveTotals.med + sev('med'),
    low: cveTotals.low + sev('low'),
    // UNDETERMINED IS SUMMED TOO, and it is not one of the four. A lane that grades nothing — a
    // gitleaks regex match with no verifier to ask — is counted here and nowhere else. Omitting it
    // was worse than the bug it replaced: with the severity fix in place but no aggregate, 2,368
    // rows became total:2368 / crit:0 / high:0 / med:0 / low:0 in the history slice, and a reader
    // of the four buckets would have concluded the fleet was clean. Grey must be VISIBLE, not
    // merely kept out of red.
    undetermined: (Number(cveTotals.undetermined) || 0) + sev('undetermined'),
    // `cves` and `kev` stay CVE-ONLY — they name a specific feed, not "everything found"
    cveTotals,
    excludedFromTotals: [...skip],
    // The same counts, partitioned by what they CLAIM. Nothing is dropped or re-weighted: the
    // kinds sum back to the buckets above, asserted by monitor/test/lane-kinds.test.mjs. The
    // flat number stays because it is what every consumer reads today; the partition is what makes
    // it sayable — "14 high" is not a fact until it says high WHAT.
    byKind: partitionByKind(cveTotals, scanners, skip),
  };
}

// A lane the table does not know is `unclassified`, never folded into vulnerability. It still
// reaches the flat sum exactly as before, so the partition surfaces the gap instead of hiding it.
export function partitionByKind(cveTotals, scanners, skip = new Set(TOTALS_EXCLUDE)) {
  const zero = () => ({ crit: 0, high: 0, med: 0, low: 0, undetermined: 0 });
  const out = Object.fromEntries([...LANE_KIND_NAMES, 'unclassified'].map((k) => [k, zero()]));
  const add = (bucket, v) => {
    for (const s of ['crit', 'high', 'med', 'low', 'undetermined']) bucket[s] += Number(v[s]) || 0;
  };
  add(out.vulnerability, cveTotals || {});   // the CVE feed is a vulnerability claim by definition
  for (const [name, v] of Object.entries(scanners || {})) {
    if (!v || skip.has(name)) continue;
    // A lane whose ROWS carry different kinds partitions itself — Socket is five claims in one
    // lane. Its own split wins over the lane-level declaration; an unrecognised kind from a lane
    // still goes to `unclassified` rather than being trusted into the vocabulary.
    if (v.byKind && typeof v.byKind === 'object') {
      for (const [k, b] of Object.entries(v.byKind)) add(out[k in out ? k : 'unclassified'], b || {});
      continue;
    }
    add(out[kindOf(name) || 'unclassified'], v);
  }
  return out;
}
