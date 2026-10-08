<!-- verified-against: 2026-10-08 -->
# commitwork

**Repository security scanner, local CI runner and scheduled monitor, with remediation and
compliance-evidence tooling.**

commitwork runs 82 checks over a repository (secrets, SAST, dependencies, supply chain, IaC and
CI, runtime probes, posture, code quality), keeps running them across a fleet of repositories on a
schedule, and turns the results into rollups, an issue tracker, remediation plans and EU CRA /
SOC 2 evidence. It started as a way to run a repo's GitHub Actions CI locally without spending
Actions minutes, and that runner is still the core of it. A scheduled fleet monitor, a web panel,
an MCP server and a set of viewers sit on top.

Zero runtime dependencies. Runs on macOS, Linux and Windows. `package.json` declares Node ≥ 22.18
(22 is the oldest Node.js line still maintained) and the CLI refuses an older runtime; CI runs
Node 22 and 24 on all three platforms. Docker is optional: without it the four container lanes
record `noscan` naming the missing tool (n/a when the daemon is installed but stopped), never a
pass.

> **Licence:** AGPL-3.0-or-later, or PolyForm Internal Use 1.0.0 by written agreement, with the wire
> layer also under Apache-2.0; see [Licensing](#licensing). **No warranty is implied or given.**
> commitwork's runtime lanes probe live targets: point them only at systems you own or are
> authorised to test.

---

## What it does

- **Runs checks.** `bin/commitwork.mjs` runs a manifest of checks against one repository or every
  git repository under a root. Each check wraps a third-party scanner or a bundled one and writes a
  normalised report. Section 2 lists the baseline.
- **Monitors a fleet.** `monitor/sweep.mjs` runs on a schedule over declared areas, rolls each
  sweep into a historical slice, tracks each finding from first sighting to verified remediation,
  and files issues with SLA clocks.
- **Serves a panel.** `admin/serve.mjs` is a loopback-only web panel over that evidence, with its
  own authentication, reached from outside only through a declared tunnel.
- **Drafts remediation.** Per-check triage prompts, agent hand-offs, declare-only hardeners that emit
  a `git apply`-able diff, and an issue loop that is dry-run by default. Applying a fix stays a
  human act.
- **Produces compliance evidence.** `cra/` maps the same evidence onto EU CRA Art. 14 cases,
  CycloneDX SBOM and VEX, POA&M, SOC 2 and OSCAL, all as drafts.

### Scanner output is checked, not relayed

Measured in August 2026 on the fleet commitwork monitors, against the scanners it orchestrates:

- TruffleHog's Lob detector produced **1,311 of a fleet's 1,314 published CRITICALs**, all false,
  from one upstream defect.
- Prowler asserted **1,067 FAILs**, 11.5% of all cloud-posture findings, about a GitHub field that
  was never returned to the credential that ran.
- GuardDog's `capability-*` rules published **602 of 675 rows** at medium for "this package can open
  a socket", true of almost every package.
- dep-scan's default `in_triage` was read as REACHABLE for 100 of 105 findings whose true proof
  count was zero.

In each case a descriptive or unreadable signal was being published as a verdict. The signature
that catches the class is a lane that fails a control on ~100% of repos, or one detector that
accounts for most of a severity bucket. Such rows go to an `undetermined` field outside
crit/high/med/low with the original claim preserved, and a defective detector is retired with one
instrument-scoped `incorrect-scan-result` annotation that names the defect, rather than one
suppression per file.

The engineering invariants are listed in [CLAUDE.md](CLAUDE.md#house-invariants) and held up by tests: **fail
closed** (a parse failure is never an empty result; only `ENOENT` means "legitimately absent"),
**determinism** (same inputs ⇒ byte-identical outputs, atomic writes, idempotent re-runs), **never
key a finding's identity on a line number** (code moves for reasons that have nothing to do with the
finding), and **declaration split from authority** (tools that describe deployments never hold
credentials or apply changes).

## Scope

- **Lanes:** 82 checks, 76 in `all`. Four need a live URL; `authz-test` needs `--trust-repo-manifest`.
- **Platforms:** Node >= 22.18. macOS has the `sandbox-exec` sandbox and launchd scheduling. Linux
  has a weaker `bwrap` sandbox, uses cron or systemd timers, and installs with `bin/install.sh` or
  the `container/Dockerfile` image. Windows has no host sandbox, and
  its CI does not run the full suite.
- **Refuses:** repo-local manifests and repo-supplied scripts without consent, non-bundled
  manifests over MCP, unreadable stores.
- **Not measured, not done:** 63 of 74 lanes have no scan-canary record, four high residual risks
  are open; it does not change scanned repos on its own authority or hold deploy credentials.

[docs/SCOPE.md](docs/SCOPE.md) gives the counts, their sources, and what is still unknown.

---

## Quick start

```sh
node bin/commitwork.mjs init --root ~/Repositories              # private store dir + fleet registry
node bin/commitwork.mjs setup                                    # install missing scanners
node bin/commitwork.mjs doctor   --manifest security-baseline    # what tooling is available?
node bin/commitwork.mjs list     --manifest security-baseline    # checks + readiness
node bin/commitwork.mjs run fast --manifest security-baseline    # the fast pre-commit set
node bin/commitwork.mjs run all  --manifest security-baseline    # everything that's ready
```

Scan every git repo under a root, not just one. `scan` installs nothing; run `setup` first for the
scanners you want:

```sh
node bin/commitwork.mjs scan --root ~/Repositories --out reports/my-scan
```

Rank what to fix. `brief` runs the same scan over a repository, a directory of them, or every
repository under your home directory (`--pc`), then writes `brief.html`, `brief.md` and
`brief.json`: dependency upgrades with KEV advisories first, the other open findings, and every lane
that did not measure. The output names local paths, so it goes to `--out`, `CW_SCAN_PATH_OUT` or
the private sidecar, never into this checkout:

```sh
node bin/commitwork.mjs brief ~/Repositories/acme --out ~/scans/acme
node bin/commitwork.mjs brief --pc --out ~/scans/this-machine
```

Put `commitwork` on your PATH (works the same on macOS, Linux and Windows — npm generates the
right shim for your platform):

```sh
npm link
```

(Unix alternative, if you'd rather not use npm link: `ln -s "$PWD/bin/commitwork.mjs" /usr/local/bin/commitwork`.)

`--dry-run` prints every command without executing it. Use it before trusting anything.

### Windows

The commands above run from **Windows Terminal / PowerShell**. What CI checks on Windows is the
platform contract described at the end of this section, not the full test suite. One prerequisite
is doing real work, so it is stated rather than assumed:

**Git for Windows** — which you almost certainly already have, since commitwork requires `git`
regardless. Every check in `security-baseline.json` is a POSIX shell one-liner (all 82 of them use
`$VAR`, redirection or `$?`), so a POSIX shell is genuinely required. commitwork finds the
`bash.exe` **inside your Git installation** rather than needing it on PATH, so a normal
`winget install -e --id Git.Git` is sufficient and nothing else is needed:

```powershell
node bin/commitwork.mjs doctor --manifest security-baseline   # reports the shell it resolved
```

If no shell resolves, checks report **noscan with the reason** — never a failure, and never a pass.
Set `CW_POSIX_SHELL` to a `bash.exe` path to override the search.

**WSL is deliberately not used**, even when present: it resolves `C:\x` as `/mnt/c/x`, so reports
would be written inside the WSL namespace where the caller cannot read them.

**GNU findutils, `lsof` and `ps` are not needed.** Repo discovery walks in Node, and the
listening-port lens uses `netstat`/`tasklist`, both of which ship with Windows.

Scanner coverage is thinner on Windows than on macOS: of the 56 tools in
[`manifests/install-catalog.json`](manifests/install-catalog.json), some are installable only
through `pipx`, `gem` or `composer`. `commitwork setup` distinguishes *"this needs a package manager
you do not have"* (and names it) from *"nobody has written an installer for this"*.

The **Windows portability** job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on
`windows-latest`: every module must parse, the platform-contract suites (shell resolution, the Node
repo walk, process-tree kill, batch-shim spawning, path hazards, the listener lens, the installer's
manager shapes) must pass, the `bin/` and `lib/` suites must leave the working tree clean, and
`doctor` must resolve a POSIX shell from the runner's Git. The full suite does not run on Windows in
CI yet.

### The admin panel

```sh
node admin/serve.mjs
```

Starts the web panel on two loopback-only ports — a published one (default `7878`, `CW_ADMIN_PORT`
or the first argument) and an operator one (default one higher, `CW_ADMIN_LOCAL_PORT`). On first
launch, with no operator account yet, it prints the operator URL to create one at; from there the
published port is your normal login. The **Scanning** section of the Config page (`/config`) turns
lanes on and off and records which scanner binaries this box may execute, written to
`.claude/store/scan-config.json` and journalled. The panel never runs a scanner from there: approval
is consent, and a lane held for an unapproved binary reports `noscan` rather than dropping out. The
gate stays off until that store exists.

---

# The feature set

## 1. Local CI runner — `bin/commitwork.mjs`

GitHub Actions workflows only execute inside their own repo on GitHub's runners. commitwork gives
you a local equivalent: a per-repo **manifest** maps each workflow to the local command(s) that
perform the same checks, and deliberately drops the parts that only make sense on GitHub (SARIF
upload to the Security tab, PR comments, artifact retention, cloud uploads).

Checks run as plain local commands. On macOS and Linux each runs under the host sandbox
(`sandbox-exec` / `bwrap`) according to the egress class it declares, and the four docker lanes use
their container posture instead — see [bin/README.md](bin/README.md#isolation--egress-classes-and-the-host-sandbox).
A manifest may also give a check an `act` block, which `--act` runs through
[`act`](https://github.com/nektos/act) against the target repo's own workflow YAML; no check in the
bundled manifests defines one.

| Command | What it does |
|---|---|
| `init [--root <dir>] [--repo <path>] [--private-dir <dir>]` | First-run state for a fresh clone: the private store directory, a fleet registry naming only what you declare, and the credential-store directory. Refuses rather than overwrite existing state. |
| `list` | Every check, whether it's `ready` or `blocked` (and why), and the groups. |
| `run <check\|group\|all>` | Runs one check, a named group, or everything. A check whose requirements aren't met is not run: a missing tool is recorded as `noscan`, a check that does not apply to the repository as n/a. |
| `scan --root <dir>` | Runs the baseline across every git repo under one or more roots. Installs nothing. |
| `brief [dir] [--pc]` | Scans a repository, a directory of them, or every repository under the home directory, then ranks the fixes: dependency upgrades KEV-first, other open findings, lanes that did not measure. `--from <run dir>` rebuilds the brief for a finished scan or scheduled-sweep batch without re-running it. `--tui` browses the result in the terminal instead of printing it. |
| `sarif [--from <run dir>] [--out <file>]` | Exports a finished `run`, `scan` or sweep batch as SARIF 2.1.0, one log per repository. Only a measured finding with a severity becomes a result; a lane that did not measure is a tool execution notification, and an undetermined row goes to the run's properties with its original claim. |
| `scan-images` | CVE-scans local container images via Trivy (OS packages + language deps). |
| `reindex --out <dir>` | Regenerates `index.md` + summaries from existing report files — no re-run. |
| `doctor` | Tool/service availability (node, npm, docker, act, semgrep, …) with a per-tool install hint. |
| `setup [--yes] [--only a,b]` | Cross-platform scanner installer driven by [`manifests/install-catalog.json`](manifests/install-catalog.json): brew, winget or scoop per platform, then pipx, npm, cargo, go, gem or composer where a tool needs them. On Linux it uses Homebrew when `brew` is on PATH and otherwise the language managers; apt or dnf comes last and installs only those managers (pipx, go, cargo, Ruby's gem, composer) and bubblewrap, never a scanner, because distribution versions trail by years. gitleaks and trufflehog, which no Linux manager besides Homebrew carries, install from their upstream release tarball: the tag and each architecture's SHA-256 are pinned in the catalogue, a mismatch is refused, and only the tool's binary is copied, to `~/.local/bin`. apt and dnf run as root or through passwordless `sudo -n`; otherwise setup prints the one `sudo apt-get install …` line that would supply the missing managers, and a second `setup --yes` then installs the scanners they unlock. The CI `installer` job installs a scanner through pipx on Ubuntu on every push and pull request that changes more than prose. Offered once on first interactive launch (stamped in `~/.commitwork/setup.json`); never prompts in non-TTY runs (launchd/CI) or under `CW_SKIP_SETUP=1`. |
| `help` | Usage. |

<details>
<summary><strong>Options</strong></summary>

| Flag | Meaning |
|---|---|
| `--manifest <path\|name>` | Manifest file path, or a bundled name under `manifests/`. |
| `--repo <path>` | Target repo path; overrides `manifest.repoPath`. |
| `--root <dir>` | (`scan`) Root to discover git repos under; repeatable. |
| `--skip <name>` | (`scan`/`scan-images`) Name substring to exclude; repeatable. |
| `--filter <substr>` | (`scan-images`) Only images whose ref contains the substring; repeatable. |
| `--out <dir>` | (`scan`/`reindex`) Report output dir (default `reports/<timestamp>`). (`brief`) The run directory (default `<CW_SCAN_PATH_OUT or sidecar>/brief-<timestamp>`). |
| `--pc` | (`brief`) Every repository under the home directory, each scanned on its own; credential stores, the checkout and the output directory are excluded, and a directory holding 100 or more repositories is set aside unless `--include-collections`. |
| `--url <baseURL>` / `--urls <file>` | (`scan`) Live base URL for runtime scanners — one target, or a JSON map slug\|basename → baseURL for a fleet. `$CW_TARGET_URL` is also honoured, and a per-repo `commitwork.url` file only with `--trust-repo-manifest`. |
| `--act` | For checks that define an `act` block, run the real workflow via `act`. |
| `--strict` | Treat unmet requirements as a failure instead of a skip. |
| `--dry-run` | Print each check's commands without executing anything. |
| `--trust-repo-manifest` | Execute commands from a repo-local `commitwork.json`, run lanes that execute a script the scanned repo supplies (`requiresRepoTrust`, e.g. `authz-test`; without the flag they record `noscan`), and honour a repo's `commitwork.url`. **Untrusted by default** — running commitwork inside a hostile checkout must not be an RCE. (`COMMITWORK_TRUST_REPO_MANIFEST=1` also works.) |
| `--no-fail-fast` | Keep going after a failing check. |
| `--verbose` | Print the GitHub-only steps each check deliberately drops. |

Env: `COMMITWORK_MANIFEST`, `COMMITWORK_REPO` mirror `--manifest` / `--repo`. Every input path is
env-overridable (`CW_*`) so the test suite runs entirely on fixtures.
</details>

### Adding a repo

1. Write `manifests/<repo>.json` against [`schema/manifest.schema.json`](schema/manifest.schema.json):
   each check maps a workflow to its `local` command(s), declares `requires` (tools/secrets/docker)
   and an `egress` class, tags `groups`, and documents `skipsOnGitHub`.
2. `commitwork list --manifest <repo>` to verify readiness.

Or drop a `commitwork.json` at the root of the target repo. Repo-local manifests are structurally
validated on every load and refuse to run until you inspect (`--dry-run`) and opt in
(`--trust-repo-manifest`). For the **monitor**, repos usually don't need registering at all — see
below.

### On GitHub's runners: the GitHub Action

[`action.yml`](action.yml) is a composite action. It runs `commitwork run <checks>` with the
bundled security baseline over a checkout, exports the run with `commitwork sarif`, and uploads the
SARIF to code scanning.

```yaml
jobs:
  baseline:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write  # the SARIF upload
      actions: read           # the SARIF upload, in a private repository only
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: Portll/commitwork@v0.5.0
        with:
          install-tools: 'true'
```

In a workflow that pins its actions to commit SHAs, pin `Portll/commitwork` to the release's SHA.

| Input | Default | Meaning |
|---|---|---|
| `checks` | `fast` | A check id or group of the security baseline, as `commitwork run` takes it. |
| `path` | `.` | The repository to scan, relative to the workspace. SARIF paths are relative to it, so it should be the root of a checkout. |
| `sarif` | the runner's temp directory | Where the SARIF is written, relative to the workspace. |
| `upload-sarif` | `true` | Upload the SARIF to code scanning. Needs `security-events: write`. |
| `fail-on` | `error` | The lowest SARIF level that fails the step: `error` (critical and high), `warning` (also medium), `note` (any result), or `none`. |
| `fail-on-unmeasured` | `false` | Also fail the step when a lane did not measure. Otherwise each such lane is a warning annotation. |
| `install-tools` | `false` | `true` runs `commitwork setup --yes` for the scanners the selected lanes require; a comma-separated list installs those scanners instead. |
| `trust-repo-manifest` | `false` | Pass `--trust-repo-manifest`, so lanes that execute a script the scanned repository supplies can run. |

Outputs: `sarif` (empty when none was written), `report-dir` (each lane's report and
`checks-status.json`), `exit-code` (of `commitwork run`), `results`, `unmeasured` and `failed`.

**What a hosted runner has.** The action installs Node 24 with `actions/setup-node`, which stays on
PATH for the rest of the job. A GitHub-hosted runner has none of the scanners most lanes wrap. With
`install-tools` left `false`, `fast` runs its Node lanes and records the gitleaks, TruffleHog,
Semgrep and zizmor lanes as not measured, naming the missing tool. Each of those lanes appears in
the SARIF's tool execution notifications, in the job summary and as a warning annotation, and none
is reported as clean. `install-tools: 'true'` installs what `fast` needs that a Linux runner can
install: Semgrep, zizmor and flawfinder through pipx, and gitleaks and TruffleHog from release
binaries whose SHA-256 the install catalogue pins. cppcheck, which the catalogue installs only
through Homebrew, stays missing. The install's time on a hosted runner has not been measured. With
`checks: all` it tries every catalogued scanner the group names, which takes far longer. Lanes run
under bubblewrap where it works on the runner and unconfined otherwise, and each lane's row in
`checks-status.json` records which.

**How the step ends.** `commitwork run` exits 0 whatever it found, 1 when a lane failed to execute
and 2 when it could not run. The action therefore judges findings from the SARIF, against
`fail-on`. Exit 1 or 2, a failed export or a missing SARIF fails the step whatever `fail-on` says.
The upload runs before the step fails, so a failing run's findings still reach code scanning.

**Untrusted by default.** The action runs only the bundled baseline (`--manifest
security-baseline`), so it never reads a repository's own `commitwork.json`. It clears an inherited
`COMMITWORK_TRUST_REPO_MANIFEST` and runs a repo-supplied script only when `trust-repo-manifest` is
`'true'`.

Code scanning on a private repository needs GitHub Advanced Security, and without it the upload
fails the step. Set `upload-sarif: 'false'` there and keep the SARIF from the `sarif` output.
[`.github/workflows/github-action.yml`](.github/workflows/github-action.yml) runs the action from this
checkout over the dirty scan canary, once with no scanner installed and once with `install-tools`.

## 2. The security baseline — 82 checks

[`manifests/security-baseline.json`](manifests/security-baseline.json) is the portable check set,
organised into eleven groups (`all`, `fast`, `supply-chain`, `deep`, `runtime`, `compare`, `langs`,
`rust`, `elixir`, `haskell`, `cobol`). Each check wraps a scanner, normalises its output into
commitwork's finding schema, and records `noscan` naming the missing tool when a check applies to
the repository but its binary is absent. Group membership is the union of the top-level `groups`
map and each check's own `groups` tags. **76 are in `all`**, the group the schedule runs; the six outside it are `sast-opengrep`,
`sast-auto` and `secrets-betterleaks` (the `compare` group: second engines whose counts stay out of
the headline total), and `lint-rust-clippy`, `sast-codeql-swift` and `sast-codeql-go` (all three
build the code).

| Area | Checks |
|---|---|
| **Secrets** | gitleaks · TruffleHog · mainframe credentials in COBOL and JCL (`secrets-cobol-jcl`) |
| **SAST** | Semgrep · Opengrep · CodeQL (JS/TS, Java, Ruby, Python, C/C++, Swift, C#, Rust, Go) · gosec · Joern · Bearer · bandit · Brakeman · Sobelow · phpcs / Psalm · cppcheck · flawfinder · Node hazards · weak randomness in credentials |
| **Dependencies** | OSV · dep-scan reachability · govulncheck · npm/yarn audit · retire.js · bundler-audit · cargo-audit · JVM + Gradle · provenance · dependency content (install hooks, lockfile integrity, version drift) · Renovate |
| **Supply chain** | Socket · GuardDog · SBOM (CycloneDX / Syft) · vendor-scan · model artefacts and dataset loader configs · commit provenance and commit velocity |
| **IaC & CI** | Trivy config · Hadolint · actionlint · zizmor · Actions gaps · shellcheck · gradle-wrapper |
| **Agent configuration** | agent instruction files (`agent-instructions`) · MCP servers, hooks and permission grants (`agent-config`) |
| **Runtime / DAST** | Nuclei · BOLA + authz probes · TLS & security headers · API fuzzing |
| **Posture** | Prowler (GitHub cloud posture) · OpenSSF Scorecard · WCAG a11y |
| **Mobile** | Android and iOS manifests (`mobile-manifest`) |
| **Code-quality signals** | stub-detect · minify-detect · deno lint/check · ruff · golangci-lint · PMD · clippy · rustfmt · hlint |
| **Mainframe** (optional) | [cobolwork](https://github.com/Portll/cobolwork): one security lane, `sast-cobol-cobolwork` (COBOL/CICS/JCL data flow, credentials and authority grants), plus `cobol-inventory` (what COBOL is present and which copybooks are missing) and `secrets-cobol-jcl` (gitleaks with cobolwork's RACF/JCL/TSO rule pack). A separate repository with no dependencies; when it is not installed these lanes record `noscan` naming it, never a clean zero |

The DSN rule (a credential in URL userinfo, which neither gitleaks nor TruffleHog carries by
default) is not a fleet lane. It lives in this repository's own `.gitleaks.toml` and in
`bin/secrets-sweep.mjs`, which `bin/pre-publish.mjs` runs over commitwork itself
([method](docs/SECRETS-SWEEP.md)).

### The Top 100 — what any of this actually covers

[docs/TOP-100.md](docs/TOP-100.md) is a taxonomy of **110 vulnerability classes** extending the OWASP
Top 10, which appears as a crosswalk column rather than as ten of the list. Every entry is phrased as
a *defect* — a property of the system, true or false of a given commit — rather than as an attack or
an outcome, so it can be machine-evaluated.

Each class carries an evidence tier stating what commitwork can prove about it: **provable** (a check
in `all` produces evidence you can re-derive), **provable but uninstalled**, **indicative** (a
candidate automation cannot settle), **partial**, and **unobservable** — no check looks. The
per-tier counts live in the document rather than here, so they move with the lanes instead of going
stale in prose. The unobservable classes are published *as part of the taxonomy* rather than omitted
from it.

## 3. The scheduled fleet monitor — `monitor/`

Promotes commitwork from a per-repo runner into a **scheduled monitor over declared areas**. No new
server stack: a registry, a scheduler, a rollup, and viewers.

The registry (`monitor/private/projects.json`, `CW_REGISTRY` overrides; a redacted
`monitor/projects.example.json` loads in its place, with a warning, on a checkout that has none)
takes Steam-library-style **roots** — folders scanned for git repos (org subfolders up to
`maxDepth`), each discovered repo becoming a project; explicit entries win over discovery, `~/`
expands per machine. **Areas** are the declared unit of report output, retention, freshness and
identity; registry-entry to area is N:1 and declared, never inferred from a sweep's contents. A
scheduled caller (`CW_REGISTRY_REQUIRE_REAL=1`, set on every generated launchd agent) refuses the
example registry rather than sweeping it. `commitwork init --root <dir> --repo <path>` writes a
validated registry with one `local` area that claims every declared and discovered repository,
creates `monitor/private/` (or links it to `--private-dir`), and lists each optional private
record with what its absence means and which shipped `*.example.json` gives its shape. It never
overwrites an existing file and never copies an example into a live store.

```
sweep.mjs [group] [project|--all] [--dry]
  │  batch-manifest.json anchors each repo's SHA/branch/dirty state   ← intent, before
  ├─ scanner-preflight --update                          (tool versions; trivy/grype databases)
  ├─ per repo: bin/commitwork.mjs run <group>  ──▶ reports/sweep-<stamp>[-<area>]/
  ├─ rollup.mjs   ──▶ {rollup.json, dashboard.html, REMEDIATION.md, lifecycle.json, history/}
  ├─ preflight-build · issue ingest · liveness · timeline · runtime-report · races  (non-blocking)
  │  batch-verdict.json + sweep-journal.jsonl            ← what happened, after
  ├─ compact-reports.mjs --apply                         (retention; reports/ once hit 37G)
  └─ export-overwatch.mjs                                (rollup → the overwatch-layer)
```

With no project named, a sweep covers the registry's primary area; `--all` fans out one child
sweep per area. Preview the resolved fleet without running anything:
`node monitor/sweep.mjs all --all --dry`.

**Historical slices + verified-remediation ledger.** Every rollup is a *slice* — a historically
accurate, provenance-gated cut through the fleet. `monitor/ledger.mjs` keeps the ledger whose
evidence tiers decide what counts as *cleaned*; weak evidence never does.

**Failure taxonomy.** The monitor ships a classification of every way an oversight system can say
"this is fine" while being wrong — currently **edition 17, 207 classes**, held as
[`monitor/failure-taxonomy.json`](monitor/failure-taxonomy.json) with prose renderers, because
editions past v3 never took prose and the registry is the source of truth. Its sibling
[FALSE-CLEAN-TAXONOMY.md](monitor/FALSE-CLEAN-TAXONOMY.md) records every time *this* system did it,
with citations.

## 4. The panel — `admin/` (:7878)

Zero-dependency local web panel (`node:http` and siblings only) over the monitor's evidence. Binds
**loopback only**; the outside world reaches it exclusively through a declared cloudflared tunnel.
Front door: scrypt passwords, TOTP, passkeys (WebAuthn) and SSO that authenticates an existing
account but never creates one, a loopback-only bootstrap window, and a fail-closed store.

The section rail has three parts:

- **All projects** — Overview · Rollups · Remediation · Project list · Agent follow-ups · Decisions &
  reviews · Reporting deadlines. These pages cover every project and ignore the picker.
- **Project** — the project picker, then six workspaces for the selected project: **Summary**,
  **Findings** (all findings, security risks, code quality, accessibility, and every scanner page
  through a check selector), **Websites & services**, **Site map**, **Work** and **History**.
- **Manage** — Check schedules · Check configuration · Credentials & connections · Configuration ·
  Service operations.

Two details carry the house rules into the UI. **Count badges are cleared, not zeroed**, when a
source is missing or unparsed — a tab nobody has scanned must never read the same as a tab that was
scanned and came back empty. And the **Issues** view splits a row's disposition into two dropdowns —
a *ruling* (is the finding real) and a *fix type* (how it was addressed) — because they are two
questions, and collapsing them is how a suppression gets filed as a fix.

The page is assembled from `admin/panel.html` and the `admin/menus/` components, and its client
code is eight classic scripts under `admin/static/panel-*.js`, loaded in a fixed order with
`panel-boot.js` last. See [admin/README.md](admin/README.md).

`/api/exposure` answers the operator's question directly: what is reachable from outside, and is it
running software with known unpatched findings?

On the operator port (`127.0.0.1:7879`, never routed by the tunnel) the Scanners view can scan a
directory or every repository on the machine, and shows the remediation brief each scan writes. The
published port has no such control. See [admin/SPEC-scan-path.md](admin/SPEC-scan-path.md).

## 5. Compliance evidence — `cra/`

EU Cyber Resilience Act Art. 14 reporting obligations apply from **11 September 2026**. This module
turns the monitor's existing evidence into that compliance surface:

- a repo → **product** registry (the CRA regulates products, not repos);
- a 30-minute exploited-vulnerability watch (KEV × EPSS) opening hash-chained **cases** with the
  24h / 72h / 14-day clocks;
- per-product CycloneDX **SBOM** and **VEX** exports mapped from the provenance-gated lifecycle;
- POA&M / SOC 2 / OSCAL evidence, and signed hash-chained attestations.

**Everything it emits is a draft.** Submission to an authority is always a human act.

## 6. Viewers and code graph — `sitemap/`, `map/`, `chunk-diff/`, `codegraph/`

`sitemap/` renders a repo as a 3D site: services as buildings, severity as encoded glow, connections
as routes. `map/` is the modernization map engine, rendering migration state across a codebase.
`chunk-diff/` is an N-way Markdown comparison sidecar with chunk-fingerprint identity and a
secret-scan gate on the review UI. All emit **self-contained HTML** — data inlined, `file://` safe,
no CDN — which is a hard rule everywhere in this repo.

`codegraph/` is a symbol graph of this repository: export surfaces, importers, blast radius and dead
exports, read by a hand-rolled lexer that V8's own parser checks in both directions. Its answers are
served to agents through the MCP server.

## 7. MCP server — `mcp/`

`node mcp/server.mjs` (stdio JSON-RPC, zero-dep) exposes commitwork to coding agents. They can
**gate their own commits** (`run_checks`, restricted to bundled manifests, or without blocking
through `run_checks_start` and `run_checks_result`), **read the evidence as
context** (`coverage`, `readiness`, `open_cases`, `poam`, `findings`, `list_products`, resources),
**work the issue tracker** (`issues_ready`, `issue_claim`, `issue_close`, which refuses `fixed` for
scanner-sourced issues, `issue_dispositions`, and `issue_judge`, which appends a ruling and never
deletes the finding), **query the code graph** (`code_about`, `code_blast_radius`,
`code_dead_exports`), and read `turn_efficiency` aggregates.

## 8. Supporting machinery

**Deployment declaration — `bin/deploy.mjs`.** Areas declare their public hostnames; deploy renders a
cloudflared ingress *fragment* (dry-run by default), and `--verify` compares declaration against
reality on five axes (declared / routed / dns / origin / tls), exit 1 on drift. No credentials, no
DNS mutation. `public` + `requiresAuth` with no named `authAt` layer is refused outright.

**Secrets — `lib/secrets.mjs` + `bin/secrets.mjs`.** Credentials are *referenced*, never stored:
`~/.commitwork/secrets.json` is a pointer table holding no secret material, so it can be read and
diffed freely. A pointer names the macOS Keychain (`keychain:<service>/<account>`) or a config file
another tool already owns (`file:<absolute path>#<key>`, the weaker backend, added so Windows and
Linux resolve anything at all). `resolveInto()` returns a *copy* of the environment and never mutates
`process.env` — so the CI jobs the panel spawns cannot read the panel's own OAuth secret out of their
environment. There is deliberately no `get` subcommand: a command that prints a credential puts it
in scrollback. Writing to the keychain passes *no* value, so `security` prompts and the secret is
typed rather than sitting in argv. A missing secret is **loud**, because one export once looked for a
key in a file that does not exist on this machine, found nothing, and exited 0 — silently no-opping
for months while the sweep reported success.

**Verdict journals — `bin/verdict-journal.mjs`.** Every gate decision is journaled, *including the
suppressed turns*, because a silent turn is a decision. Rotation caps each live file and archives
rather than overwrites, so a reader who opens only the live file sees a bounded window and knows the
bound. The exposure split is load-bearing: free text lives under `.claude/`, which nothing serves;
records under `reports/` are structured fields only, because that tree goes over the tunnel.

**Reconciling audit findings — `bin/reconcile-findings.mjs`.** Multi-pass audits produce a narrative
and a findings array that drift apart. `reconcile` merges every pass into one deduplicated queue
with explicit provenance and disposition, and **exits nonzero while conflicts or unreviewed entries
remain**.

**The commit path — `bin/commit-phase.mjs`.** Commits declared paths through a per-session index,
refuses if HEAD moved, and stamps `package.json` with the parent's version and the patch bumped on
every commit it writes. See [bin/README.md](bin/README.md#the-commit-path--format-phasemjs-and-commit-phasemjs).

**The test entry point — `bin/test-run.mjs`.** `npm test` runs the suite serially through this
wrapper, which points every output the spawned production code would write under `reports/` and
`.claude/store/` into a scratch directory, fingerprints the live paths before and after, and fails
the run if one moved.

**Documentation gate — `bin/docs-doctor.mjs`.** Four documentation tiers (durable / living register /
cycle artifact / generated), each with different rules about staleness. Durable docs carry a
`verified-against: <date> <sha>` stamp; the gate exits 1 on orange, 2 on grey-only.

---

# What is NOT finished

Stated plainly, because a feature list needs its companion list of gaps. Verified against
a commit on 2026-10-07.

### Publication has not happened yet

The repository is **private**. The operator decided on 2026-09-07 how it opens
([docs/PUBLIC-REPOSITORY-BOUNDARY.md](docs/PUBLIC-REPOSITORY-BOUNDARY.md)): a reviewed snapshot of
the current implementation becomes the first commit of a fresh public repository, with no inherited
Git history. Anything that would need redaction — source evidence, customer identities, fleet
configuration, incident records, reports, identity and redaction maps — lives permanently in a
private sidecar, and public builds and tests must run without it.

The current checkout is still being separated. It carries tracked operational records and identity
mappings, and some publication tools assume their private inputs live in the source tree. The
snapshot acceptance steps in the boundary document (build and test without private data, scan the
candidate, resolve every release-blocking finding) have not been run to completion.

### Coverage gaps

- **Some Top-100 classes are unobservable** — no bundled check looks at them. The live per-tier
  counts are in [docs/TOP-100.md](docs/TOP-100.md), and a full retier is owed: lanes built after
  the last tally (`mobile-manifest`, `sast-c-cppcheck`, `sast-c-flawfinder`) are noted where they
  apply rather than re-tiered.
- **More are only indicative** — a candidate is raised that automation cannot settle. These belong
  in `undetermined` and are deliberately not counted as findings.
- **A check in `all` whose binary is absent reports `noscan`**, naming the missing tool. That is
  not coverage, and which lanes it applies to depends on the machine: `commitwork doctor` lists
  them.
- **The overwatch export is capped.** Each repository's record carries its top five CVE findings,
  every scanner category's counts, and the top three rows per category; the record declares when it
  was truncated.

### The sitemap viewer is mid-redesign

The layout and lifecycle work landed — persistent renderer, palette mediator, semantic placement —
and so did keyboard access (Tab reaches the canvas and every service label, Enter or Space opens a
card, arrow keys pan, `+`/`-` zoom, Escape closes the card, and a service card lists its files and
vulnerabilities as keyboard targets), a find-a-service box that frames the service and opens its
card, and severity encoding that does not rest on colour alone (each vulnerability glow carries a
text label, `CRIT`/`HIGH`/`MED`/`LOW`). What has not:

- **B4 — Manhattan router**: 90° roads/wiring/airbridges, edge aggregation into service-pair trunks.
  Only the sub-floor sewer layer routes orthogonally today.
- **B5 — exterior views**: [EXTERIOR-VIEWS.md](sitemap/EXTERIOR-VIEWS.md) specifies six; **one** is
  wired (Megalith).
- **F5 — colour-scheme and connection-style themes**.
- **Label placement** de-cluttering at fleet scale.

### Specified but not built

- **Slice backfill** — `--backfill <slug>@<sha>` is reserved in `bin/slices.mjs` and explicitly not
  implemented; it prints `backfill: reserved, not yet implemented` rather than pretending.

### Known incompleteness inside shipped modules

- **CRA is drafts-only by design.** A triggered case runs the 24h / 72h / 14-day clocks either way,
  but it is on the filing (`article14`) track only when its product declares a reporting locale or
  `market.eu: true`; otherwise it runs on the `bestpractice` track and files nothing. The shipped
  example registry (`cra/products.example.json`) has `market.eu: false`. Preflight flags placeholder
  manufacturer fields, and a manufacturer with `establishedInEU: false` and no EU representative
  once any product declares `market.eu: true` (CRA Art. 18). ENISA's single reporting platform was
  not live when this was built. The remaining `TODO` strings across `cra/*.mjs` — support-period
  end, CVD policy URL, the security-update delivery mechanism — are placeholders the generated drafts
  carry until the registry supplies them, not code debt.
- **The test count is not pinned anywhere, on purpose.** It passed 630, then 1300; a static count
  on 2026-10-07 found on the order of ten thousand test declarations across about a thousand files,
  and a pinned number goes stale within the week. Run `npm test`.

### What this is NOT

- Run locally, it does **not** reproduce GitHub-side reporting (Security tab, PR comments, issues,
  artifacts). Those are reporting and orchestration, not checks — read the local stdout or the
  generated reports. The [GitHub Action](#on-githubs-runners-the-github-action) uploads its SARIF
  to code scanning; it posts no PR comments and opens no issues.
- It does **not** apply fixes on its own authority. Its remediation tooling drafts — prompts,
  hand-offs, hardener diffs, an issue loop that is dry-run by default — and applying a fix,
  submitting a notification and mutating DNS all stay human acts by design.

---

## Commands

```sh
npm test                          # the full suite, through bin/test-run.mjs
node bin/docs-doctor.mjs          # documentation freshness gate
node bin/projectstatus.mjs        # regenerate monitor/private/PROJECTSTATUS.md + reports/projectstatus.html
node monitor/sweep.mjs all --all --dry   # resolve the whole fleet, run nothing
node bin/verdict-journal.mjs --tally
node bin/commit-phase.mjs -m <msg> -- <paths>   # commit on a shared tree
```

## Deliberately malicious test fixtures — read this before you scan this repo

`fixtures/scan-canary/` holds two synthetic repositories, `clean/` and `dirty/`, that the canary
tests point the scanners at: across the eleven lanes it plants, `dirty/` must produce the findings
`fixtures/scan-canary/EXPECTED.json` names and `clean/` must produce none, so a detector that has gone
silent cannot pass as a tidy tree.

**`dirty/` is hostile by design. Your scanner and your antivirus are expected to fire on it, and
that hit is the correct result rather than a finding against this repository.** Eighteen of the
files are model artifacts — nine in each tree — and the dirty ones carry real attack structure:
`dirty/model.pkl` is a pickle whose opcodes call `os.system` on load; `dirty/real/real.keras` and
`dirty/real/real_legacy.h5` are genuine Keras archives with a `Lambda` layer holding base64
marshalled Python bytecode that runs when the model is deserialised; and
`dirty/real/real_savedmodel/` is a TensorFlow graph containing `ReadFile` and `EagerPyFunc` ops.
Alongside them are a fake GitHub-shaped token, fetch-and-execute pipelines in `.claude/`, a
`Dockerfile` and two workflows, an npm install hook, and injection and hardcoded-credential
patterns under `dirty/src/`.

Every payload is inert on purpose — the pickle's command is `true`, the embedded bytecode decodes to
`lambda x: x * 1.0`, and every host a payload contacts is under the reserved `.invalid` TLD (the
lockfile's `resolved` entries are ordinary integrity-pinned registry.npmjs.org URLs). The structure is
real so that structural detectors fire; the effect is nothing so that the test suite is not itself
the hazard. Do not execute or load them, and exclude `fixtures/scan-canary/dirty/` if you mirror
this repository into a scanned environment.
[.github/SECURITY.md](.github/SECURITY.md#deliberately-malicious-test-fixtures) has the file-by-file
table.

## Documentation

Four tiers — durable (stamped `verified-against`, listed here), living registers
(`<!-- living-doc -->` marker: current state, never archived), cycle artifacts (archived on close),
generated (never hand-edited) — enforced by `node bin/docs-doctor.mjs`: 🟢 fresh · 🟠 needs updating ·
⚪ unknown freshness. `node bin/projectstatus.mjs` regenerates the status document into the private stores
(+ HTML/PDF twin in `reports/`).

**The evaluation record is not in this tree.** It is audit output about private repositories and is
versioned in a private sidecar, so this index does not list it.

- [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) — how to contribute: the contributor licence agreement every contributor signs once before their first change is merged, how CLA assistant records it on a pull request, what is welcome without one (bug reports, reproductions, design discussion), the house invariants a change has to satisfy, how to tell your failure from the known test baseline, and the warning that `fixtures/scan-canary/dirty/` will trip your scanner. Lives under `.github/` for the same reason as the security policy
- [.github/CLA.md](.github/CLA.md) — the contributor licence agreement, version 1 of 7 October 2026: the agreement cobolwork and ironwork use, adapted to commitwork's AGPL-3.0-or-later, PolyForm Internal Use and Apache-2.0 wire-layer licences. A licence, not an assignment; section 8 keeps every accepted contribution under AGPL-3.0-or-later permanently, and section 9 passes it to the company on incorporation
- [CLAUDE.md](CLAUDE.md) — the agent instructions the public snapshot ships as its CLAUDE.md: what commitwork is, the commands, the house invariants and how to read the larger files. `bin/release-candidate.mjs` swaps it in; the operational CLAUDE.md for the shared working tree is export-ignored
- [.github/SECURITY.md](.github/SECURITY.md) — the security policy: where to send a vulnerability (john@portll.net, the single contact for all four components of the distribution), the 48h/7d response windows, and what is in scope. Two parts are commitwork-specific rather than boilerplate — a **false clean is explicitly in scope and is the most serious class of defect here**, because a check that lies is worse in this system than a crash; and the posture table names the defaults that are load-bearing (`--trust-repo-manifest`, `CW_ALLOW_UNSIGNED`, `CW_OAUTH_LIVE_EXCHANGE`) so an operator can tell a deliberate posture from an accident. Lives under `.github/` because root is reserved and GitHub reads it there
- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) — the threat model for scanning untrusted repositories: per command (`run`, `scan`, `brief`, `doctor`, the monitor sweep, MCP `run_checks`/`run_checks_start`, the pre-commit hook and the standalone target tools), what commitwork executes, reads and reaches over the network. It covers the controls between a scanned tree and the host (`--trust-repo-manifest`, the host sandbox, container postures, lane environment allowlists, the single confined `claude` builder), the attacker model, trust boundaries, residual risks with severity, and what is not defended
- [LICENSING.md](LICENSING.md) — the three licences operator decision D19 ruled on 2026-09-09, each with what it covers: AGPL-3.0-or-later, **or** PolyForm Internal Use 1.0.0 by written agreement, with Apache-2.0 carved out over the wire layer `manifests/wire-layer.json` lists. The grants apply to commitwork as published at github.com/Portll/commitwork. Also: when you would need the second, why this pair, PolyForm Internal Use having no SPDX identifier, and the three things D19 left open (the licensor's legal entity, hosting and redistribution, governing law)
- [docs/AGPL-SCOPE.md](docs/AGPL-SCOPE.md) — where the copyleft boundary falls: CLI, MCP stdio and the admin API are arm's-length, `lib/` imports are not, and every artifact commitwork generates is unencumbered — the document a licensee's legal review resolves against
- [docs/THIRD-PARTY-NOTICES.md](docs/THIRD-PARTY-NOTICES.md) — every third-party work this repository redistributes, measured over the tracked set rather than transcribed from a list: IBM Plex (OFL-1.1), three.js and OrbitControls (MIT), the GitHub Advisory Database (CC-BY-4.0), NVD, MITRE CWE/CAPEC/ATT&CK, FIRST.org EPSS, and the CycloneDX, CSAF 2.0/2.1 and OpenVEX schemas in `schema/upstream/`; the mark is original work and the wordmark is live IBM Plex text. The one entry that had no licence — the retired `admin/cw-mono.svg` and its Helvetica Bold outlines — was closed on 2026-10-04 by deleting the file, which removed the question rather than answering it; the entry keeps the record and the wiring measurement that showed nothing loaded it. Records what could not be determined, and how the two notice conditions came to be met on 2026-10-04 (the OFL notice now travels with every artifact that inlines the faces; the MIT licence travels beside `OrbitControls.js`)
- [docs/PUBLIC-REPOSITORY-BOUNDARY.md](docs/PUBLIC-REPOSITORY-BOUNDARY.md) — how the repository opens (operator decision 2026-09-07): one reviewed snapshot as the root commit of a fresh public history, what belongs permanently in the private sidecar, the snapshot acceptance steps, and the current state of the separation
- [docs/stack/README.md](docs/stack/README.md) — draft README for the four-part distribution (overwatch-layer, spine, memory-layer, commitwork): four repositories joined by wires with overwatch-layer on top, which layers are replaceable, the licence stack ruled 2026-09-09 (AGPL-3.0-or-later plus PolyForm Internal Use 1.0.0 by agreement, Apache-2.0 intended for the wire layer), and each component's measured publication status. Parked here until the distribution has a repository of its own
- [docs/stack/TERMS-OF-USE.md](docs/stack/TERMS-OF-USE.md) — draft terms of use for the hosted surface and for evaluating unpublished builds, written for a solicitor's review: authorised-testing-only, South Australian law, and what the Australian Consumer Law does not let a warranty disclaimer exclude
- [docs/stack/CLA.md](docs/stack/CLA.md) — where the September CLA draft stood; now a pointer to the agreement in force, `.github/CLA.md`, and why the draft was replaced
- [docs/stack/COPYRIGHT-ASSIGNMENT.md](docs/stack/COPYRIGHT-ASSIGNMENT.md) — draft deed assigning the four components' copyright from the author to the company before the first commercial sale; South Australian deed formalities; for solicitor review under D19 item 5
- [docs/SCOPE.md](docs/SCOPE.md) — the 1.0 scope statement: the declared lanes by group and kind with their measured trust evidence, the three platforms and each one's limits, what commitwork refuses, what it leaves unmeasured and what is out of scope, every figure cited to the file or command it came from
- [container/README.md](container/README.md) — installing on Linux: `bin/install.sh` (a checkout's HEAD or a SHA-256-checked release tarball into a prefix, Node floor checked, then `setup` for the named scanners; idempotent, refuses to replace what it did not write) and the `container/Dockerfile` image (digest-pinned Debian 12 base, bwrap and pasta, seven scanners, non-root, `CW_SANDBOX=require`), with each `docker run` flag, what happens without it as measured, and what was not measured
- [docs/PLATFORM-SEAMS.md](docs/PLATFORM-SEAMS.md) — every macOS-only seam in tracked source (launchd, keychain, zsh, `/Users/` paths, Homebrew, `sandbox-exec`, macOS tools), each with its portable path or stated limit; `bin/test/platform-seams.test.mjs` fails on an unlisted one
- [docs/TRAPS.md](docs/TRAPS.md) — operational traps: what is true, non-obvious, and has already cost someone a session
- [docs/THEME.md](docs/THEME.md) — the house style for every surface (panel, `/config`, docsite, generated reports, terminal): dark and light colour tokens with measured contrast, the colour-vision palettes and how the theme switch works, IBM Plex type scale and weights, spacing steps, page frame, radii, borders, elevation, motion and focus, the panel component vocabulary, the decision controls in `admin/static/theme.css`, the seal and wordmark lock-up, which generated pages follow the palette and which carry their own, and a dated list of where live surfaces depart from it
- [docs/TOP-100.md](docs/TOP-100.md) — the commitwork Top 100: 110 vulnerability classes extending the OWASP Top 10, with OWASP as a crosswalk rather than ten of the list, every entry stated as a defect rather than an attack or outcome, and a per-class evidence column read from the check manifests — what the scheduled `all` sweep can prove, what is one install away, what is merely indicative, and what nothing looks at (per-tier counts live in the document, where they can move with the lanes) — plus the coverage plan for memory safety and mobile. Promoted from the sidecar 2026-08-28 after months as a dangling index entry: the file was written but never committed
- [docs/LANE-TRUST.md](docs/LANE-TRUST.md) — how far to trust each lane: its fixture source, its last scan-canary result in both directions, and the share of its findings left undetermined (`monitor/lane-trust.mjs`)
- [docs/SECRETS-SWEEP.md](docs/SECRETS-SWEEP.md) — the belt-and-braces secrets method: why three scanners, the DSN class both off-the-shelf tools miss, verdict vocabulary, the class-and-count canary, and the pre-publish gate (deliberately not pre-commit)
- [docs/LAUNCHLIST.md](docs/LAUNCHLIST.md) — the launch checklist (`bin/launchlist.mjs`): publication, marketing-site, webapp and featureset profiles run against any fleet repository, measured items versus human ticks, acceptances that lapse when the evidence changes, the private store in the sidecar, and the proposed feature-census prompts with their containment rules
- [bin/review-ab.md](bin/review-ab.md) — `/review-ab` slash-command source for `bin/ab-loop.mjs`, the prompt A/B build-loop backbone (migrated from internal-d 2026-09-01)
- [docs/SPEC-dataflow-oversight.md](docs/SPEC-dataflow-oversight.md) — the spec `flow/` was built from: two witnesses over the repo's producer/consumer graph that cannot share a failure mode, why the runtime witness must prove it can observe before its agreement counts, and why `contradicted` is a verdict no evidence can currently reach
- [admin/README.md](admin/README.md) — the :7878 panel: routes, auth model, exposure view
- [docs/COBOLWORK-REMEDIATION.md](docs/COBOLWORK-REMEDIATION.md) — cobolwork remediation: a local model drafts line edits to one COBOL finding, `cobolwork gate` passes or fails the draft, a person applies it by fast-forward, and a later gate verifies it held
- [bin/README.md](bin/README.md) — CLI scanners, deploy declaration, evidence tooling
- [manifests/bola/SEED-PROMPT.md](manifests/bola/SEED-PROMPT.md) — generate a per-repo BOLA manifest for `bin/bola-run.mjs`
- [monitor/README.md](monitor/README.md) — scheduled monitor: areas, sweep pipeline, slices/ledger
- [docs/RELEASING.md](docs/RELEASING.md) — how a release is cut: a tag is `v` plus the version `package.json` carries at that commit, read out of the commit and never off the working tree; why the counted `0.<commit count>` tags were retired (a rebase renumbers every tag already shipped) and why `0.1108` is kept and never moved; the five-step procedure, every refusal the two tools make, and the env overrides that let the tests run on throwaway repositories instead of a shared ref store
- [docs/RELEASE-RUNBOOK.md](docs/RELEASE-RUNBOOK.md) — what surrounds a release: notes generated from its commit range by `bin/changelog.mjs`, why private-history notes never enter the public changelog, withdrawing (yanking) a release without deleting or moving its tag, rolling back by fixing forward or checking out the previous tag, the release workflow that builds, attests and publishes a pushed `v*` tag after CI and approval, the GitHub settings a person applies for it, who does each step, and which parts are not yet available
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — generated by `bin/changelog.mjs`: one section per release, commits grouped by conventional-commit type with breaking changes first; it describes only the history of the repository it is in
- [docs/STABILITY.md](docs/STABILITY.md) — the stability policy: which interfaces are public (CLI commands and flags, exit codes, `CW_*` variables, schemas and output formats, MCP tool schemas, finding identity), which changes each may take before 1.0 and from 1.0, and the deprecation process a removal or renumbering goes through
- [docs/EXIT-CODES.md](docs/EXIT-CODES.md) — generated by `bin/exit-codes.mjs` (`--check` exits 20 when stale): one exit-code table per command, read from each entry point's header comment and not verified against the code; commands whose header states no exit codes are listed as undeclared rather than guessed
- [docs/REFERENCE.md](docs/REFERENCE.md) — generated by `bin/reference.mjs` (`--check` exits 20 when stale): every command with its usage, option lines and declared exit codes; every `CW_*` environment variable with the files that read it; and every key a lane manifest's checks use, with how many checks use it. Descriptions come from header comments and `schema/manifest.schema.json`, and each surface counts what has none as undocumented
- [monitor/FAILURE-TAXONOMY.md](monitor/FAILURE-TAXONOMY.md) — the master classification: seven families by which proposition the oversight system got wrong, with incidents, measured rates, and ranked mitigations
- [monitor/FAILURE-TAXONOMY-v2.md](monitor/FAILURE-TAXONOMY-v2.md) — successor pass: the controller/implementation layer split, warrant shading, and 26 further classes (v1 keeps the incident record); superseded by v3
- [monitor/FAILURE-TAXONOMY-v3.md](monitor/FAILURE-TAXONOMY-v3.md) — v2 plus Family VIII (false progress): avoidance, rumination, gate theatre, and the `gate-focus` sensor that feeds them to the verdict ledger; the **last prose edition** (2026-08-12, 96 classes)
- [monitor/failure-taxonomy.json](monitor/failure-taxonomy.json) — the taxonomy's current form: editions past v3 never took prose, so the registry, not the three documents above, is the source of truth (edition 17, 207 classes, STPA cross-cut). Lineage in [monitor/taxonomy-editions.json](monitor/taxonomy-editions.json); renderers are `bin/taxonomy-render.mjs` (class reference), `bin/taxonomy-web.mjs` (readable edition + version history), `bin/taxonomy-db.mjs` (sqlite projection)
- [monitor/FALSE-CLEAN-TAXONOMY.md](monitor/FALSE-CLEAN-TAXONOMY.md) — every way this system has said "fine" while wrong: classes, incidents, citations, and what closes each
- [workflows/README.md](workflows/README.md) — agent workflow scripts (adversarial review)
- [workflows/MULTI-AGENT-PROTOCOL.md](workflows/MULTI-AGENT-PROTOCOL.md) — running a multi-agent evaluation: probe manifest, evidence rules, who writes the artefact
- [cra/README.md](cra/README.md) — EU CRA readiness: cases, SBOM/VEX, POA&M, SOC 2, attestation
- [mcp/README.md](mcp/README.md) — commitwork as an MCP server
- [map/README.md](map/README.md) — modernization map engine
- [chunk-diff/README.md](chunk-diff/README.md) — N-way Markdown comparison sidecar: chunk-fingerprint identity, secret-scan gate, hide/master/copy/revert/apply review UI
- [joernwork/README.md](joernwork/README.md) — repairs for [joernio/joern](https://github.com/joernio/joern) found while wiring the `sast-joern` lane: two upstream defects with patches and reproducers, one distribution-layout mismatch repaired only locally, all measured against joern 4.0.610
- [joernwork/patches/03-pythonsrc-not-a-member.md](joernwork/patches/03-pythonsrc-not-a-member.md) — joern's `pythonsrc` frontend is advertised and detected but `ImportCode` has no such member: a measured report rather than a patch, since fixed upstream in joernio/joern#6243
- [flow/README.md](flow/README.md) — dataflow oversight: which artifacts nothing reads and which readers have a producer that never runs, measured by a static pass and a runtime pass that share no extraction code, with the coverage gap between them reported apart from genuine disagreement
- [codegraph/README.md](codegraph/README.md) — symbol graph of this repository: export surfaces, importers, blast radius and dead exports, read by a hand-rolled lexer floored in both directions by V8's own linker without evaluating a line, with every answer carrying the reason it might be incomplete
- [sitemap/README.md](sitemap/README.md) — 3D code-structure viewer (SiteMap tab)
- [sitemap/EXTERIOR-VIEWS.md](sitemap/EXTERIOR-VIEWS.md) — exterior view themes spec (1 of 6 built)
- [design/brand/README.md](design/brand/README.md) — the logo: the seal, its default mark for light grounds and its dark-ground variant, the lockup with the wordmark, and the rules for using them
- [admin/SPEC-settings-tab.md](admin/SPEC-settings-tab.md) — the original proposal for a global Settings tab, kept as a proposal: its settings store and tab were built with a different key set (sweep, perf, scan, learning and report settings with per-area override rules; `monitor/settings.mjs` and `admin/routes/settings.mjs` are the authority), and its documentation-health and remediation-sharing sections were never built
- [admin/SPEC-scan-path.md](admin/SPEC-scan-path.md) — scanning a directory, or every repository on the machine, from the panel's Scanners view, an operator-port-only feature (ruling 2026-09-28): requirements with the exact refusals, the path rules (realpath first, credential stores in both directions, the checkout itself), the reused job runner, the remediation brief each scan writes and the routes that serve it, and the seven operator rulings of 2026-09-29

---

## Licensing

commitwork is licensed under the **GNU Affero General Public License v3.0 or later**
([LICENSE](LICENSE)). An organisation that cannot take the AGPL can license the same code under
**PolyForm Internal Use 1.0.0** by written agreement. The wire layer (schemas, MCP tool descriptors
and the memory-layer client, exactly the files `manifests/wire-layer.json` lists) is also under
**Apache-2.0** ([LICENSE-APACHE-2.0](LICENSE-APACHE-2.0)). [LICENSING.md](LICENSING.md) states the
terms and when the commercial licence is needed; [docs/AGPL-SCOPE.md](docs/AGPL-SCOPE.md) states
where the copyleft boundary falls for the CLI, the MCP server, `lib/` imports and generated reports.

These grants apply to commitwork as published at <https://github.com/Portll/commitwork>. Running an unmodified commitwork locally,
in your own CI or on a schedule against your own repositories triggers no source obligation.

**No warranty is implied or given.** commitwork's runtime lanes (`dast-nuclei`, `dast-authz-bola`,
`api-fuzz`, `tls-headers`) actively probe live targets. Point them only at systems you own or are
authorised to test; doing otherwise may be unlawful where you are.

Commercial licence and licensing questions: **john@portll.net**.

© 2026 Portll.
