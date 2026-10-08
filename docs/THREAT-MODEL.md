# Threat model: scanning untrusted repositories

<!-- verified-against: 2026-10-08 -->

This document states, per command, what commitwork **executes**, **reads** and **reaches over the
network** when it is pointed at a repository it does not own, which controls stand between that
repository and the host, and what is left undefended. It was written by reading the code at the
commit in the stamp above. Where a fact could not be established from the code, it says
**not determined** rather than guessing.

Reporting a vulnerability, scope and the load-bearing defaults are in
[.github/SECURITY.md](../.github/SECURITY.md). This file does not repeat them.

## Attacker model

| Attacker | Controls | Wants |
| --- | --- | --- |
| **Malicious repository contents** | Every file in the scanned tree: source, lockfiles, `package.json`, `.npmrc`, `composer.json`, `Cargo.toml` and `build.rs`, Swift packages, `vendor/autoload.php`, scripts under `security/`, `commitwork.url`, `openapi.*`, `.env`, symlinks, file names, commit messages | Code execution on the host; read access to credentials, other repositories and other repositories' scan reports; use of the host's network position (loopback services, the LAN, the operator's tokens) |
| **Malicious manifest** | A repo-local `commitwork.json`, or a repo-local BOLA manifest | Have commitwork run arbitrary shell, or mint and send credentials, under the operator's session |
| **Poisoned tool output / prompt injection** | Any text that flows from the tree into a report: rule messages, package metadata, file paths, commit subjects, finding evidence | Steer a model that reads commitwork output (MCP clients, the remediation agents) into suppressing findings or taking actions |
| **Malicious dependency** | A package the scanned tree depends on, fetched by a lane that resolves or builds | The same as malicious repository contents, one hop removed |

Out of scope for this document: an attacker who already has a shell as the operator, the panel's
own web attack surface (see [admin/README.md](../admin/README.md)), and compromised scanner
binaries or container images (they are trusted once installed; see "Not defended").

## Trust boundaries

1. **Manifest provenance.** A manifest is `bundled` (under `manifests/`), `explicit` (a path the
   operator passed) or `repo-local` (a `commitwork.json` found in the working directory). Only
   `repo-local` is untrusted by default (`bin/commitwork.mjs`, `resolveManifestPath` and
   `assertManifestTrusted`).
2. **The host sandbox.** Lanes that run on the host are wrapped by `sandbox-exec` on macOS and
   `bwrap` on Linux (`bin/lib/sandbox.mjs`, `hostSandboxArgv`). The scanned tree is on the inside;
   the operator's home directory, credential stores and local services are meant to be on the
   outside.
3. **Containers.** Docker lanes declare a posture from `bin/lib/sandbox.mjs` `POSTURES` (`analyse`,
   `fetch`, `lookup`, `boot`, `resolve`, `build-resolve`, `instrument`).
4. **The lane environment.** `bin/lib/scanner-env.mjs` decides which environment variables a lane
   sees. Lanes that execute repository code get an allowlist; all others get a denylist.
5. **The model boundary.** Text that reaches an MCP client or a `claude` child process
   (`lib/untrusted-text.mjs`, `lib/claude-spawn.mjs`).

## Controls that exist

### Repo-local manifests do not execute without consent

`commitwork run` (without `--dry-run`), `scan` and `brief` (without `--from`/`--dry-run`) refuse a
repo-local `commitwork.json` unless `--trust-repo-manifest` or `COMMITWORK_TRUST_REPO_MANIFEST=1`
is given (`bin/commitwork.mjs`, `main`). `list` and `doctor` parse it without executing it.
`--act` honours `--dry-run` before spawning `act`, so a dry run cannot execute a repo workflow.
The BOLA runners (`bin/bola-run.mjs`, `bin/idor-run.mjs`, `bin/mass-assign-run.mjs`) apply the
same gate to a repo-local BOLA manifest. The MCP server accepts only bundled manifest names that
declare a group (`mcp/server.mjs`, `runnableManifests`).

### Repo-supplied scripts and targets in bundled manifests need the same consent

The same flag (or `COMMITWORK_TRUST_REPO_MANIFEST=1`) gates two things a scanned tree supplies to
a bundled manifest. Both are in `bin/commitwork.mjs` and are checked by
`bin/test/repo-trust-gate.test.mjs`.

- **Lanes that run a script from the tree.** A check that declares `requiresRepoTrust: true` runs
  only with consent, on both `run` and `scan`. Without it the lane records `noscan` with the reason
  `repo-supplied script; pass --trust-repo-manifest to run it`, never a pass or a finding. A tree
  without the script stays n/a. In the bundled manifests the only such lane is `authz-test`. The
  test fails if any bundled lane hands a repo-relative script to a shell without the declaration.
- **`commitwork.url`.** `resolveRepoUrl` ignores the file without consent and prints one line to
  stderr naming it. The operator's `--urls` map, `--url` and `CW_TARGET_URL` are unchanged.

The monitor sweep and the MCP server do not pass the flag. They honour the environment variable
only if the operator has set it for them.

### Host sandbox (`bin/lib/sandbox.mjs`)

Every manifest check declares an `egress` class: `none`, `registry`, `verifiers`, `github` or
`target`. All 82 checks in `manifests/security-baseline.json` declare one (measured: 38 `none`,
33 `registry`, 3 `verifiers`, 3 `github`, 5 `target`). A check with no class runs unconfined and
its row says so.

**macOS (`sandbox-exec`).** The profile is `(deny default)`, then:

- **Reads** are allowed only for the scanned tree, the lane's report directory, the commitwork
  checkout, the Node install prefix, `TMPDIR`, `/tmp`, system directories (`/usr`, `/bin`, `/sbin`,
  `/opt/homebrew`, `/System`, `/Library`, `/private/etc`, `/private/var/db`), `~/.gitconfig`,
  `~/.config/git`, each required tool's install prefix, symlink targets of the tree (unless they
  resolve into a forbidden path) and paths the check declares in `sandboxExtraReads`.
