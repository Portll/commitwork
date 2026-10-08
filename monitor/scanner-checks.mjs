// ── scanner category → the manifest check that produces it ───────────────────────────────────
// Not derivable by name (`secrets` reads gitleaks.json, written by the `secrets-gitleaks` check,
// not the `secrets` check). Authority is SCANNER_SPECS in monitor/extractors.mjs;
// monitor/test/scanner-checks.test.mjs imports it and fails if the two ever disagree.
// Also the ALLOWLIST for POST /api/scan — no caller-supplied string reaches a command line.
export const SCANNER_CHECKS = Object.freeze({
  sastCodeqlCpp: 'sast-codeql-cpp',
  sastCCppcheck: 'sast-c-cppcheck',
  sastCFlawfinder: 'sast-c-flawfinder',
  sastCodeqlSwift: 'sast-codeql-swift',
  sastCodeqlCsharp: 'sast-codeql-csharp',
  sastCodeqlRust: 'sast-codeql-rust',
  sastCodeqlGo: 'sast-codeql-go',
  sastAuto: 'sast-auto',
  sastElixir: 'sast-elixir-sobelow',
  lintHaskell: 'lint-haskell-hlint',
  lintRust: 'lint-rust-clippy',
  formatRust: 'format-rust-rustfmt',
  lintGo: 'lint-go-golangci',
  sastPython: 'sast-python-bandit',
  lintPython: 'lint-python-ruff',
  sastBrakeman: 'sast-ruby-brakeman',
  depsBundlerAudit: 'deps-ruby-bundler-audit',
  sastPhp: 'sast-php-phpcs',
  sastPhpPsalm: 'sast-php-psalm',
  lintJava: 'lint-java-pmd',
  mobileManifest: 'mobile-manifest',
  nodeHazards: 'node-hazards',
  sastCobol: 'sast-cobol-cobolwork',
  depsRustAudit: 'deps-rust-audit',
  depsJvm: 'deps-jvm',
  // Its own key, not an alias onto depsJvm: both report JVM dependency CVEs, but this one's
  // resolution is DECLARED (version catalogs and build files, closed transitively through deps.dev)
  // and is therefore a floor. Merging the counts would keep the number and lose the qualification.
  depsGradleDeclared: 'deps-gradle-declared',
  vendorAssets: 'vendor-scan',
  sastSemgrep: 'sast',
  sastCodeql: 'sast-codeql',
  sastCodeqlJava: 'sast-codeql-java',
  sastCodeqlPython: 'sast-codeql-python',
  sastCodeqlRuby: 'sast-codeql-ruby',
  iac: 'iac-config',
  supplyChain: 'supply-chain-socket',
  maliciousPackages: 'deps-osv',
  supplyChainHeuristic: 'supply-chain-guarddog',
  secrets: 'secrets-gitleaks',
  secretsBetterleaks: 'secrets-betterleaks',
  dast: 'dast-nuclei',
  bola: 'dast-authz-bola',
  stubs: 'stub-detect',
  weakRandom: 'weak-random',
  minifiedCode: 'minify-detect',
  cobolCoverage: 'cobol-inventory',
  mainframeSecrets: 'secrets-cobol-jcl',
  secretsHistory: 'secrets',
  sastGo: 'sast-go-gosec',
  sastJoern: 'sast-joern',
  sastBearer: 'sast-bearer',
  depsGo: 'deps-go-govulncheck',
  depsRetire: 'deps-retire',
  dockerfile: 'dockerfile-lint',
  tlsHeaders: 'tls-headers',
  apiFuzz: 'api-fuzz',
  cspm: 'cspm-github',
  supplyChainPosture: 'posture-scorecard',
  depsReachability: 'deps-reachability',
  gradleWrapper: 'gradle-wrapper',
  actionsPosture: 'actions-zizmor',
  accessibility: 'a11y-wcag',
  // Deno gets TWO categories, neither a dependency lane (no advisory DB covers its import graph);
  // kept separate from `sast` so a linter cannot earn a green SAST row
  denoLint: 'deno-lint',
  denoTypes: 'deno-check',
  // Separate from actionsPosture on purpose: zizmor audits SECURITY posture, actionlint audits
  // CORRECTNESS (+ shellchecks inline `run:` blocks) — one must not stand in for the other
  actionsLint: 'actions-actionlint',
  shellLint: 'shell-lint',
  depsContent: 'deps-content',
  agentInstructions: 'agent-instructions',
  // Reads the object graph for WHO made each commit, not the tree for what it contains.
  commitProvenance: 'commit-provenance',
  agentConfig: 'agent-config',
  commitVelocity: 'commit-velocity',
  modelArtefacts: 'model-artefacts',
  actionsGaps: 'actions-gaps',
  actionsHealth: 'actions-health',
  testHermetic: 'test-hermetic',
  jacksonCaseInsensitive: 'jackson-caseinsensitive-guard',
});

// ── the same probe declared twice, under two ids ────────────────────────────────────────────────
// An alias claims two ids name ONE scanner — declared here, never inferred from command text, and
// asserted against the manifests by scanner-checks.test.mjs (divergence is a test failure).
export const CHECK_ALIASES = Object.freeze({
  'authz-bola': 'dast-authz-bola',
  'bola-run': 'dast-authz-bola',
  'api-fuzz-schemathesis': 'api-fuzz',
  // Opengrep is Semgrep's OSS fork running the SAME packs — its findings belong to `sast`, not
  // beside it. Standby engine: on ordinary sweeps this maps a lane that did not run, correctly.
  'sast-opengrep': 'sast',
});

/** The canonical check id for a possibly-aliased one. Identity for anything not aliased. */
export function canonicalCheck(checkId) {
  return Object.prototype.hasOwnProperty.call(CHECK_ALIASES, checkId) ? CHECK_ALIASES[checkId] : checkId;
}

// Runtime scanners need a live base URL — the panel says so before spawning a job that can only
// skip. cspm is NOT here: it is gated on an API token, not a URL.
export const RUNTIME_CATEGORIES = Object.freeze(['dast', 'bola', 'tlsHeaders', 'apiFuzz']);

/** The check id for a category, or null if the category is not one we run. Closed set by design. */
export function checkForScanner(category) {
  return Object.prototype.hasOwnProperty.call(SCANNER_CHECKS, category) ? SCANNER_CHECKS[category] : null;
}
