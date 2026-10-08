# Scope: what commitwork supports, refuses and does not measure

<!-- verified-against: 2026-10-08 -->

This is the 1.0 scope statement. It says which lanes and platforms commitwork supports, what it
refuses to do, what it does not measure, and what it does not do at all. Every number below was
read from a file in this tree or produced by a command run over it on 2026-10-08. Each statement
names its source, so it can be checked again. Where this document could not establish a fact, it
says so under [Gaps in this document](#gaps-in-this-document) and does not fill it in.

## Lanes

### What is declared

`manifests/security-baseline.json` declares **82 checks** ("lanes"). The generated index is
[MANIFEST-MAP.md](MANIFEST-MAP.md), which `node bin/manifest-map.mjs --check` reported current.

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
**hygiene** (a real defect, not a security claim). 73 of the 82 baseline checks have a category.

| Kind | Checks | Which |
|---|---:|---|
| vulnerability | 43 | the 22 `sast-*` lanes other than `sast-opengrep`; `secrets`, `secrets-gitleaks`, `secrets-betterleaks`, `secrets-cobol-jcl`; `deps-go-govulncheck`, `deps-gradle-declared`, `deps-jvm`, `deps-reachability`, `deps-retire`, `deps-ruby-bundler-audit`, `deps-rust-audit`; `dast-nuclei`, `dast-authz-bola`, `api-fuzz`; `actions-actionlint`, `agent-instructions`, `mobile-manifest`, `model-artefacts`, `node-hazards`, `vendor-scan`, `weak-random` |
| hygiene | 11 | the five `lint-*` lanes, `format-rust-rustfmt`, `deno-lint`, `deno-check`, `shell-lint`, `stub-detect`, `actions-health` |
| posture | 9 | `actions-gaps`, `actions-zizmor`, `agent-config`, `cspm-github`, `dockerfile-lint`, `iac-config`, `jackson-caseinsensitive-guard`, `posture-scorecard`, `tls-headers` |
| integrity | 8 | `cobol-inventory`, `commit-provenance`, `commit-velocity`, `deps-content`, `deps-osv`, `gradle-wrapper`, `minify-detect`, `supply-chain-guarddog` |
| policy | 2 | `a11y-wcag`, `supply-chain-socket` |
| no category | 9 | `sast-opengrep`, `npm-audit`, `yarn-audit`, `sbom`, `sbom-syft`, `authz-test`, `dep-provenance`, `deps-updates`, `deps-renovate` |

A 74th category, `test-hermetic`, belongs to the `hermetic-tests` manifest, not the baseline.

### How far each lane is trusted

[LANE-TRUST.md](LANE-TRUST.md) defines the per-lane trust record that `monitor/lane-trust.mjs`
produces. `node monitor/lane-trust.mjs --json` over a checkout without the private stores reported
74 lanes, as follows:

| Evidence | Count |
|---|---|
| Golden fixture from the lane's own tool (`real`) | 56 |
| Drafted fixture, proving the parser only (`synthetic`) | 8 |
| Fixture older than provenance records (`unrecorded`) | 10 |
| Scan canary measured in both directions | 11 |
| Scan canary `not-measured` | 63 |

`node monitor/lane-capability.mjs --json` runs every extractor against its golden fixture.
**All 74 lanes** produced structured counts, so every extractor is shown to work on at least one
fixture. There were no `defects`, meaning no lane declared as a vulnerability lane that cannot
count. Evidence by kind: golden 74, canary 11, extractor-test 7. A golden fixture shows the parser
works; it does not show the tool finds what it should. That is what the canary column measures.

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
| CI (`.github/workflows/ci.yml`) | Full suite, Node 22 and 24, **non-blocking** (`continue-on-error`) until its first measured green run on a hosted runner | Full suite, Node 22 and 24, required; a `linux-sandbox` job installs `bwrap` and `passt` and fails if a confinement test skips | Node 22 and 24: every module parses, the platform-contract suites pass, the suite leaves the tree clean, `doctor` resolves a POSIX shell. **The full suite does not run.** |
| Host sandbox (`bin/lib/sandbox.mjs`) | `sandbox-exec` with a deny-default profile | `bwrap`. Weaker on reads: `/` is bound read-only, so most of the home directory is readable (THREAT-MODEL R4). A lane with network egress gets its own network namespace through `pasta` (package `passt`, `bin/lib/sandbox-net.mjs`); without `pasta` the lane is refused as `noscan` | None. Lanes run unconfined and record `isolation: none` (THREAT-MODEL R5) |
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
  74 lanes, so this tree carries no measured share.
- **Lanes without canary evidence.** 63 of 74 lanes have no scan-canary record (see the trust table
  above). Their behaviour against a known-dirty tree is not measured.
- **Open high residual risks** (THREAT-MODEL, "Residual risks"):
  - **R2**: `scan` and `brief` run the build-executing lanes that `run` contains.
  - **R4**: Linux confinement is much weaker than macOS on reads: `/` is bound read-only, so a
    lane can read most of the home directory. Lanes with network egress have their own namespace,
    so host loopback and `/run` sockets are out of reach; internet and LAN destinations are not.
  - **R5**: with no sandbox, lanes run unconfined rather than refusing, unless
    `CW_SANDBOX=require` is set (the container image sets it).
  - **R6**: the `npx` lanes (`deps-retire`, `sbom`) run in the scanned tree, where a project
    `.npmrc` can redirect the registry.

  R1 and R3 are high only with `--trust-repo-manifest`, and closed by default.
- **Unversioned formats.** `manifests/formats.json` lists 30 public formats: 7 `frozen`, 5
  `external`, 13 `unschematized` and 5 `unversioned`. The unversioned ones are `lane-reports`,
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

- **R4 is not re-rated here.** The `linux-sandbox` CI job measures bwrap and pasta confinement on
  every push and passed on the 0.5.0 release branch on 2026-10-08. This document records that
  result; it does not re-rate R4.

- **The lane count differs between files.** Nine baseline checks have no `SCANNER_SPECS` category, so
  neither `lane-trust` nor `lane-capability` covers them. How their output is read back into a
  rollup was not determined here.
- **Windows scheduling.** No source in the tree names a Windows scheduler (Task Scheduler or
  otherwise). Whether the sweep can be scheduled there is not stated.
- **macOS CI.** The macOS job is non-blocking because it has never been measured green on a hosted
  runner. Whether it passes today is not recorded in the tree.
- **Scanner coverage per platform.** README says Windows coverage is thinner and that `commitwork
  setup` names the missing package manager. No per-platform count of installable tools was measured
  for this document.