- **Writes** are allowed only for the report directory, `TMPDIR`, `/tmp` and `sandboxExtraWrites`.
- **Always denied, after every allow:** `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.docker`, `~/.kube`,
  `~/.netrc`, `~/Library/Keychains` and `/Library/Keychains`.
- **Network.** `egress: none` denies all networking. Every other class gets `(allow network*)`,
  minus outbound connections to IPv4 loopback (which on macOS also covers the host's own LAN
  address), all of IPv6 and every unix socket except the DNS resolver's. A `target` lane may
  additionally reach loopback on the ports named by `CW_TARGET_URL`, `CW_TLS_URL` and an http
  `CW_OPENAPI` (`targetLoopbackPorts`). The non-`none` classes are labels: none of them restricts
  which internet hosts a lane can reach.
- Process execution is allowed (`(allow process-exec*)`), so a confined lane can run any binary it
  can read.

**Linux (`bwrap`).** The whole filesystem is bind-mounted **read-only** (`--ro-bind / /`), `/tmp`
and `/run` are fresh tmpfs mounts, and the report directory and `TMPDIR` are bound writable. A
declared write is bound writable where it exists; one absent on the host is skipped and stays
read-only, so a tool that must create it fails and says so. bwrap marks every bind `nodev`, so
`/dev/null`, `/dev/zero`, `/dev/full`, `/dev/random` and `/dev/urandom` are re-bound with device
access and no other device is. The always-denied stores above are masked, and so are
`~/.config/gh`, `~/.config/gcloud`, `~/.azure`, `~/.git-credentials`, `~/.npmrc`, `~/.pypirc` and
`~/.cargo/credentials*` unless a lane declares them. `egress: none` adds `--unshare-net`. Every
other class gets its own network namespace, connected by pasta (package passt) through
`bin/lib/sandbox-net.mjs`: no gateway mapping, every port forward off, outbound traffic bound to the
default-route interface, DNS relayed, and for a `target` lane exactly the loopback ports its target
URLs name. Without pasta, or when pasta cannot configure the namespace, the lane is refused and
never runs on the host network. Internet destinations are not filtered (R8).

