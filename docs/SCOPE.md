# Scope: what commitwork supports, refuses and does not measure

<!-- verified-against: 2026-10-13 5e582892 -->

This is the 1.0 scope statement. It says which lanes and platforms commitwork supports, what it
refuses to do, what it does not measure, and what it does not do at all. As of 2026-10-08, every
number below was read from a file in this tree or produced by a command run over it. Each statement
names its source, so it can be checked again. Where this document could not establish a fact, it
says so under [Gaps in this document](#gaps-in-this-document) and does not fill it in.

## Lanes

### What is declared

`manifests/security-baseline.json` declares **82 checks**. 77 of them feed a lane and 5 are
marked as not a lane (see [By kind](#by-kind)). The generated index is
[MANIFEST-MAP.md](MANIFEST-MAP.md), which `node bin/manifest-map.mjs --check` reported current.

Four other bundled manifests declare **19 checks**: `runtime` 7, `build-health` 6,
`quality-gates` 5 and `hermetic-tests` 1. The remaining files in `manifests/` carry no `checks`
key; they are data, such as formats, tool pins and the install catalogue.

| Group | Checks | Notes |
|---|---:|---|
| `all` | 76 | The default group. |
| `deep` | 25 | Mostly SAST and language-specific lanes, including the three contained build lanes below. |
| `fast` | 15 | |
| `supply-chain` | 15 | |
| `langs` | 7 | Rust, Elixir, Haskell and COBOL lanes, also split out as `rust` (3), `elixir` (1), `haskell` (1) and `cobol` (3). |
| `runtime` | 4 | Live-target lanes; see below. |
| `compare` | 3 | `secrets-betterleaks`, `sast-opengrep` and `sast-auto`; none of them is in `all`. |

Six checks are outside `all`: the three `compare` lanes, and `lint-rust-clippy`,
`sast-codeql-swift` and `sast-codeql-go`. Those three build or load the scanned tree, so they carry
a `containment` block and `commitwork run all` records them as `noscan`
([THREAT-MODEL.md](THREAT-MODEL.md), "Build-executing lanes are contained on `run`").

### By kind

`monitor/lane-kinds.mjs` (`LANE_KINDS`) gives each scanner category one kind, which says what its
severity is a severity *of*: **vulnerability** (exploitable), **posture** (a control's state),
**integrity** (is this artifact what it claims), **policy** (a rule commitwork chose) and
**hygiene** (a real defect, not a security claim). `monitor/lane-roster.mjs` declares the kind of
the four lanes outside `SCANNER_SPECS`. 77 of the 82 baseline checks feed a lane: 73 through their
own `SCANNER_SPECS` category, and four through `monitor/lane-roster.mjs`.

| Kind | Checks | Which |
|---|---:|---|
| vulnerability | 47 | the 23 `sast-*` checks; `secrets`, `secrets-gitleaks`, `secrets-betterleaks`, `secrets-cobol-jcl`; `deps-go-govulncheck`, `deps-gradle-declared`, `deps-jvm`, `deps-reachability`, `deps-retire`, `deps-ruby-bundler-audit`, `deps-rust-audit`, `npm-audit`, `yarn-audit`; `dast-nuclei`, `dast-authz-bola`, `api-fuzz`, `authz-test`; `actions-actionlint`, `agent-instructions`, `mobile-manifest`, `model-artefacts`, `node-hazards`, `vendor-scan`, `weak-random` |
| hygiene | 11 | the five `lint-*` lanes, `format-rust-rustfmt`, `deno-lint`, `deno-check`, `shell-lint`, `stub-detect`, `actions-health` |
| posture | 9 | `actions-gaps`, `actions-zizmor`, `agent-config`, `cspm-github`, `dockerfile-lint`, `iac-config`, `jackson-caseinsensitive-guard`, `posture-scorecard`, `tls-headers` |
| integrity | 8 | `cobol-inventory`, `commit-provenance`, `commit-velocity`, `deps-content`, `deps-osv`, `gradle-wrapper`, `minify-detect`, `supply-chain-guarddog` |
| policy | 2 | `a11y-wcag`, `supply-chain-socket` |
| not a lane | 5 | `sbom`, `sbom-syft`, `dep-provenance`, `deps-updates`, `deps-renovate` |

The four checks without a `SCANNER_SPECS` category of their own:

- `sast-opengrep` writes `semgrep.sarif` and is a declared alias of `sast` (`CHECK_ALIASES` in
  `monitor/scanner-checks.mjs`), so its findings report as `sastSemgrep`.
- `npm-audit` and `yarn-audit` write `npm-audit.json`, under gates that exclude each other. The
  rollup counts its rows in the dependency-CVE totals beside `deps-osv`. Lane: `depsNpmAudit`.
- `authz-test` writes `authz.json`, which only the runtime report reads. Lane: `authzIsolation`.

`deps-osv` is listed above under integrity, by its own category, `maliciousPackages`, which reads
only the MAL- rows of `osv.sarif`. The rollup counts every `osv.sarif` row in the dependency-CVE
totals, and a second lane, `depsOsv` (kind vulnerability), reads them the same way.

In the other bundled manifests:

- `runtime`: `dast-nuclei`, `tls-headers` and `cspm-github` are the baseline checks of the same
  name. `authz-bola` and `bola-run` are declared aliases of `dast-authz-bola` (lane `bola`), and
  `api-fuzz-schemathesis` of `api-fuzz` (lane `apiFuzz`). `tls-testssl` writes testssl's full run
  to `testssl-full.json`, which the rollup reads as its own category, `tlsTestssl` (kind
  posture). The category is kept out of the headline totals, because `tls-headers` already counts
  its own `testssl --fast` pass over the same listener.
- `hermetic-tests`: `test-hermetic` has its own `SCANNER_SPECS` category, `testHermetic`.
- `build-health` (6) and `quality-gates` (5): not a lane. Each writes a status (for example
  `clean`, `findings:N`, `RED`, `present` or `MISSING`) that the rollup carries under
  `repos[].buildHealth` or `repos[].qualityGates`, or that another check reads. No row has a
  severity.

`depsOsv`, `depsNpmAudit` and `authzIsolation` are the `OFF_SPEC_LANES`. None
reaches the rollup's `scanners` object. Each of the 16 checks that is not a lane writes an
inventory, a count or a status, and carries a `notALane` reason in its manifest.
`node monitor/lane-trust.mjs --table` prints each as `<manifest>/<check> not a lane: <reason>`.
`monitor/test/lane-roster.test.mjs` fails when a check in any bundled manifest feeds no lane and
has no reason.

The roster has 78 lane categories: 75 in `SCANNER_SPECS` and the three off-spec lanes. Two of them
belong to manifests other than the baseline: `testHermetic` (check `test-hermetic`, in
`hermetic-tests`) and `tlsTestssl` (check `tls-testssl`, in `runtime`).

### How far each lane is trusted

[LANE-TRUST.md](LANE-TRUST.md) defines the per-lane trust record that `monitor/lane-trust.mjs`
produces. `node monitor/lane-trust.mjs --json` over a checkout without the private stores reported
78 lanes, as follows:

| Evidence | Count |
|---|---|
| Golden fixture from the lane's own tool (`real`) | 58 |
| Drafted fixture, proving the parser only (`synthetic`) | 10 |
| Fixture older than provenance records (`unrecorded`) | 10 |
| Scan canary measured in both directions | 12 |
| Scan canary `not-measured` | 66 |

The same run accounted for all 101 checks in the five bundled manifests that declare checks: 85 in
a lane, 16 not a lane, 0 unaccounted.

| Manifest | Checks | In a lane | Not a lane |
|---|---:|---:|---:|
| `security-baseline` | 82 | 77 | 5 |
| `runtime` | 7 | 7 | 0 |
| `build-health` | 6 | 0 | 6 |
| `quality-gates` | 5 | 0 | 5 |
| `hermetic-tests` | 1 | 1 | 0 |

`depsOsv`'s fixture is a real `deps-osv` run (osv-scanner in Docker) over a synthetic seed, and
`depsNpmAudit`'s a real `npm audit` run over another. `authzIsolation`'s is
synthetic: the lane reads a live target, and each repository's own script defines its output.
`tlsTestssl`'s is synthetic for the same reason. Its draft is testssl.sh 3.2.4's own output against
a local self-signed listener, in which testssl graded 20 rows. The extractor publishes 19 at
testssl's own grade (1 critical, 5 high, 1 medium, 12 low) and carries the 20th, `overall_grade`,
as the lane's grade, because it restates the worst row. The one WARN row is counted undetermined.

`node monitor/lane-capability.mjs --json` runs every extractor against its golden fixture.
**All 78 lanes** produced structured counts, so every extractor is shown to work on at least one
fixture. There were no `defects`, meaning no lane declared as a vulnerability lane that cannot
count. Evidence by kind: golden 78, canary 12, extractor-test 7. The canary's `dependency-cve`
record is one osv-scanner run, so it credits `depsOsv` and no other dependency-CVE lane. Every
lane is read by a report: `measured.unreadLanes` is empty.
A golden fixture shows the parser works; it does not show the tool finds what it should. That is
what the canary column measures.

### Opt-in and live-target lanes

- **Live targets.** `dast-nuclei`, `dast-authz-bola`, `tls-headers` and `api-fuzz` declare
  `requiresUrl` and form the `runtime` group. Without `--url` / `CW_TARGET_URL` (or the
  operator's `--urls` map), each is skipped and recorded as a void
  ([THREAT-MODEL.md](THREAT-MODEL.md), "Per command"). With `authz-test`, they are the five checks
  with `egress: target`.
  These lanes send real requests. Pointing them only at systems you are authorised to test is the
  operator's job.
- **Needs `--trust-repo-manifest`.** `authz-test` is the only check that declares
  `requiresRepoTrust`. It runs the scanned tree's own `security/authz-isolation-test.sh`.
  Without consent it records `noscan` with the reason, never a pass or a finding.
- **Executes repository code.** Six checks declare `executesRepoCode: true`: `authz-test`,
  `deps-reachability`, `sast-php-psalm` and the three contained build lanes. These lanes get an
  allowlisted environment (`bin/lib/scanner-env.mjs`).
- **Egress.** All 82 checks declare an egress class: 38 `none`, 33 `registry`, 3 `verifiers`
  (`secrets`, `secrets-gitleaks`, `secrets-betterleaks`, which send candidate credentials to their
  issuers), 3 `github` and 5 `target`. Apart from `none`, these classes are labels. They do not
  restrict which internet hosts a lane can reach (THREAT-MODEL R8).

## Platforms

`package.json` `engines.node` is `>=22.18.0`. The CLI refuses an older runtime with exit 2 and
names the floor (`lib/node-floor.mjs`, held by `bin/test/node-floor.test.mjs`). There are no
runtime dependencies.

| | macOS | Linux | Windows |
|---|---|---|---|
| CI (`.github/workflows/ci.yml`) | Full suite, Node 22 and 26, **non-blocking** (`continue-on-error`) until its first measured green run on a hosted runner | Full suite, Node 22 and 26, required; a `linux-sandbox` job installs `bwrap` and `passt` and fails if a confinement test skips. `container.yml` builds the image and fails if a lane in it runs unconfined, only when the image's inputs change | Node 22 and 26, required: every module parses, the 16 platform-contract test files pass, the `bin/` and `lib/` tests leave the tree clean, `doctor` resolves a POSIX shell. **No pass or fail count is recorded for the rest of the suite** (see [Windows, as measured](#windows-as-measured)) |
| Host sandbox (`bin/lib/sandbox.mjs`) | `sandbox-exec` with a deny-default profile | `bwrap`. Weaker on reads: `/` is bound read-only, so most of the home directory is readable (THREAT-MODEL R4). A lane with network egress gets its own network namespace through `pasta` (package `passt`, `bin/lib/sandbox-net.mjs`); without `pasta` the lane is refused as `noscan`. `CW_SANDBOX=require` refuses every lane as `noscan` when `bwrap` cannot run, instead of running it unconfined | None. Lanes run unconfined and record `isolation: none` (THREAT-MODEL R5) |
| Install | `npm link` from a checkout, or `bin/install.sh` | `bin/install.sh` (a checkout's HEAD or a release tarball checked against its SHA-256, Node floor checked, then `setup` for named scanners) or the `container/Dockerfile` image ([container/README.md](../container/README.md)). Everything the image build fetches is pinned: the base by digest, Debian packages by a dated snapshot and exact versions, the Python scanners by a hash lock, gitleaks and trufflehog by release SHA-256 (`install.sh --release-only`). The image was built and run on Docker Desktop for arm64, and for amd64 under emulation; no Linux host, native amd64 or Podman run is measured. CI builds it only in `container.yml`, which has not run yet | `npm link`; `bin/install.sh` is POSIX `sh` and not supported here |
| Scheduling | launchd agents from `monitor/install-agents.mjs` | `install-agents` refuses off darwin. Use systemd user timers or cron with the same commands. No unit generator exists | Not covered; see gaps |
| Secrets | Keychain or `file:` references (`lib/secrets.mjs`) | `file:` references only | `file:` references only |
| Shell | the system POSIX shell | the system POSIX shell | `bash.exe` from Git for Windows, found by `doctor`. WSL is deliberately not used (README, "Windows") |

These features exist on macOS only, with no Linux or Windows path ([PLATFORM-SEAMS.md](PLATFORM-SEAMS.md)):

- the OS update lane (`sw_vers`, `softwareupdate`)
- the app-bundle inventory
- Homebrew package inventory (there is no apt/dnf lane)
- the archive encryption key in the keychain
- the `commitwork.local` name installer
- CodeQL's Swift build

On every platform, a missing tool reads as `unavailable` or `absent`, never as clean.

### Windows, as measured

Windows support is partial. Only the platform contract has measured results on Windows, and the
rest of the suite has none.

Windows CI measured 2026-10-07 at `b6a3167c`, Node 24.21.0: 233 pass / 0 fail / 1 skipped.

- **What ran.** The `windows-latest` job ran the 16 platform-contract test files it names (234
  tests: shell resolution, the process-tree kill, the repo walk, batch-shim spawning, path hazards,
  untrusted text, the listener lens, the installer's manager shapes, the scan-exclusion regex, and
  the gates for imports, docs freshness, measured records and the test runner). It also parsed 1,740 modules with `node --check`, and `doctor` found Git for
  Windows' `sh.exe`.
- **The skip.** One test is skipped, with a stated reason: `docs-doctor`'s "a git failure MID-CHECK
  fails the doc closed" needs a `#!/bin/sh` shim named `git`, and that shim is not executable on
  Windows.
- **What has no result.** The same job runs every `bin/` and `lib/` test file only to check that
  the tree stays clean. It discards their results, so no Windows pass or fail count exists for
  them. The `admin/`, `cra/`, `map/` and `sitemap/` tests, and the `monitor/` tests other than
  the two port-bind files, do not run on Windows at all.
- **Node 22.** The matrix has a Node 22 leg. As of 2026-10-08, no completed run had produced a
  result for it.

`node bin/platform-support.mjs --run <id>` turns a CI run into this record
(`reports/platform-support.json`, an operational file that is not tracked). `--check` exits 20 when
this statement and the record differ, and 23 when there is no record to check against.

## What it refuses

From [THREAT-MODEL.md](THREAT-MODEL.md), "Controls that exist", unless another file is named.

- **Repo-local manifests.** `run`, `scan` and `brief` refuse a `commitwork.json` found in the scanned
  tree unless `--trust-repo-manifest` or `COMMITWORK_TRUST_REPO_MANIFEST=1` is given. `list` and
  `doctor` parse it without executing it. The BOLA, IDOR and mass-assignment runners apply the
  same gate.
- **Repo-supplied scripts and targets.** Without the same consent, a `requiresRepoTrust` lane records
  `noscan`, and `resolveRepoUrl` ignores a `commitwork.url` in the tree and prints one line to stderr
  saying so.
- **Unbundled manifests over MCP.** The MCP server runs only bundled manifests that declare the
  requested group (`mcp/server.mjs`, `runnableManifests`). It refuses `/`, the home directory and
  credential directories as the repository.
- **Containment on `run`.** `commitwork run all` does not run the three build-executing lanes. It
  records them as `noscan`.
- **Unsafe container mounts.** `buildSandbox` refuses to mount the docker socket, `/`, `/etc`,
  `/dev`, `/proc`, `/sys` or a credential path.
- **Node below the floor.** The CLI exits 2 (see Platforms).
- **Corrupt stores.** A parse failure or permission error is an error, never an empty result. Only
  `ENOENT` means absent ([.github/SECURITY.md](../.github/SECURITY.md), "Fail closed").

## What it leaves unmeasured

- **Undetermined findings.** A row that a lane cannot settle goes to an `undetermined` field outside
  crit/high/med/low and keeps its original claim. LANE-TRUST's per-lane undetermined share reads
  rollups from the private fleet store. Without that store the column reads `not-measured` for all
  78 lanes, so this tree carries no measured share. For the three off-spec lanes it reads
  `not-measured` even with the store, because the rollup has no `scanners` bucket for them.
- **Lanes without canary evidence.** 66 of 78 lanes have no scan-canary record (see the trust table
  above). Their behaviour against a known-dirty tree is not measured.
- **Open high residual risks** (THREAT-MODEL, "Residual risks"):
  - **R4**: Linux confinement is much weaker than macOS on reads: `/` is bound read-only, so a
    lane can read most of the home directory. Lanes with network egress have their own namespace,
    so host loopback and `/run` sockets are out of reach; internet and LAN destinations are not.
  - **R6**: the `npx` lanes (`deps-retire`, `sbom`) run in the scanned tree, where a project
    `.npmrc` can redirect the registry.

  R1 and R3 are high only with `--trust-repo-manifest`, and closed by default. R2 (`scan` and
  `brief` running the build-executing lanes that `run` contains) is high only with `--allow-build`
  or `--trust-repo-manifest`, closed by default, and closed under `brief --pc` even with consent.
  R5 (no host sandbox) is high only under `CW_SANDBOX=off`. Without it, a lane that executes
  repository code is refused as `noscan`, and lanes that only analyse run unconfined unless
  `CW_SANDBOX=require` is set (the container image sets it).
- **Unversioned formats.** `manifests/formats.json` lists 31 public formats: 21 `frozen`, 5
  `external` and 5 `unversioned`. The unversioned ones are `lane-reports`,
  `check-manifests`, `evidence-pack`, `daily-suggestions` and `mcp-tools`.
  [STABILITY.md](STABILITY.md) states the policy.
- **Undocumented reference entries.** [REFERENCE.md](REFERENCE.md), reported current by
  `node bin/reference.mjs --check`, counts what has no description: 60 of 293 commands, 193 of 304
  exit codes, 644 of 745 `CW_*` variables, and 2 of 35 manifest check keys.

## Out of scope

- **Changing a scanned repository on its own authority.** Remediation output is prompts,
  hand-offs and diffs for a person to apply (README, "What this is NOT"). The one path that edits a
  scanned repository is `bin/issue-loop.mjs --apply`. An operator starts it by hand; without
  `--apply` it is a dry run. It runs an editing agent there (THREAT-MODEL R10).
- **Holding deployment credentials.** `bin/deploy.mjs` emits a tunnel ingress fragment and verifies
  it against the live config. It holds no Cloudflare credentials, changes no DNS and restarts no
  tunnel; applying stays a human step.
- **GitHub-side reporting.** Run locally, it does not produce Security-tab results, PR comments,
  issues or artifacts. The GitHub Action uploads SARIF to code scanning; it posts no PR comments and opens
  no issues (README, "What this is NOT").
- **Defending against compromised scanners or images.** These are trusted once installed. Host-side
  resource limits, shared `/tmp` and what a target lane does to its target are also undefended
  (THREAT-MODEL, "Not defended").

## Gaps in this document

- **The `linux-sandbox` job has one CI result.** As of 2026-10-08 it has run once: 43 tests passed
  and no Linux confinement test skipped. `bin/test/sandbox-linux-devices.test.mjs` is in the job
  and has no CI result yet. As of 2026-10-07, CI's Linux suite failed four tests (`daily-route`,
  `head-closure`, `no-unpinned-fetch`, `schema-required`); all four pass at the commit this
  document was verified against, on macOS and on Linux arm64 inside the container image. This
  document does not track Linux-suite failures after that date, and does not re-rate R4.

- **`tls-testssl` is read from one synthetic run.** Its fixture is testssl.sh 3.2.4 against a
  local self-signed listener, so the mapping has not been checked against a real edge's output.
  Whether its issues need authority, as `tls-headers`' do (`AUTHORITY_SCANNER_CATEGORIES` in
  `monitor/issue-store.mjs`), is not decided.
- **Windows scheduling.** No source in the tree names a Windows scheduler (Task Scheduler or
  otherwise). Whether the sweep can be scheduled there is not stated.
- **The Windows suite outside the platform contract.** CI records no Windows result for it (see
  [Windows, as measured](#windows-as-measured)). This document does not estimate one.
- **macOS CI.** The macOS job is non-blocking because it has never been measured green on a hosted
  runner. Whether it passes today is not recorded in the tree.
- **Scanner coverage per platform.** README says Windows coverage is thinner and that `commitwork
  setup` names the missing package manager. No per-platform count of installable tools was measured
  for this document.