**When there is no sandbox.** If `sandbox-exec`/`bwrap` is missing or fails its probe (always the
case on Windows), or the operator sets `CW_SANDBOX=off`, every lane still runs, unconfined, and each
row records `isolation: none` (`bin/commitwork.mjs`, `hostSandboxFor`). For a lane that executes
repository code, `bin/lib/isolation.mjs` `applyIsolation` downgrades its coverage to `reduced`.
That is reporting, not prevention. A per-lane profile that fails its preflight refuses the lane
instead of running it. `CW_SANDBOX=require` turns the unconfined fallback into a refusal: every
host lane the sandbox cannot confine, including one that declares no egress class, records `noscan`
with the reason and never runs. The container image (`container/Dockerfile`) sets it.

### Container postures

Docker lanes take their flags from `bin/sandbox.mjs` → `buildSandbox`. Every posture adds
`--cap-drop ALL` and `no-new-privileges`, along with pids and memory limits. `buildSandbox` refuses
to mount the docker socket, `/`, `/etc`, `/dev`, `/proc`, `/sys` or any path containing a credential
segment. It refuses a writable source mount, and it refuses a source mount at all under `fetch` and
`resolve`. `build-resolve` refuses to emit flags without a filtering egress proxy and a private
network (`bin/egress-proxy.sh`, allowlist in `manifests/jvm-egress-allowlist.json`). The host wrapper
is not applied to the `docker run` client itself.

### Lane environment (`bin/lib/scanner-env.mjs`)

- **Lanes with `executesRepoCode: true`** get an allowlist (`REPO_CODE_KEYS`: `PATH`, `HOME`,
  locale, proxy and CA variables, toolchain homes, a fixed set of `CW_*`), plus only the secrets the
  check declares in `requires.secrets`. `GH_TOKEN`, cloud keys and npm tokens do not reach them.
- **All other lanes** get the full environment minus `CLAUDE_*`, `ANTHROPIC_*`, `VELD_*`,
  `SUBSTRATE_*`, `SPINE_*`, `MCP_*`, `CW_SANDBOX` and `COMMITWORK_TRUST_REPO_MANIFEST`.
- Declared secrets are resolved from the macOS keychain, or from a `file:` reference, by
  `lib/secrets.mjs` outside the sandbox and passed to the declaring command only. The on-disk table
  `~/.commitwork/secrets.json` holds references, not values.
- A gh session token is resolved outside the sandbox and injected as `GH_TOKEN` only for a lane
  that declares `~/.config/gh` and does not execute repository code (`laneCredentialEnv`), never in
  CI and never over a token the operator already set.

### git against a scanned tree (`bin/lib/git-env.mjs`)

`scannedGit` runs git with `core.fsmonitor=false`, `core.hooksPath=/dev/null`,
`protocol.ext.allow=never`, `submodule.recurse=false`, auto-gc and auto-maintenance off,
`GIT_CONFIG_NOSYSTEM=1` and the repository-local `GIT_*` variables stripped. git has no switch
that turns drivers off, so before each call it reads the tree's config (`git config --show-scope
--null --list`, which executes nothing) and overrides, by name, every command the local or worktree scope
sets: filter `clean`/`smudge`/`process` (emptied, `required=false`), diff `textconv` (`cat`, which
is `--no-textconv`'s output) and `command`, `diff.external`, merge drivers, `core.sshCommand`,
`core.askPass`, `core.gitProxy`, credential helpers, the `gpg.*` programs and
`log.showSignature`; a remote `uploadpack`/`receivepack` refuses the local transport, because a
later `-c` cannot replace it. The operator's global config is left alone. A config git cannot read
refuses the call. `status` and the diff family get `--ignore-submodules=dirty`, because recursion
runs git inside the submodule, where its own drivers are not overridden; inner submodule changes
are therefore not reported. `scannedGitEnv` carries the same overrides in `GIT_CONFIG_COUNT` for
tools that spawn their own git (gitleaks). `bin/test/git-env.test.mjs` arms `core.fsmonitor`, hooks,
the filters, `textconv`, `diff.external`, `core.sshCommand`, `core.gitProxy`, a remote `uploadpack`,
the `ext::` transport, a credential helper and `gpg.program` with a marker command, with plain git as
the control, and runs status, ls-files, diff, log, show, blame, archive, merge --ff-only, ls-remote
and credential fill;
`bin/test/scanned-git-census.test.mjs` fails on a raw host git in a file not listed as reading
commitwork's own repositories.

### Build-executing lanes are contained on `run`

`sast-codeql-swift` (autobuild), `sast-codeql-go` (CodeQL's `go-extractor` loads every package; the containment text still says `go build`) and `lint-rust-clippy`
(`cargo clippy` runs `build.rs` and proc macros) carry a `containment` block. They are absent from
group `all`, and `commitwork run all` records them as a `noscan` void where they would have applied
(`containedVoids`, keyed on the command by `buildsScannedTree`). `bin/test/build-mode-containment.test.mjs`
holds the declaration against the command in both directions.

### Agent-facing controls

- **MCP run tools** (`mcp/server.mjs`). `run_checks` and `run_checks_start` validate the repository
  path (`repoForRun`). It must be absolute and the top of a git work tree. It must not be `/`, the
  home directory, or under `~/.ssh`, `~/.gnupg`, `~/.aws` or `~/.config`. The manifest must be
  bundled and the group must exist in it. The runner is spawned with harness variables stripped
  (`scannerEnv`). A run is bounded at 10 minutes, and jobs run one at a time with a queue of 8
  (`mcp/jobs.mjs`). A gate reads `PASS` only when checks ran and none failed.
- **Untrusted text** (`lib/untrusted-text.mjs`). MCP resources (raw report files) are wrapped in an
  envelope whose delimiter is derived from the content, so the payload cannot close it. Tool results
  are JSON-encoded. Both carry a descriptive `injectionSignals` field, which never filters content
  and is never a severity.
- **The one `claude` builder** (`lib/claude-spawn.mjs`). Every `claude` that commitwork starts is
  built by `claudeSpawnPlan`/`claudeArgs`. Setting sources are limited to `''` or `user`, so a
  scanned repo's project and local settings, hooks and permissions never load. The MCP config is
  explicitly empty under `--strict-mcp-config`. The tool list is explicit, and caller-supplied flags
  that would widen any of this are refused. The environment is `llmEnv`: the denylist above plus
  `ANTHROPIC_API_KEY` only. Profiles that do not edit a repository run in a fresh scratch directory.

## Per command

"Repo code" means code authored in the scanned tree or its dependencies.

### `commitwork run <group|check>` (`bin/commitwork.mjs`, `cmdRun`)

- **Executes.** Each selected check's `local` shell lines, under `sh -c`, wrapped by the host
  sandbox or by `docker run` with a declared posture. With the bundled `security-baseline` and group
  `all`, three lanes execute repo code (`authz-test` only with consent):
  - `authz-test` runs the tree's own `security/authz-isolation-test.sh` when it exists, with
    `egress: target`, and only with `--trust-repo-manifest`. Without the flag it records `noscan`.
  - `sast-php-psalm` loads the tree's `vendor/autoload.php` in full mode, with `egress: none`.
  - `deps-reachability` runs the tree's package managers through cdxgen, inside a `--network none`
    container (`bin/depscan-scan.sh`).

  Lanes that fetch and run a pinned tool include `npx --yes retire@5.4.3`,
  `npx --yes @cyclonedx/cyclonedx-npm@6.0.1`, the semgrep and CodeQL packs, and the docker images
  for osv-scanner, GuardDog, Renovate and dep-scan. `deep` adds the three contained build lanes.
  Not determined: whether CodeQL's NuGet restore in `sast-codeql-csharp` (`--build-mode=none`) runs
  repository MSBuild logic, and whether golangci-lint, `deno lint` or `cargo fmt` in the default lanes
  can be made to load repository plugins or aliases.
  `--act` runs the tree's GitHub workflow through nektos/act, but only when the manifest's check has
  an `act` block; no bundled manifest has one.
- **Reads.** The tree (including `.env`, for key *names* only, in `readEnvKeys`), the manifest,
  `openapi.{yaml,json,yml}` in the tree root, the operator's scan configuration and depth settings,
  keychain secrets a check declares, and the gh token for the three `github` lanes.
- **Reaches.**
  - `registry` lanes reach package registries, advisory APIs and rule packs. Hosts named in code
    include api.osv.dev, api.deps.dev, vuln.go.dev, registry.npmjs.org, socket.dev, the semgrep
    registry and ghcr.io. Hosts that trivy, CodeQL, bundler-audit and cargo-audit contact are tool
    defaults and are not determined here.
  - `verifiers` lanes send candidate credentials found in the tree to the services that issued them
    (TruffleHog `--results=verified,unknown`).
  - `github` lanes call the GitHub API for the tree's `origin`.
  - `target` lanes (nuclei, BOLA probe, TLS and headers, schemathesis) send traffic to
    `--url`/`CW_TARGET_URL`, and skip as a void without one.

### `commitwork scan` and `commitwork brief` (`cmdScan`, `cmdBrief`)

The same lanes as `run`, over every repository discovered under `--root`. `brief --pc` covers every
repository under the home directory, minus credential stores and this checkout, after a `[y/N]`
prompt on a terminal. Differences that matter:

- **Every check in the manifest runs, groups aside.** `cmdScan` iterates `manifest.checks`. It
  applies neither `containedVoids` nor `depthGate` nor `gateChecks`. The three build-executing
  lanes that `run all` contains therefore run on `scan` and `brief` (see R2).
- **The live target comes from the operator unless they consent otherwise.** `resolveRepoUrl`
  takes the URL from a `--urls` map first. Next comes a `commitwork.url` file **inside the scanned
  repository**, read only with `--trust-repo-manifest` and otherwise ignored with one stderr line.
  Then come `--url` and `CW_TARGET_URL`. That URL feeds the `target` lanes and the loopback port
  exception (see R3).
- Output goes to `reports/<stamp>/` inside the commitwork checkout, or the sidecar for `brief`.

### `commitwork doctor` and `commitwork list`

`doctor` resolves and probes every tool the manifest requires, checks the docker daemon and the
POSIX shell, and prints the result. It executes nothing from the scanned tree. `list` prints checks.
Both parse a repo-local manifest without executing it.

### Monitor sweep (`monitor/sweep.mjs`)

The sweep spawns `bin/commitwork.mjs run <group> --manifest <name> --repo <path>` per registered
repository, so everything under `run` applies. The manifest names and live URLs come from the
operator's registry (resolved by `monitor/store-paths.mjs` into the private sidecar), not from the tree. The child receives the
sweep's full environment, and `laneEnv` then narrows it per lane. The sweep's own git calls use
`scannedGit`. Optional external steps (`preflight-build.mjs`, `bin/jvm-resolve.sh`,
`bin/boot-harness.sh`, `bin/lockfile-synth.sh`) are run by hand, not by the sweep.

### MCP `run_checks` and `run_checks_start` (`mcp/server.mjs`, `mcp/jobs.mjs`)

These spawn `bin/commitwork.mjs run <group> --manifest <bundled> --repo <path>`, so everything
under `run` applies. The caller chooses any group the bundled manifest defines, including `deep`
(the contained build lanes). The `hermetic-tests` manifest runs `cargo test` on the host under the
sandbox. The `build-health` manifest's `toolchain` lane runs the tree's own build and tests (`npm ci`,
`npm test`, `./gradlew clean build`, `mvn clean verify`, `pip install -e .`, `cargo build`, `make`
and others) in a container (see R13). The repository may be any git work tree that
passes `repoForRun`; there is no allowlist of roots. A source comment in `repoForRun` records that
the roots allowlist and a repo-code opt-in are waiting on an operator ruling.

### Pre-commit hook (`bin/hook.mjs`, `commitwork hook install|run`)

- **Executes.** `git` against the repository (inheriting the environment on purpose, so that
  `GIT_INDEX_FILE` is honoured) and, with `--lanes gitleaks`, the `gitleaks` binary (or
  `CW_GITLEAKS`). The `secrets` lane is in-process (`bin/secrets-sweep.mjs`, `scanBuffer`).
- **Reads.** Staged blobs from the index, and with `--block-existing`, HEAD.
- **Reaches.** Nothing; neither lane makes a network call.
- **Does not apply.** A repo-local `commitwork.json` (never read here), the host sandbox, or the
  lane environment rules.
- `install` writes into the hooks directory git reports, which honours `core.hooksPath`. It refuses
  to overwrite a hook it did not write unless `--chain` is given.

### Other tools that act on a target

| Tool | Executes / reaches | Gate |
| --- | --- | --- |
| `bin/bola-run.mjs`, `bin/idor-run.mjs`, `bin/mass-assign-run.mjs` | Mint credentials by recipe (static bearer, API key, Keycloak or Supabase token POST, login POST) and send requests to a live base URL. `bola-run` POSTs seed objects, and `mass-assign-run` creates objects that may carry escalated fields. They resolve any env name the manifest references through `lib/secrets.mjs` | Bundled or private manifests run. A repo-local one needs `--trust-repo-manifest`. `monitor/bola-sweep.mjs` also checks readiness |
| `bin/boot-harness.sh` | Builds and boots the tree's application in a `boot` posture container with open egress on a dedicated bridge network | Manual |
| `bin/jvm-resolve.sh` | Runs `gradle`/`mvn` dependency resolution (repo build logic) in `build-resolve`, behind the squid allowlist proxy | Manual |
| `bin/lockfile-synth.sh` | Resolves a copied manifest against a registry in `resolve` (source not mounted). npm uses `--ignore-scripts`. Python retries permissively, running third-party sdist build backends, and records `buildBackendsExecuted` | `monitor/preflight-build.mjs --apply` |
| `monitor/preflight-build.mjs --apply` | `go mod download` on the host, unconfined. For Gradle, `./gradlew dependencies --write-locks` on the host, unconfined, which executes repo code | Refuses third-party areas. Gradle on the host additionally needs `CW_PREFLIGHT_ALLOW_HOST_EXEC=1` |
| `bin/races.mjs` | The module's own `node_modules/.bin/eslint` (or `npx eslint@10.8.1`) with its JS config, and with `--deep`, `infer … -- ./gradlew compileJava`. Both run on the host, unconfined, with the full environment (see R14) | Manual, no opt-in |
| `monitor/renovate-dryrun.mjs` | `npx renovate` on the host in the checkout, unconfined | Manual |
| `bin/issue-loop.mjs --apply` | Starts `claude -p` in the scanned repository (`PROFILES.issueLoop`: default tools, the operator's user settings) on a handoff that quotes finding text | Manual; dry run by default |
| `bin/finding-analysis.mjs`, `bin/daily-run.mjs`, `admin/routes/codeql-remediation.mjs` | `claude` in a scratch directory with no tools or read-only tools | Panel or manual |
| `admin/routes/scan-path.mjs` | Panel-triggered `brief` over a path or the whole PC | Operator port only. The published port answers 403 |

## Residual risks

Severity is for an operator who scans repositories they do not own on a macOS host with the
sandbox available, unless the row says otherwise. Every row was derived from reading code; none
was exercised as an attack for this document.

| # | Risk | Where | Severity |
| --- | --- | --- | --- |
| R1 | **With consent, the default group executes repository code with network egress and read access to other repositories' reports.** `authz-test` is in group `all` and runs any `security/authz-isolation-test.sh` the tree ships, with `egress: target` (open internet on macOS). The macOS read set includes the whole commitwork checkout, and `reports/` lives inside it by default (`monitor/area.mjs`, `reportsRootDir`). That directory holds every other scanned repository's output, including `trufflehog.json`, which the `secrets` lane writes with TruffleHog's `--json` and no redaction step in the lane command. The same read set covers any other git-ignored file kept inside the checkout. The live operator stores behind the `monitor/private` and `evaluations` symlinks are not readable on macOS, because seatbelt judges a link's target and those targets are outside the read set. A hostile tree therefore gets a path to the fleet's discovered secrets plus egress to send them. Whether every report family carries raw secret values was not determined. **Control (2026-10-07):** `authz-test` declares `requiresRepoTrust` and runs only with `--trust-repo-manifest` or `COMMITWORK_TRUST_REPO_MANIFEST=1`. Without consent, `run all`, the sweep, `scan`, `brief` and MCP record it as `noscan` and never execute the script. With consent, the exposure above stands unchanged. | `manifests/security-baseline.json` (`authz-test`, `secrets`), `bin/lib/sandbox.mjs` (`readable` includes `cwRoot`), `bin/commitwork.mjs` (`hostSandboxFor`, `untrustedScriptVoid`) | **High** with consent; closed by default |
| R2 | **`scan` and `brief` run the lanes that `run` contains.** `cmdScan` iterates every check and skips containment, depth and the scan-configuration gate. `sast-codeql-swift` (autobuild, `registry` egress), `sast-codeql-go` (package loading through `bin/codeql-go-build.mjs`; whether cgo processing runs was not determined; `registry` egress) and `lint-rust-clippy` (`build.rs` and proc macros, `none`) therefore compile untrusted trees, including under `brief --pc`. They stay inside the host sandbox with the allowlisted environment. The containment's own stated reason ("arbitrary code execution on the host") is honoured on one path only. | `bin/commitwork.mjs` (`cmdScan` loop, compare `cmdRun`) | **High** |
| R3 | **A scanned tree chooses its own DAST target.** With `--trust-repo-manifest`, `scan` reads `commitwork.url` from the tree. nuclei, the BOLA probe, the TLS and headers scan and schemathesis then send traffic to any host the file names, from the operator's network position. A loopback URL also opens that loopback port to the `target` lanes, including `authz-test` (repo code), which defeats the loopback denial for one chosen port: for example the panel's operator port, or a local runner. **Control (2026-10-07):** without consent `resolveRepoUrl` ignores the file and says so on stderr, so only the operator's `--urls`, `--url` or `CW_TARGET_URL` chooses the target. | `bin/commitwork.mjs` (`resolveRepoUrl`, `hostSandboxFor` with `targetLoopbackPorts`) | **High** with consent; closed by default |
| R4 | **Linux confinement is much weaker than macOS.** `bwrap` binds `/` read-only, so a confined lane can read the whole home directory except the masked stores. That includes other repositories, `~/.commitwork/` and any file a `file:` secret reference points at, shell history and browser profiles. Non-`none` lanes have their own network namespace (see the Linux paragraph above), so host loopback and `/run` sockets are out of reach, but internet and LAN destinations are not filtered. Combined with R1 and R2, this widens what repository code can read. | `bin/lib/sandbox.mjs` (Linux branch) | **High** on Linux |
| R5 | **With no sandbox, lanes run unconfined rather than refusing.** On Windows, on Linux without `bwrap`, or with `CW_SANDBOX=off`, every lane, including R1's and R2's, runs with the operator's full filesystem and network. The row records `isolation: none`, but the code has already run. **Control (2026-10-08):** `CW_SANDBOX=require` refuses those lanes as `noscan` instead; the container image sets it, and the default elsewhere is unchanged. | `bin/commitwork.mjs` (`hostSandboxFor`) | **High** where it applies; closed under `CW_SANDBOX=require` |
| R6 | **npx lanes run in the scanned tree with the full environment.** `deps-retire` and `sbom` run `npx --yes <pinned package>` with the tree as working directory. By npm's documented config resolution, a project `.npmrc` (inside a tree with `package.json`) can redirect the registry, so the package npx downloads and executes would be attacker-supplied. These lanes are not marked `executesRepoCode`, so they get the denylist environment, which still carries `GH_TOKEN`, `AWS_*` and `NPM_TOKEN`, and `registry` egress. `supply-chain-socket` pins `npm_config_registry`; these two lanes do not. This is inferred from npm's behaviour and not exercised. Whether a warm npx cache skips the registry was not determined. | `manifests/security-baseline.json` (`deps-retire`, `sbom`), `bin/lib/scanner-env.mjs` (`laneEnv`) | **High** |
| R7 | **MCP can start repository-executing runs against any work tree.** Any MCP client can select `deep`, `build-health` or `hermetic-tests` and point them at any git work tree outside the excluded directories. A prompt-injected agent is such a client. | `mcp/server.mjs` (`repoForRun`, `prepareRun`) | Medium |
| R8 | **Egress classes do not restrict destinations.** `registry`, `verifiers`, `github` and `target` all compile to `(allow network*)` minus local destinations. A lane declared as reaching only a registry can reach any internet host. Only `build-resolve` containers have a host allowlist. | `bin/lib/sandbox.mjs` | Medium |
| R9 | **Analyser lanes see operator tokens.** Lanes not marked `executesRepoCode` get the full environment minus harness prefixes. If one of those tools is coerced by the tree (R6 is one route), the tokens are in reach. | `bin/lib/scanner-env.mjs` | Medium |
| R10 | **Prompt injection into agents.** Fencing and JSON encoding are structural, but a model may still follow an instruction inside a finding. `issue-loop --apply` runs an editing agent with default tools in the scanned repository, unsandboxed by `bin/lib/sandbox.mjs`, bounded only by the operator's user-level `claude` permissions. | `lib/untrusted-text.mjs`, `lib/claude-spawn.mjs` (`issueLoop`), `bin/issue-loop.mjs` | Medium |
| R11 | **Verifier lanes contact third parties with credentials found in the tree.** This is a deliberate trade, so that a live key is told apart from a dead one, but it is network traffic the tree's author can trigger. | `secrets*` lanes, `monitor/secret-verify.mjs` | Low |
| R12 | **The PHP and dep-scan lanes execute repository code by design.** `sast-php-psalm` loads the tree's autoloader with network denied. `deps-reachability` runs package managers with the network severed in the scan container. Both are in `all`. Exposure is local reads within the sandbox (R1, R4). | `manifests/security-baseline.json`, `bin/depscan-scan.sh` | Low on macOS, Medium on Linux |
| R13 | **`build-health`'s container lane runs repository builds without a declared posture.** `bin/build-health.mjs` calls `docker run --rm -v <repo>:/src:ro` directly. This means the default bridge network (open egress), root in the container, default capabilities, no pids or memory limit, plus anything in `BH_DOCKER_ARGS`. Inside, it runs `npm ci`, `./gradlew clean build`, `mvn clean verify`, `pip install -e .`, `cargo build`, `make` and the tree's tests. The source is mounted read-only and no host credential is mounted. This is the hand-rolled isolation `bin/lib/sandbox.mjs` was written to replace. The manifest is reached by registry projects that list it and by MCP. | `bin/build-health.mjs`, `manifests/build-health.json` | Medium |
| R14 | **Manual tools that execute repository code unconfined.** `bin/races.mjs` runs the module's own `node_modules/.bin/eslint` and its JS config (and `./gradlew` under `--deep`) on the host with no sandbox and no opt-in. `monitor/renovate-dryrun.mjs` runs `npx` in the checkout. Both are intended for repositories the operator owns, but nothing enforces that. | `bin/races.mjs`, `monitor/renovate-dryrun.mjs` | Medium |
| R15 | **Executable git config that `scannedGit` does not cover.** A repository-set merge driver is overridden but no host call makes a non-fast-forward merge. `core.alternateRefsCommand`, `core.askPass`, a diff driver's `command`, `core.editor`, `sequence.editor` and the `gpg.*` programs other than `gpg.program` are overridden without a measured fixture. `bin/hook.mjs` runs as a repository's own pre-commit hook with plain git, inside a commit git is already making there. Third-party tools other than gitleaks that spawn git inherit no overrides. | `bin/lib/git-env.mjs`, `bin/test/scanned-git-census.test.mjs` | Low |

## Not defended

- **Compromised scanners, images or pinned packages.** A tool's binary, container image or npm
  package is trusted once installed or pulled. Several images are referenced by mutable tag
  (`:latest` for osv-scanner and Renovate).
- **Resource exhaustion on the host side.** Lanes have wall-clock timeouts (`checkTimeoutSec`,
  default 1800 s) and containers have pids and memory limits. Host-sandboxed lanes have no memory,
  disk or process-count bound.
- **Writes to `/tmp`.** Every host lane can write `/tmp`, and on macOS can read it, so lanes and
  concurrent runs can see each other's temporary files.
- **What a `target` lane does to the target.** Nuclei, schemathesis and the BOLA runners send real
  requests. `bola-run` and `mass-assign-run` create objects. Choosing a target the operator is
  authorised to test is a human responsibility (and see R3).
- **Network-position abuse beyond loopback on Linux** (R4), and LAN hosts other than the host's own
  address on macOS.
- **An operator who passes `--trust-repo-manifest`, `CW_SANDBOX=off` or
  `CW_DEPSCAN_ALLOW_NET=1`.** These are explicit opt-outs; commitwork prints them, and then honours
  them.
- **The `--act` path.** Not sandboxed by `bin/lib/sandbox.mjs`. Whether `act` mounts the docker
  socket into job containers is an `act` default that commitwork does not configure, and was not
  determined.
- **Semantic prompt injection.** Detection is descriptive only, by design. No mechanism prevents a
  model from acting on text it was told is data.
