<!-- verified-against: 2026-10-08 -->
# bin/ — the CLI and its scanners

`commitwork.mjs` is the CLI itself (see the [root README](../README.md) for commands, options and
manifest trust rules). Everything else here is a scanner, generator or gate it orchestrates —
each file's header comment is the authoritative doc; this is the map.

## Scanners & gates

| Tool | One line |
|---|---|
| `audit.mjs` | Run every gated security tool (`manifests/security-tools.json`), topo-sort the remediation DAG, flag coverage voids → `audit-packet.json` + `remediation-draft.md` for [workflows/adversarial-review.mjs](../workflows/README.md). |
| `authz-bola.mjs` | BOLA/IDOR/tenant-isolation probe against a running gateway, grounded in live OpenAPI; `bola-tokens.sh` mints the tenant tokens (env-only, refuses to guess). The ClientA-shaped single-target probe. |
| `bola-run.mjs` | Generic, manifest-driven successor to `authz-bola.mjs`: an actor matrix (anon/user/admin × 2 tenants) whose every attacker×owner cell maps to a vuln class (broken-auth/BOLA/BFLA/cross-tenant). Ownership is established by **seeding** (each actor POSTs its own object) or **declared** pairs; credential minting is pluggable (`keycloak`, `supabase`, `login-post`, `static-bearer`, `api-key`, `none`), and per-actor `headers` carry custom name:value pairs for tenancy that rides in a header. Secrets are referenced by NAME only (`…Env` fields, `${ENV:NAME}`) and resolved through `lib/secrets.mjs`, so a test-account password lives in the keychain rather than a plaintext export; an already-set env var still wins. A denied read is judged by whether a response actually **discloses an object**, not by body length — a filtering backend answering 200 + `[]` is clean. A new backend is a new manifest, not a fork: operator manifests are private records in `monitor/private/bola/<name>.json` (`CW_BOLA_MANIFEST_DIR`), and `manifests/bola/example.json` is the shipped worked example — schema at `schema/bola-manifest.schema.json`, seed prompt at [manifests/bola/SEED-PROMPT.md](../manifests/bola/SEED-PROMPT.md). Same `authz-bola.json` evidence contract; same trust gate (`--trust-repo-manifest`). |
| `build-health.mjs` | Build-currency checks a vuln scanner can't see: `deadcode`, `toolchain` (build+test on the *declared* version in a container, per-phase), `provenance`, `format` and `lint` (conformance to the formatter/linter the repo *declares*, at the severity **it** declared — no declaration is n/a, never a finding; a `-W` repo reports a count, never a failure). |
| `quality-gates.mjs` | Per-service consolidation-bar gates; vocabulary `present\|partial\|MISSING\|n/a`; `boot-test-pass` is the one reader gate. |
| `races.mjs` | Race-condition scanner (`--engines spotbugs,semgrep,eslint,codeql,infer`). |
| `stub-detect.mjs` | TODO/FIXME/stub marker scanner (hygiene lane); allowlist in the private record `monitor/private/stub-allowlist.json` (`CW_STUB_ALLOWLIST`; absent means nothing is allowed, and `monitor/stub-allowlist.example.json` shows the shape). |
| `deps-content.mjs` | Dependency CONTENT checks the advisory lanes cannot make: install hooks that fetch or exec (`dep-install-exec`, CWE-829), missing or sha1 lockfile integrity (`dep-missing-integrity` / `dep-weak-integrity`, CWE-494) and installed-vs-locked version drift (`dep-version-drift`, CWE-1357). Reads `package-lock.json` v2/v3 and each locked package's `package.json` at the lockfile's own key; never echoes a hook's command. Absent lockfile is a declared void (exit 0, `filesScanned` 0); unparseable or v1 is exit 2 so the `.exit` sidecar records a could-not-run. Report format `rule-counts`, category `depsContent`, groups `all` + `supply-chain`; the canary plants a `curl … \| sh` postinstall under `fixtures/scan-canary/dirty/node_modules/`. |
| `agent-instructions.mjs` | The files an AI coding agent reads as instructions (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `copilot-instructions.md`, `README.md`, `docs/**/*.md`, …), read for what a human reviewer would not see: `hidden-unicode` (bidi controls, zero-width space, tag characters — the one `HIDDEN_TEXT` definition imported from `minify-detect.mjs`), `html-comment-directive`, `agent-directive-exec` (fetch-and-execute outside an Install section), `agent-directive-exfil` (a credential path or variable paired with a send sink, crit) and `encoded-blob`; and, past the single line, `directive-split-across-files` (an imperative in one file pointing — by markdown link, `@path` or bare `path.md` — at another instruction file whose Setup section carries the fetch-and-execute or credential-to-sink; one hop, reported on the referrer naming the target), `directive-in-command-file` (`.claude/commands/**` and `.cursor/rules/**` are executed prompts, so an exec/exfil line there is high with no heading or cue exemption), `guard-bypass-directive` (crit, CWE-693 — `--no-verify`, `HUSKY=0`, a `CW_GUARD…=off`, "skip the guard"; negated mentions do not fire) and `instruction-env-indirection` (med, CWE-829 — a fetched command or process substitution that is then evaluated, or an instruction-named variable such as INSTRUCTIONS_URL beside a run/fetch verb; the detail names the variables and hosts the directive resolves through — this row is itself worded to stay under the rule, and `bin/test/agent-instructions.test.mjs` holds this README as a negative control). CWE-1427 on the directive rules, CWE-506 on the blob; `RULE_CWE` is exported. Details carry counts, code points, line numbers, paths, variable names and hosts only. `filesScanned` 0 is a declared void (exit 0); an unreadable root or exclusion policy is exit 2. Report format `rule-counts`, category `agentInstructions`, group `all`; the canary plants every rule under `fixtures/scan-canary/dirty/` (`CLAUDE.md`, `docs/setup.md`, `.claude/commands/deploy.md`) and their benign twins under `clean/`. `monitor/agent-instructions-harden.mjs` is the declare-only fixer: it emits a `git apply`-able diff that strips the hidden characters, never writes the tree, and refuses (exit 3) when there is nothing to strip; none of the four cross-file, command-file or indirection rules has a mechanical fix, and the manifest says so. |
| `commit-velocity.mjs` | Machine-speed commit, CI-file and credential-file activity, read from `git log` metadata (author, timestamp, changed-path classes; never content). Three rules keyed on the author over a rolling window (`CW_VELOCITY_WINDOW_MIN`, default 60): `machine-speed-commits` (high, > `CW_VELOCITY_COMMITS_PER_HOUR`, default 30), `workflow-edit-burst` (high, `.github/workflows`/`actions` edits > `…WORKFLOW_PER_HOUR`, default 6), `sensitive-file-burst` (med, credential/config touches > `…SENSITIVE_PER_HOUR`, default 12). CWE-799. The signal the July 2026 intrusion buried in routine noise; a legitimate fast committer trips it too, and a human confirms authorisation — by an entry in `monitor/velocity-allowlist.json` (`schema/velocity-allowlist.schema.json`: rule + author + mandatory `expires`, repo optional and absent means the self scan only; per RULE, so an acknowledged agent identity's workflow or credential bursts still fire). Suppression is in-scanner: `summary.allowlisted` / `allowlistExpired` count what was withheld and what lapsed, an unreadable or schema-failing list suppresses nothing and sets `allowlistUnreadable`. `commitsScanned` 0 is a void; exit 2 outside a git repo. Report `rule-counts`, category `commitVelocity`, group `all`. |
| `commit-provenance.mjs` | Who made the last N commits (`CW_PROVENANCE_DEPTH`, default 200), read from `git log` through `spawnSync` and classified human/machine with `monitor/attribution.mjs` `classifyWho`. Four rules: `unsigned-on-protected-branch` (med, CWE-347 — only where `manifests/branch-protection.json` lists the repo with `requireSigned:true`; otherwise not-applicable, never a finding), `bot-authored-merge` (med), `author-committer-mismatch` (low), `machine-author-unregistered` (high — bot list from the target's `.commitwork-bots.json` / `commitwork.json` `bots[]` plus `CW_PROVENANCE_BOTS`). Report `commit-provenance.json` carries sha, rule, sev, CWE and classification words only — no subjects, bodies, names or emails; `filesScanned` is the commit count and 0 is a declared void. Exit 2 when the target is not a git repo. Canary: `bin/lib/provenance-fixture.mjs` materialises `fixtures/scan-canary/{dirty,clean}/.commitwork-provenance-fixture.json` into real temp repos. |
| `agent-config.mjs` | The scanned repository's own agent configuration — `.mcp.json`, `.claude/settings*.json`, `.cursor/mcp.json`, `.vscode/mcp.json` (JSONC), `.claude/hooks/**`, `.claude/commands/**`. Nine rules: `mcp-remote-server` (a server on a non-loopback host), `mcp-command-shell` (sh/curl, `node -e`, unpinned `npx` — `@latest` is a tag, not a pin), `mcp-host-from-env` (med, CWE-829 — the url host, command binary, npx package or a host-ish env value is a `${VAR}` resolved at run time; the variable is named; `${HOME}` in a local path is not), `hook-shell-out` (a hook that fetches from the network, pipes into a shell or evaluates inline code), `hook-script-content` (for each settings hook whose command names a script in the tree, the script itself is opened — bounded by `CW_AGENT_CONFIG_MAX_BYTES`, taken from the env at call time — and judged for a fetch, a shell pipe, inline eval or a key-file access; in a JS or Python script a shape counts only within three lines of an `exec`/`spawn`/`subprocess` call, because a `node -e` inside a printed message is data — `bin/gate-tests.mjs` is the negative control; a script under `~`, outside the tree, missing or oversize is a stated `unreadableHookScripts` count with its reason), `command-file-shell` (a fenced `bash`/`sh` block in a `.claude/commands/**` prompt that fetches from the network or touches a key file), `permissions-allow-broad` (`Bash(*)`, `Bash(curl*)`, `Write(/*)`, bare tools, whole-server `mcp__` grants), `permissions-deny-missing` (low, informational — a Bash grant beside no `permissions.deny` bounding key-file access; `CREDENTIAL_DENY` is the one definition the scanner checks and the hardener writes), `env-secret-inline` (a credential-shaped env value — the KEY NAME is reported, never the value). Report `agent-config.json` in the shared `rule-counts` shape with a `cwe` per row; an unparseable file is counted and named; `filesScanned===0` is a declared void. Canary in `fixtures/scan-canary/` both directions (`.mcp.json`, `.claude/settings.json`, `.claude/hooks/pre-deploy.sh`, `.claude/commands/deploy.md` dirty; `lint.md`, the `pre.sh` and `node .claude/hooks/lint-touched.mjs` hooks and a `${HOME}` path clean). Its declare-only fixer is `monitor/agent-config-harden.mjs`: pins `npx` packages from the target's lockfile, narrows `Bash(*)` to the grants the target's own settings already record, adds the `permissions.deny` block beside any Bash grant that has none, emits a `git apply --check`-clean diff, never writes, and REFUSES when nothing would change. |
| `model-artefacts.mjs` | Model artefacts and dataset loader configs, zero dependencies: a pickle opcode walker over `.pkl .pickle .pt .pth .bin .ckpt .joblib` (zip-wrapped torch checkpoints opened and every `.pkl` member walked; the artefact is never unpickled) flagging `os`/`subprocess`/`builtins`-class globals (`pickle-dangerous-global`, CWE-502); safetensors header validity (`safetensors-header-invalid`, CWE-502); `{{` `{%` `${` and remote schemes in `data_files`/`path`/fsspec fields of `dataset_infos.json`, dataset yaml and README front matter (`dataset-config-template` CWE-94, `dataset-config-remote-scheme` CWE-829 — the July 2026 Hugging Face entry vector); `trust_remote_code=True` and hub calls without a commit-sha `revision=` in python (`hf-trust-remote-code` CWE-829, `hf-unpinned-revision` CWE-1357); Keras Lambda layers by `class_name` in a `.keras` archive's `config.json`, a SavedModel's `keras_metadata.pb` or a Keras-2 `.h5` `model_config` attribute (`keras-lambda-layer` CWE-502 — config blobs are located by their own opening anywhere in the bytes, because h5py stores the attribute as a heap-referenced vlen string; not an HDF5 reader: the attribute name only witnesses that a config was declared, declared-but-unlocated or unparseable is `unreadable`, weights-only is `kerasWithoutConfig`); `ReadFile`/`WriteFile` and `PyFunc`-class NodeDefs in `saved_model.pb`, `*.pb`, `*.pbtxt` by protobuf signature (`tf-graph-file-op` CWE-73, `tf-graph-python-op` CWE-94; a graph with no op-shaped string is `tfGraphsWithoutNodes`). Unreadable magics and over-cap files (`CW_MODEL_MAX_BYTES`) are declared counts, never clean skips; `modelscan` is an optional second witness (install with the `tensorflow,h5py` extras under Python 3.10–3.12 or it reports every Keras file as a dependency error; `CW_MODELSCAN` names the binary; the manifest declares its pipx install as `sandboxExtraReads` and `~/.keras` as a write, without which the host profile denies it and the row says so). Its `errors` count is carried beside `issues`. Real Keras 3.15 / TensorFlow 2.21 artefacts sit under `fixtures/scan-canary/*/real` beside the hand-assembled plants. Exports `RULE_CWE`. |
| `joern-lane.mjs` | The sast-joern lane's command. Runs joern-scan ONCE PER LANGUAGE the installed query bundle actually has queries for (c, java, kotlin, php — derived from a dumped query db, not a hardcoded list), each with an explicit `--language`: left to guess, joern builds a graph for the tree's dominant language, which cost an hour on a JS-primary repository while the C and PHP queries that ran were matching foreign method names by regex, and left a lone `.c` file unread behind a clean 0. `java` is passed rather than `javasrc`, and `pythonsrc`/`javasrc` are avoided entirely: they are advertised by `--list-languages` and are not `ImportCode` members, so the generated script does not compile and the scan never runs (joernwork/patches/03). The JVM's stderr is kept per run — the distribution launcher hardcodes `/tmp/joern-scan-log.txt`, which every joern-scan on the box truncates — by running the launcher's own text with that one path replaced and `$0` still the launcher, so its retry-on-2 and path resolution are untouched. Writes `joern.txt` (one headed section per language), `joern-lane.json` (per-language exit, scanRan, results, failure reason) and `joern-<language>.log`. Exit 0 all scanned, 1 any language failed, 3 nothing in a covered language. |
| `codeql-go-build.mjs` | The build the CodeQL Go lane traces, in place of CodeQL's autobuilder. Go refuses `--build-mode=none`, and the autobuilder runs the scanned repository's own make/ninja/build.sh first — repo-authored code executing inside a scan. This runs `go build` per module instead (compiles, executes nothing; `GOTOOLCHAIN=local` so a go.mod toolchain directive cannot fetch a toolchain mid-scan, `-buildvcs=false`, output to a temp dir so a single main package cannot leave a binary in the tree being scanned). A module that does not compile is not abandoned: its files surface as extraction errors, which the coverage reader subtracts. Modules come from `lib/go-modules.mjs`, shared with the gosec/golangci lane. |
| `actions-gaps.mjs` | Three GitHub Actions findings zizmor does not surface at the persona the fleet runs, read from `.github/workflows/*.yml` at the root with a zero-dependency block-YAML reader: `self-hosted-runner` (high, CWE-1104/CWE-284 — `runs-on` names `self-hosted` as a scalar, in a label list, under `labels:`, or through a `strategy.matrix` value), `workflow-run-trigger` (high, CWE-829 — a `workflow_run` or `pull_request_target` job that checks out the triggering head, downloads the triggering run's artifacts, or fetches the head in a `run:` step; zizmor's `dangerous-triggers` fires on the trigger alone), `permissions-absent` (med, CWE-250 — no `permissions:` block on the job or the workflow). Measured 2026-09-16: zizmor 1.30.1 emits `self-hosted-runner` only at `--persona auditor`. Report `actions-gaps.json` carries rule ids, workflow paths, job and step names — never a script body; identity is (rule, file, job). `CW_ACTIONS_GAPS_ROOT`; exit 0 ran, 2 could not run; `filesScanned` 0 is a declared void. Canary in both directions under `fixtures/scan-canary/*/.github/workflows/deploy.yml`. |
| `actions-health.mjs` | Reads a repository's GitHub Actions history through `gh api`: per workflow, the red streak on the default branch (`ci-red-streak`, med, at `CW_ACTIONS_HEALTH_STREAK` or more, default 3); across the newest runs, jobs that never got a runner (`ci-never-started`, high, when half or more); and billed weighted minutes (Linux 1x, Windows 2x, macOS 10x; public repositories free). No github.com origin, no `gh` or no access is a void, never clean. Lane `actions-health`. |
| `hermetic-test.mjs` | Runs a Rust repository's `cargo test --no-fail-fast` the way a bare CI runner sees it: an empty `HOME`, debug info off, a target folder of its own, after the prepare steps the operator declares in the registry (`projects[].hermeticTest.prepare`). Counts are summed over every test binary and each failing test keeps its panic message; rules `test-failed`, `build-failed`, `prepare-failed` and `disk-headroom` (over 70% of `CW_RUNNER_DISK_GB`, default 14). Hands over the host's libclang through `LIBCLANG_PATH` and one link in the empty home's `lib/`, because SIP strips `DYLD_*` from `sh`. Exit 0 ran, 2 could not run. Lane `test-hermetic` in `manifests/hermetic-tests.json`, opted into per project. |
| `lib/cargo-target.mjs` | The build folder a sweep's cargo lanes write to: `<root>/commitwork-sweep/<repo>-<hash of its real path>`, root `CW_CARGO_TARGET_ROOT` or `~/.cargo-target-drive`, so a sweep never shares artifacts with a developer's build of the same crate. `CARGO_TARGET_DIR` keeps the symlink path (jemalloc refuses a prefix with a space) and the host sandbox gets the resolved one; an uncreatable folder refuses the lane. |
| `guard-jackson-caseinsensitive.mjs` | Fleet guard keeping CVE-2026-54515 unreachable. |
| `tls-headers-scan.mjs`, `tls-proxy.sh` | TLS + security-header grading, with a local self-signed proxy so testssl/nuclei can grade config. |
| `cspm-github.sh` | Prowler's GitHub provider (branch protection, 2FA, secret scanning). Target from argv, `CW_CSPM_REPO` or the checkout's github origin, never a hardcoded default. Credential: the dedicated `PROWLER_GITHUB_TOKEN`, else the operator's existing `gh auth token` session, a fallback refused whenever `$CI` is set; the report records which (`credential`). No target, no prowler or no credential writes a skip record and exits 0. Prowler's exit 3 (completed with failing controls) is a result; any other non-zero exit is a skip, never a clean scan. |
| `verify-branch-protection.mjs` | Asks GitHub what is *actually* required at the merge gate vs `manifests/branch-protection.json` — the ratchet's ratchet. |
| `renovate-run.sh`, `parse-renovate.mjs` | Self-hosted Renovate dry-run / PR modes and the log parser. |
| `boot-harness.sh` | **BUILT, NOT WIRED.** Boots a repo's own compose/Dockerfile in a sandbox to see whether it starts. Declared by no manifest and called by nothing outside its tests; it produced zero artifacts across the 100-repository corpus. Schema: `schema/boot-harness.schema.json`. |
| `gate-tests.mjs`, `test-select.mjs`, `test-selection-witness.mjs` | The Stop-hook test gate. A turn runs only the test files that can reach the working tree's changes (`lib/test-selection.mjs`: reverse import closure, plus files that name a changed file's basename, followed transitively) and compares their failures by name with the last full run. The full suite still runs when one is due (`CW_GATE_TESTS_FULL_EVERY_MS`, default 6 h), when selection cannot decide, and when a selected test fails in a way the last full run did not record; that run does the confirmation and HEAD attribution. `CW_GATE_TESTS_SELECTIVE=0` turns selection off. `test-selection-witness.mjs` is the second witness: each test file runs alone under `NODE_V8_COVERAGE`, and every repo module it executed must select it. It cannot see JSON reads. |
| `lockfile-synth.sh` | Synthesises a lockfile for an unpinned npm/Python tree, container-only and `--ignore-scripts` (a wheel-metadata-only first pass for Python, with `buildBackendsExecuted` reported when it has to fall back), so a repo that declares dependencies without resolving them can be scanned. `monitor/preflight-build.mjs --apply` runs it for a blind node or python ecosystem and adopts the result into `lockfiles/<repo>` in the private sidecar that `evaluations/` links to (`CW_LOCKFILE_ROOT` overrides; with neither it refuses), or into the repository itself with `--into-repo`; the sweep's own preflight only reports blindness and never applies. Schema: `schema/lockfile-synth.schema.json`. |

## Isolation — egress classes and the host sandbox

`bin/lib/sandbox.mjs` is the one place isolation is expressed. It holds two kinds of posture:

- **Container postures** (`POSTURES`, `buildSandbox`) for the docker lanes — `deps-osv`,
  `supply-chain-guarddog`, `deps-reachability`, `deps-updates`. A docker lane is declared three
  ways (its `requires` names docker, `monitor/perf-profiles.json` says `container: true`, and its
  command or script runs `docker run`), and `bin/test/manifest-egress.test.mjs` fails if the three
  disagree. The runner never wraps these on the host: the docker client needs the daemon socket,
  which the host profile denies as network, and the container posture is already the confinement.
  Their rows carry the posture's isolation (`fs-only` for `lookup`/`fetch`, `full` when every named
  posture severs the network) and an `isolationReason` that says so.
- **The host posture** (`hostSandboxArgv`) for every other lane. The runner spawns each manifest
  command as `sandbox-exec -p <profile> /bin/sh -c <cmd>` on macOS and
  `bwrap --ro-bind / / --tmpfs /tmp --bind <reportDir> <reportDir> [--bind <TMPDIR>] [--bind <declared write>…] [<credential mask>…] [--unshare-net] --die-with-parent -- sh -c <cmd>`
  on Linux (TMPDIR is bound only when it lies outside `/tmp`; the tmpfs is mounted before the
  report-dir bind so a report dir under `/tmp` stays writable; each credential mask is
  `--tmpfs <dir>` or `--ro-bind /dev/null <file>` and comes after every bind, because bwrap's later
  mount wins). There is no host sandbox on Windows. The macOS profile is generated from inputs
  only; the Linux argv also stats the credential stores it masks, through an injectable `fs`. So
  `bin/test/sandbox-host.test.mjs` asserts the text for every class on both platforms, holds the
  Linux masks against the paths parsed out of the macOS profile, and then, where `sandbox-exec`
  exists, runs it and measures the effects with a control for each.

**Egress classes.** Every check declares `egress` — `none`, `registry`, `verifiers`, `github` or
`target` — and the vocabulary is `EGRESS_CLASSES`, closed and mirrored into the manifest schema.
`none` runs with the network denied and the row reads `isolation: full`; the other four run with
the filesystem confined and the network open, `isolation: fs-only`, because what they reach is the
point of the lane (a package registry or advisory database, the credential-issuing services
TruffleHog verifies against, the GitHub API, the live URL under test). A lane the manifest leaves
undeclared is **not** wrapped under a guessed class: it runs unconfined with
`isolationReason: check declares no egress class` on its row, and the manifest test fails on any
bundled check that omits the key. Under `none` an OSV-style lane would otherwise exit 0 over an
empty result, which is why a guess in either direction is refused.

**The filesystem rule** is the same for every class, and the two platforms enforce different
halves of it. On **macOS** the profile denies by default and reads only the scanned tree, the report
dir, commitwork's own root, the system prefixes (`/usr`, `/bin`, `/sbin`, `/opt/homebrew`,
`/System`, `/Library`, `/private/etc`, `/private/var/db`, `/private/tmp`, `/dev`), the node prefix,
TMPDIR, the Xcode developer directory (`/usr/bin/git` is a shim that dlopens it), `~/.gitconfig` and
`~/.config/git` (git treats a permission error on its global config as fatal where a missing file
is fine), the install prefix of every binary the check's `requires.tools` names — resolved at run
time through `command -v` and `realpath`, never `/` and never the home directory itself — the
targets of symlinks in the tree that point outside it (a target in a forbidden mount, or one that
lies inside a credential store or contains one, such as the home directory or `~/.config`, is
refused and named), and every ancestor directory of those paths as a bare
literal (Java's `toRealPath` walks them). It writes only `$CW_REPORT_DIR`, TMPDIR, `/tmp` (tools
hardcode it, and it is world-writable already) and `/dev/null`. Credential directories (`~/.ssh`,
`~/.aws`, `~/.gnupg`, `~/.docker`, `~/.kube`, `~/.netrc`, the keychains) are denied after every
allow, so a declared extra read of `~/` still cannot reach them — the live test proves it. Seatbelt
matches resolved paths, so every `/tmp`, `/var` and `/etc` path is emitted in its `/private` form as
well. On **Linux**, `bwrap` binds the whole root read-only and then masks every credential store
that exists on the host. The paths macOS denies (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.docker`,
`~/.kube`, `~/Keychains`, `~/.netrc`, `~/Library/Keychains`, `/Library/Keychains`) are masked
whatever the lane declares. `~/.config/gh`, `~/.config/gcloud`, `~/.azure`, `~/.git-credentials`,
`~/.npmrc`, `~/.pypirc` and `~/.cargo/credentials{,.toml}` (`DECLARABLE_CREDENTIALS`) are masked
unless the lane's readable set reaches them, the condition under which the macOS allowlist lets
them through: posture-scorecard's declared `~/.config/gh`, or `~/.cargo/credentials.toml` for a
lane whose cargo lives in `~/.cargo`. A declaration inside one of these unmasks the whole store,
where macOS would open only the declared path; no bundled lane declares one. A directory gets an empty tmpfs (writes land there and are
discarded) and a file gets `/dev/null`, whose open fails with EACCES. A store is masked at its
resolved path, because bwrap refuses to mount on a symlink; an absent store is skipped, because
bwrap cannot create a mount point on the read-only root; a stat error other than ENOENT or ENOTDIR
refuses the lane. Measured 2026-09-27 under bubblewrap 0.12.0 as root and as uid 1000: every store
read that succeeds on the old argv fails on the new one, while the tree, the report dir and a
declared `~/.config/gh` stay readable. **Everything else stays readable on Linux**, which has no
read allowlist: the rest of the home directory, other users' world-readable files and any
credential kept outside these paths. What bwrap confines beyond the masks is writes (a private
tmpfs `/tmp`, the report dir, TMPDIR and declared writes) and, under `none`, the network. A declared
write, report dir or TMPDIR inside a store macOS denies is refused on both platforms.

A lane that needs more declares it on the check: `sandboxExtraReads` (posture-scorecard reads
`~/.config/gh` for the token `gh auth token` hands scorecard; the PHP lanes read `~/.composer`) and
`sandboxExtraWrites` (a tool's own cache: `~/.semgrep`, `~/Library/Caches/trivy`, `~/.codeql`,
`~/.npm`, `~/.cargo/advisory-db`). Prefixes are `/`, `~/` and `./` (the scanned tree), nothing
else. Per lane on purpose: a lane that executes repository code and also writes a cache a later
lane executes from is a supply-chain path, and the declaration is what makes it reviewable.

**What the row says.** `isolation` is `full`, `fs-only` or `none`; `none` always carries an
`isolationReason` (`CW_SANDBOX=off`, the probe's reason the tool is unavailable, or the undeclared
class). `CW_SANDBOX=off` disables the wrapper for a run and is printed once and written on every
row; it is never silent. `bin/lib/isolation.mjs` then demotes coverage to `reduced` on any lane
that declares `executesRepoCode: true` and ran with `isolation: none` — today, in
`security-baseline.json`, `sast-codeql-swift` (autobuild), `lint-rust-clippy` (build.rs and proc
macros), `authz-test` (the tree's own script, and only with `--trust-repo-manifest`: it also declares `requiresRepoTrust`), `sast-php-psalm` (loads the tree's
`vendor/autoload.php`) and `deps-reachability` (cdxgen, in its container), and in
`build-health.json` its `format`, `lint`, `toolchain` and `boottest` checks. The probe
(`probeHostSandbox`) runs the tool once per process with a trivial command;
the per-lane preflight (`preflightHostSandbox`) runs the generated profile with `exit 0` before the
real command, so a profile the tool cannot apply records `noscan` with the tool's own first line of
stderr and the lane never runs unconfined by accident.

### The 2026-09-16 executes-or-reads audit

`executesRepoCode` is decided per tool from what it does, never from the lane's name, and the READ
verdicts matter as much as the EXECUTE ones: a false declaration demotes coverage that was real.
The declared set is the one above (`bin/test/manifest-egress.test.mjs` holds it against each
command's text); this is why the rest are not.

| lanes | verdict | why |
|---|---|---|
| build-health `lint`, `format`, `toolchain`, `boottest` | executes | the repo's own lint/format config and scripts on the host; `npm test`, `cargo test`, `./gradlew` in a hand-rolled `docker run … :/src:ro` that is not routed through `bin/sandbox.mjs`, so it earns no container isolation |
| `sast-codeql-{java,cpp,csharp,rust,ruby,python}`, `sast-codeql` | reads | `--build-mode=none` extractors, or interpreted-language parsers; `sast-codeql-swift` is the one lane that still builds |
| `deps-go-govulncheck`, `lint-go-golangci`, `sast-go-gosec` | reads | the Go tool loads packages without running repo code; a `toolchain` directive can fetch a checksummed Go toolchain from the proxy, which is not repo code |
| `deps-gradle-declared`, `gradle-wrapper` | reads | catalog and literal parsing; a jar hash — neither invokes Gradle |
| `deps-osv`, `supply-chain-guarddog`, `deps-updates` | reads (containered) | `lookup` posture: manifests parsed, registries queried, nothing run |
| `secrets-*`, `sast` (semgrep), `deps-jvm`, `sbom*`, `npm-audit`, `yarn-audit`, `deps-retire`, `deno-check`, the `*-detect` and `bin/*.mjs` scanners | reads | file, lockfile or git-metadata readers; `deno check` type-checks without evaluating |

Measured 2026-09-18 on this box: an executing lane with `egress: none` runs under the host sandbox at `isolation: full` and one with `egress: registry` at `fs-only`, so the demotion no longer fires for the declared lanes above — the container build is not needed while `sandbox-exec`/`bwrap` is available. Where the host tool is absent the row says so (`isolationReason`) and the demotion fires. That was the remainder;
until then their rows say `coverage: reduced` rather than claim an isolation they do not have.


## Deployment declaration — deploy.mjs

Each area in the fleet registry (`monitor/private/projects.json`) can carry a **`deploy` block** (hostnames, service, `public`,
`requiresAuth`, `authAt`). `node bin/deploy.mjs` turns declarations into a **cloudflared ingress
fragment** — dry-run by default; `--write` refuses `~/.cloudflared/` because writing where the
daemon reads *is* applying. **Declaration is split from authority**: no Cloudflare credentials,
no DNS mutation, no tunnel restarts — applying stays a human act (and `bin/commitwork.mjs`
executes manifest-supplied shell, so credentials here would sit one traversal away from it).
The central safety property: `public: true` + `requiresAuth: true` with no `authAt` is **refused** —
generated ingress carries no auth layer, so it must be impossible to accidentally publish an
auth-requiring origin. `authAt: 'origin' | 'edge'` names where the required layer lives and is the
only way to declare a published origin that authenticates itself.

`--verify` compares registry vs reality on five axes (declared / routed / dns / origin / tls),
exits 1 on drift, and re-checks `authAt` as an **attestation** — the origin is probed
unauthenticated with the public Host header (via `node:http`, because fetch silently drops the Host
header) and a 2xx is drift: the registry claiming a protection the service does not provide. For an
https origin, `origin` requires a completed, verified TLS handshake, and the TLS failure modes are
reported as their own states (`ORIGIN-TLS-*`, `CERT-EXPIRING`); an origin whose TLS did not verify
cannot attest `authAt` at all. The comparison lives in `monitor/deploy-state.mjs` so the panel's
Exposure view runs the same code.

## Evidence & reporting

| Tool | One line |
|---|---|
| `reconcile-findings.mjs` | Merge multi-pass audit findings + verifier `missed[]` into ONE deduplicated queue with provenance and disposition per entry; verified outranks unreviewed; surviving conflicts keep the higher severity AND record the conflict; exits nonzero while conflicts/unreviewed remain. Artifacts land in `evaluations/<audit>/`, which is a symlink into the private sidecar repository and gitignored here: versioned there, never in this tree. |
| `anchor-staleness.mjs`, `anchor-triage.mjs` | Does each queued finding still point at the code it was written about? `anchor-staleness` hashes the anchored line at the verified ref and at the current tree, exits 1 while an open entry has drifted, and only rewrites the queue under `--reanchor` / `--reverify-comment-only`. `anchor-triage` is read-only: it groups the anchor-changed rows by the commits that rewrote their line (`git log -S`), so one human verdict covers a commit-group; `CW_ANCHOR_STALENESS` names its input and `CW_ANCHOR_TRIAGE_ROOT` the repository whose history is searched (default this checkout, a fixture repo in tests). |
| `comment-schema.mjs` | One comment schema, gated: `fact: <claim> [/ <consequence>] [(expiry: <cond>, prev: <state>)]` on one line; the trailer is optional, and when present `prev` is from a closed set and the expiry is not a placeholder. **Grammar is hard-gated; block length is ratcheted** — `bin/comment-baseline.json` grandfathers the 88 files that carry a narrative comment run over 6 lines (reference blocks such as `usage:` and `env` are counted apart and never gated), because a hard gate would be red forever, and `--tighten` banks removals without giving them back. Keyed on path + count, never a line or a hash: a line drifts, and a hash changes the moment you edit the block you were asked to shorten. Rule of thumb the schema encodes — the file's name says WHAT it is, so a comment earns its line only by stating the counterfactual the code cannot. |
| `release-candidate.mjs`, `pre-publish.mjs` | `release-candidate` builds the public snapshot of a ref and checks it. It runs `git archive`, which honours `export-ignore`. It makes each `verified-against` stamp date-only and commits one unsigned root, taking the author and date from the source commit so the same ref always rebuilds to the same commit. It then gates the candidate: a blob witness, `pre-publish`, the private-name scan, `docs-doctor`, and `npm test` with an allowlisted environment, a scratch `HOME` and no sidecar. The verdict (`accepted` / `blocked` / `incomplete`, exit 0/1/2) is journalled to the sidecar. `pre-publish` settles findings and unscanned files only by reviewed rows in the sidecar's `release/reviews.json`, read from its `HEAD`. Finding rows are keyed by file, class and fingerprint, never by line; file rows by git blob hash. `--draft-reviews` prints the open rows. See [docs/SECRETS-SWEEP.md](../docs/SECRETS-SWEEP.md). |
| `validate-artifact.mjs` | `validate-artifact.mjs <schema-name> <artifact.json>` — validate a written artifact against its declared schema. Exists because two of the three unschema'd artifacts here are written by SHELL scripts that hand-build JSON, so they cannot call `validateAgainstSchema` directly; this WRAPS `monitor/registry.mjs`'s validator rather than adding a second one. **Fails closed at every step** — unreadable artifact, unparseable artifact and unreadable SCHEMA are all non-zero, because "could not check" exiting 0 is how a producer publishes on a check that never ran. Wired into `boot-harness.sh` and `lockfile-synth.sh` at their single `emit()` chokepoint; `gradle-wrapper-verify.mjs` calls `validateAgainstSchema` itself before it writes. |
| `lib/tracked-imports.mjs` | The repository-closure check behind `test/tracked-imports.test.mjs`: **a committed file may not reference something that is not committed**. `danglingImports()` catches a specifier resolving to nothing tracked; `missingExports()` catches the other half — a specifier that resolves while the *name* it imports does not exist, which is how a panel route landed three times and still could not boot. Reads **HEAD, never the working tree**: this tree always has sessions mid-edit, and a working-tree check fails on everyone's legitimate in-flight work and gets disabled within a day. Carries its own second witness — `vm.SourceTextModule` parses (never links, never evaluates, so `rollup.mjs` neither exits nor publishes) and cross-checks the extractor **in both directions**, with false negatives asserted separately from false positives because only one of those is the direction that lies. V8 covers STATIC imports only, so dynamic `import()` keeps a bounded scan; this tree has fifty of those and a wholesale swap would have gone blind to all of them. Unparseable is its own state, declared by name, so a new one fails loudly rather than dropping out of the walk and counting as clean. |
| `build-admin-panel.mjs` | Regenerates `admin/index.html` from `admin/panel.html` + `admin/menus/*` through `admin/lib/panel-document.mjs`, atomically. Run after editing any panel component; `admin/test/workspace-navigation.test.mjs` fails until the entry matches its sources. |
| `daily-run.mjs` | The /daily report for a monitor area (`monitor/private/daily.json`): builds `commitwork.daily-digest/1` from the area's newest complete full-lane sweep against the previous one (`monitor/daily.mjs`; data-path findings counted, secrets never read, unmeasured findings carried rather than fixed), runs `claude -p` with no tools, no MCP servers, no settings and the spine `/daily` skill as system prompt under `--json-schema schema/daily-suggestions.schema.json`, validates the answer against the digest (`monitor/daily-validate.mjs`; one retry with the refusals), writes `reports/<out>/daily/<batch>.json` in `commitwork.daily-report/1`, and files p0-p2 suggestions as veld todos from a ledger (`monitor/daily-todos.mjs`). Run every 30 minutes by `com.portll.commitwork-daily`; a batch already reported is not sent again. `--digest-only`, `--suggestions <file>` (interactive /daily), `--status`. Report mode: nothing edits a scanned repository. |
| `docs-doctor.mjs` | explicit uncertainty for the documentation itself: green (fresh `verified-against` stamp) / orange (needs updating) / grey (unknown). Gates on the README doc index both directions. Diff-driven: 2KB bounded head reads + an (mtime, size) facts cache, so unchanged docs are never reopened and a 272KB ledger costs the same as a 10-line README. |
| `disregard.mjs` | The disregarded-warning register (`monitor/disregarded-warnings.mjs`). `record` sets a warning aside with why/who/when, keyed on `{source, code, subject}` (never a line or the message) and labelled in the fatigue ledger; `check --warnings <file>` or `check --from docs-doctor` reports each warning as fresh, RETURNED (set aside before, back again, with the judgment beside it) or unidentified. Private record `monitor/private/disregarded-warnings.json` (`CW_DISREGARDED_WARNINGS`; absent means nothing set aside; `monitor/disregarded-warnings.example.json` shows the shape). |
| `lib/brief.mjs`, `lib/brief-tui.mjs`, `lib/scan-target.mjs` | `commitwork brief`. `buildBrief()` reads one scan run (its `scan.json` cells, the dependency rows `monitor/dep-findings.mjs` parses, each issue lane's extractor) and ranks it: dependency upgrades grouped per package with KEV advisories first (then severity, EPSS, CVSS), the other lanes with open findings, findings suppressed in source counted apart, advisories on undeclared versions held as undetermined, and every lane that did not measure. Text, Markdown and self-contained HTML renderers; same run, same bytes. `brief-tui.mjs` is `--tui`: the same four lists (fixes, findings, undetermined, not measured) browsed with a detail pane, drawn by a pure `renderScreen()` with scanner text stripped of control characters before it reaches the terminal; off a terminal, `--tui` prints the text brief and says why. `scan-target.mjs` is what a scan may be pointed at, shared with the panel's scan-path route: credential stores, the checkout and system directories refused on both spellings, `scanOutDir()` (private output, never `reports/`), and `discoverPcRepos()` for `--pc`, which excludes stores, checkouts and every output root and sets collections aside. |
| `lib/sarif-export.mjs` | `commitwork sarif [--from <run dir>] [--out <file>]`, and `--sarif` on `scan`/`brief`: a finished run's findings as SARIF 2.1.0, one log per repository (`<run dir>/<repo>/commitwork.sarif`, or one file with `--out` for a single-repository run) for SARIF viewers and GitHub code scanning. Reads what the brief reads (dependency rows and each issue lane's extractor rows). Only a measured crit/high/med/low finding is a `result` (crit/high → `error`, med → `warning`, low → `note`), with a repo-relative location and `partialFingerprints` from the issue store's line-free identity; undetermined rows go to `runs[].properties.commitwork.undetermined` with their original claim, and voids, degraded lanes and capped rows to the invocation's `toolExecutionNotifications`. A `run` directory has no `scan.json`, so a lane that wrote no report takes its cell from the `checks-status.json` the run left: `noscan`, or `fail` with no report, becomes a void the log names, and an unreadable status file is refused rather than read as every lane measured. `CW_NOW` pins the timestamp; same run, same bytes. |
| `lib/github-action.mjs` | The two decisions the root `action.yml` delegates. `tools <check\|group>` prints the catalogued scanners the selected lanes require, for `setup --only`. `report <sarif> <run exit> <export exit> <fail-on> <fail-on-unmeasured>` reads the SARIF, sets the step outputs, writes the job summary and the annotations (escaped, so scanner text cannot start a second workflow command), and decides `failed`: a result at or above `fail-on`, an unmeasured lane under `fail-on-unmeasured`, exit 1 or 2 of `commitwork run`, a failed export or a missing SARIF. |
| `projectstatus.mjs` | Regenerates `monitor/private/PROJECTSTATUS.md` (sidecar) + `reports/projectstatus.html` (self-contained, one-click print-to-PDF): fleet rollups age-honest, doc health, CRA state. |
| `digest.mjs` | `digest.mjs [--since <iso>] [--json] [--write]`: one summary over a window (default the 24 hours before `CW_NOW` or now) in three sections. **Severity crossings** are issue-store events (`CW_ISSUES`) that took an issue into crit/high, reopened one there, or raised it a band; an area whose last ingest predates the window is listed as not measured. **Ratchet breaches** are `gate-ratchet` and `gate-tests` journal records (`CW_VERDICT_DIR`) over their floor, one row per metric or verdict with peak value and whether it still stands; deferred, degraded and undetermined runs are counted apart. **Failed work** is read from the sweep verdict journals under the reports root (`CW_REPORTS_ROOT`): scans that did not run, missing repositories, unpublished rollups, refused issue ingests, broken memory-layer exports, failed canary and finalize steps, failed or timed-out fleet areas, and in-flight markers whose pid is dead. Each section names its inputs; an absent or unreadable input, or one with nothing recorded in the window, is printed as `not measured: <reason>`, never as an empty list. Output is markdown or `commitwork.digest/1` JSON with per-section `headline`s and a `digestId` (sha256), so a delivery step can send it without re-reading stores. `--write` adds `reports/digest/digest-<end>.{json,md}`, written atomically. Exit 0 every section measured, 2 usage, 20 a section not measured (the digest is still printed). |
| `digest-deliver.mjs` | `digest-deliver.mjs [--file <digest.json>] [--dry-run] [--json]`: sends a written `commitwork.digest/1` (default the newest `reports/digest/digest-*.json`) to a Slack incoming webhook (`CW_DIGEST_SLACK_URL`) and/or a generic JSON webhook (`CW_DIGEST_WEBHOOK_URL`), both read from the environment at call time. The digestId is recomputed first and an edited file is refused. Slack gets text blocks only, one per section with its headline and, for a section not measured or partly measured, the reasons; mention and link syntax is escaped and nothing in the message is interactive. The generic webhook gets the digest file's bytes unchanged with an `x-commitwork-digest-id` header. Only the HTTP status decides the outcome: the response body is never read, redirects are not followed, each request is bounded by `CW_DIGEST_TIMEOUT_MS` (default 10000, clamped to 1000-60000), and plain `http` is accepted only for loopback. A webhook URL carries its token in the path, so output and the ledger show scheme and host only. The ledger `reports/digest/deliveries.json` is keyed by digestId and destination, written atomically under a lock after each request, so a re-run does not post a pair already delivered and does retry a failed one; a failure is recorded with its status and reason. `--dry-run` prints the payloads and posts nothing. Exit 0 every configured destination delivered (now or earlier), 20 a delivery failed, 21 no destination configured, 22 digest or ledger refused, 23 usage. |
| `taxonomy-web.mjs` | Regenerates the taxonomy draft page in the private docsite root (`monitor/private/docsite/imported/taxonomy.html`, see `lib/docsite-roots.mjs`), the readable edition of the failure taxonomy: the argument, every class, and the one thing no edition of the taxonomy has carried — its own version history, joined from `monitor/taxonomy-editions.json`. **Refuses to publish a lineage that does not account for exactly the classes the registry holds**: a claimed class the registry lacks, a class claimed twice, or a declared total that disagrees with the ids beneath it exits 2 and writes nothing. A class no edition claims is not an error and is never folded into the newest edition — it renders in its own block and fails `--check`, which is the normal condition of a registry that grew six classes without its version moving. Brand tokens and nav are read from `lib/docsite-page.mjs` and `docsite/manifest.json`, so the page carries the docsite's own palette rather than a second brand kit. Compare `taxonomy-render.mjs` (the class reference, published separately at `/taxonomy-reference/`, for a reader who wants the row) and `taxonomy-db.mjs` (the sqlite projection, for a reader that is a program). |
| `build-security-data.mjs` | `rollup.json` → machine-generated counts injected into report md — counts cannot drift from the scan of record. |
| `render-report.mjs` | Zero-dep Markdown → self-contained themed HTML (prints cleanly to PDF). |
| `md-view.mjs` | `md-view.mjs <file.md> [--out <file.html>] [--no-open]`: renders any Markdown file as one self-contained HTML page in the house palette and opens it. The page has a contents rail and a light/dark toggle, and draws the design values the document states. Colours become swatches. `--tokens` declared in a Dark/Light table resolve wherever they are named, and each contrast ratio gets its WCAG grade. Shadows, font stacks, type sizes, weights, tracking, radii, padding, spacing steps, durations, opacities, line heights and measures render as what they describe. A column or section heading decides what a bare number means. A ```lockup fence holds panel markup, which is sanitised against an allowlist and drawn twice, dark and light, with the panel's own stylesheets scoped under each container (`CW_MD_VIEW_ADMIN_DIR`). Fonts and local images are inlined; remote images are never fetched. Every drawn value is a generated class in one hashed `<style>`, so the page runs under a CSP with no `'unsafe-inline'`. Written to `reports/md-view/<path>.html` (`CW_REPORTS_DIR`). The parser is its own (`lib/md-view.mjs`): `lib/render-markdown.mjs` ends a list item at its first wrapped line and is held to docsite parity, so it was not widened. |
| `parse-runtime.mjs` | One parser for DAST/BOLA reports feeding both the rollup and `runtime.html`. |
| `mainline-data.mjs`, `slices.mjs` | Sitemap history harvesters (git-graph DAG; versioned state slices). |
| `init.mjs` | First-run state: `monitor/private/` (or a directory link to `--private-dir`), a schema-validated fleet registry, `~/.commitwork`; reports each optional private record. Idempotent; refuses rather than overwrites. |
| `setup.mjs` | Cross-platform scanner installer (argv-array spawns, re-probes after install; never prompts non-TTY). |
| `cobolwork-pin.mjs` | Installs, checks and bumps the cobolwork release `manifests/tool-pins.json` pins (`schema/tool-pins.schema.json`). `--install` (`--from <tgz>`, `--dry-run`) takes the asset through `gh release download`, refuses bytes whose sha256 is not the pin's before extracting anything, accepts only files and directories under `package/`, requires `lib/revision.json` to state the pinned commit and `capabilities --json` to state schemaVersion 1, identity `cobolwork/v1`, the pinned version and the release at that commit, then renames the staged tree into `$CW_TOOLS_ROOT/cobolwork/<version>` (default `~/.commitwork/tools`); a verified install is left alone. `--check` (the default) verifies the install and exits 1 until it does. `--latest` rewrites the pin from the latest release's asset digest and tag commit and prints the change; it installs and commits nothing, so an upgrade is a reviewed commit of the pin. `lib/cobolwork-resolve.mjs` is the one resolver the lanes (through `CW_TOOL_COBOLWORK`), the bridge, setup, posture and the provenance stamp read: `CW_COBOLWORK_BIN`, else the verified install, else unavailable naming the install command; never PATH. |
| `lib/theme.mjs` | The commitwork terminal theme: one palette for every CLI surface, so a sweep read in a terminal and the same sweep read in the panel's live console (which renders the ANSI output as HTML) are coloured identically. It is not the panel's own palette: of the ten names it shares with `admin/static/panel.css` `:root`, only `live` and `part` carry the same value (the accent is orange `#e8730c` here and gold `#c9a227` there), so a state's terminal colour and its colour elsewhere in the panel differ. `test/theme-palette.test.mjs` pins which names agree. Semantic exports (`STATUS.pass`, `fail`, `noscan`, `blocked`, `skipped`, `na`) rather than colour names, so a palette change is one file. Colour follows the TTY: `NO_COLOR`/`CW_NO_COLOR` always wins, and `FORCE_COLOR` opts a piped stream in (which is how the admin panel captures a themed sweep). Truecolor because commitwork orange has no faithful ANSI-16 equivalent — and because ANSI-16 could not distinguish `skipped` from `noscan`, which is a distinction the house rule turns on. |
| `secrets.mjs` | Declare, inspect and gate on credentials held in the **macOS Keychain**, or in a config file another tool already owns. `~/.commitwork/secrets.json` stores only POINTERS (`keychain:<service>/<account>`, or `file:<absolute path>#<key>`), never values. The `file:` backend was added 2026-09-04 because the keychain one is macOS-only, so on Windows and Linux this module resolved NOTHING — every declared secret came back `unsupported-platform`, which is a whole platform on which the loud-void machinery below never got a value to be loud about. It is deliberately the WEAKER backend and says so: a file has no ACL prompt and no per-process authorisation, so the guarantee is only that the value stays out of argv, out of logs and out of the ref table — `list` names the backend each secret stands on. Paths must be absolute (a relative ref means a different file per cwd), and it is not a TOML parser: it reads the first `key = value` line and knows nothing about sections. `set` shells out to `security add-generic-password -w` with no value so the secret is *typed*, never passed in argv; `list` prints names/refs/resolvability and never a value; `check` exits 1 on any unresolvable declaration, so it gates. There is deliberately **no `get`** — a command that prints a credential puts it in scrollback. Missing secrets are LOUD and their reasons distinguished (`not-found` vs `locked` vs `undeclared`), because a headless launchd job that cannot answer a keychain prompt fails exactly like an absent one. See [lib/secrets.mjs](../lib/secrets.mjs). |

## The commit path — format-phase.mjs and commit-phase.mjs

Both exist because **eight sessions share one working tree and one `.git/index`**. Neither infers
its scope: the caller declares the exact paths it is committing, and everything outside that
declaration is counted and named but never touched. "Whatever is staged" is another session's
staging as often as it is yours.

| Tool | One line |
|---|---|
| `format-phase.mjs` | Pre-commit whitespace conformance (git's own: trailing space, one EOF newline) over **declared** paths only, never a style pass. Refuses any file carrying staged *and* unstaged hunks — the observable proxy for "a writer holds work here" that needs no session-identity oracle, which the attribution ledger cannot supply. Markdown keeps line interiors verbatim (trailing double-space is a hard break); fixtures, binaries and unreadable files are refused by name. `--write` restages exactly what it formatted, so nothing formatted lands unverified. |
| `commit-phase.mjs` | Commits through a **per-session index** at `$GIT_DIR/index.<session>` (remediation #1 / register R1), so `git add` stops racing the shared one. Three parts, and the register is explicit that the first alone is worse than nothing: a private index, `read-tree HEAD` into it immediately before landing, and a **refusal if HEAD moved since** — a private index built from an older HEAD carries the old blob for every path another session just committed, so landing it reverts their work behind a clean-looking diff. The refusal is a compare-and-swap (`update-ref <ref> <new> <old>`), not an `if`, because check-then-act leaves exactly the gap the co-session lands in. Stricter than `git commit -- <paths>`, which re-reads the **working tree** at commit time and so still takes a co-session's writes (measured 2026-08-22 at a commit: 34 lines, then 40); here content is frozen by `git add` into the private index and the commit reads the index. Repairs the shared index for the declared paths afterwards, or the next session reads them as staged-in-reverse. Every commit it writes (a land, `--from-blob`, each `--onto` replay) also stamps `package.json` at the parent's version with the patch bumped; a change set that carries `package.json` keeps its bytes at the higher of its own version and that bump, a parent without `package.json` gets no stamp, and one that is unparseable or not semver refuses the land. The checkout's `package.json` then follows HEAD: fast-forwarded, three-way merged over a peer's uncommitted edit, or left alone and named when they conflict. Decisions live in `commit-phase-core.mjs`; `test/commit-phase-e2e.test.mjs` carries the second witness — it *performs* the naive revert rather than asserting it, so the guard cannot outlive the harm. |

Neither is a clearance to commit: a file can be individually clean and still import something
untracked. Closure over the change set is `test/tracked-imports.test.mjs`, which reads HEAD.

The message is refused before any index work, by `lib/conventional-commit.mjs`: subject
`<type>(<scope>): <description>` within 72 characters, type from `DEFAULT_TYPES`, a description
that opens with a lower-case imperative verb from `lib/imperative-verbs.mjs` (`fail patches that
delete the flagged line`, not `the gate fails a patch`), scope from `DEFAULT_SCOPES` with at least
one declared path under the scope's prefixes, and no prose tell anywhere in subject or body. The
scope set and the tells belong to a rule set, which `git config commitwork.rules` names per
repository (`RULE_SETS`; unset is commitwork's own): cobolwork, ironwork and cobolwork-web take any
scope, and cobolwork and ironwork skip the shouting tell, which fires on COBOL syntax.
`commit-msg.mjs` applies the same rules to a bare `git commit` as the repository's `commit-msg`
hook, and refuses a `Co-Authored-By` trailer there too; `install-commit-msg.mjs` installs it and
records the rule set, and `monitor/install-git-hook.mjs` installs it here. The tells are `lib/prose-tells.mjs` (em dash and dash splices, `, so`,
`just`, adverbs about the author, hedges, shouting, session names, inflated words, `land`, loose
`shape`, text about the text, not-X-but-Y). The same module has a `comment` surface that adds dates,
history, `because`, a second colon and the old trailer; no gate consumes it yet, and
`comment-schema.mjs` does not import it. Widening any of the sets is a commit to the module, never an
env var.

A commit made with a plain `git commit` instead fires the repository's `post-commit` hook, which
starts a background self-sweep in the main checkout. The hook exits in a linked worktree; for a hook
installed before that guard, prefix worktree commits with `CW_SELF_SWEEP=0`
([docs/TRAPS.md](../docs/TRAPS.md)). `commit-phase.mjs` writes its commits with `git commit-tree`,
which runs no hooks.

## A pre-commit hook for any repository — hook.mjs

`commitwork hook install [--repo <path>]` writes a `pre-commit` hook into any git repository, at
the path git itself reports (`rev-parse --git-path hooks`, so `core.hooksPath` is honoured). The
hook runs `hook.mjs run`, which checks the **index**, the content the commit is built from, never
the working copy: it inherits `GIT_INDEX_FILE`, so `git commit -a` and `git commit <paths>` are
checked through their temporary index.

| Lane | What runs |
|---|---|
| `secrets` (default) | `secrets-sweep.mjs`'s rules over each staged blob read with `git cat-file --batch`. A secret whose fingerprint (class + span, never the line) is already in the pre-image is reported as already in HEAD and does not block unless `--block-existing`. SENSITIVE-CONTEXT is reported; `--fail-on-context` blocks on it. Matches are redacted in the output. |
| `gitleaks` (opt-in, `--lanes secrets,gitleaks`) | `gitleaks git --pre-commit --staged --redact` with `--exit-code 20`, because its default 1 is also its error code. `CW_GITLEAKS` names the binary. |

A lane that cannot run (scanner missing, git failure, an unreadable report) is never reported
clean: `--unrun block` (the default) refuses the commit with exit 21, `--unrun warn` lets it through
labelled ALLOWED UNCHECKED. Findings exit 20. An existing hook commitwork did not write is refused
(exit 22) and left untouched; `--chain` moves it to `pre-commit.commitwork-chained` and runs it
after the check, and `hook uninstall` puts it back. The installed hook refuses the commit if node or
`hook.mjs` has gone. Nothing in the target repository executes: a repo-local `commitwork.json` is
never read. `.pre-commit-hooks.yaml` at the root exposes the same check to pre-commit.com as
`commitwork-secrets`.

## The test entry point — test-run.mjs

`npm test` runs `node bin/test-run.mjs`, not `node --test` directly. It runs the suite serially
(`--test-concurrency=1`) over the module test globs, or over the paths you pass it, with every env var
that redirects a write (`AMBIENT_OUTPUTS`: the perf-feedback, forensics and observables reports, the
chain-tips and slop-sweep stores, the panel code stamp, the sweep live log, the other job kinds'
`<kind>-latest.log` directory, the panel restart log and the sweep refusals journal) pointed into a
scratch directory unless the caller already set it. It fingerprints each live path before and after
(for the job-log directory, each `<kind>-latest.log` in it) and fails the run if one moved, whatever
the suite's own verdict, and it warns (never fails) on any other file under `reports/` or `.claude/`
that changed during the run, since a peer or a sweep may have written it. `npm run test:raw` is the
bare `node --test` form.

## Model providers — lib/model-provider.mjs

`lib/model-provider.mjs` is one chat interface over a local model server and, when the operator
configures one, a hosted API. `resolveModelProvider({ local })` picks the provider and
`chatComplete(provider, { messages, system, temperature, maxTokens })` makes the call. Local is the
default and first in `PROVIDER_ORDER`. A hosted provider is used only when `CW_MODEL_PROVIDER` names
it. Setting a key does not select one, and a hosted failure is reported, never retried against the
local server (or the reverse).

| Provider | Wire | Selected by |
|---|---|---|
| `local` (default) | OpenAI chat completions at `<server>/v1/chat/completions`; the server comes from the caller (`manifests/llm-hosts.json` and its `CW_LLM_URL_<HOST>` overrides). No key is sent. | nothing set, or `CW_MODEL_PROVIDER=local` |
| `openai-compatible` | `POST <CW_MODEL_BASE_URL>/chat/completions`, `Authorization: Bearer` when a key is set | `CW_MODEL_PROVIDER=openai-compatible` (or `openai`), plus `CW_MODEL_BASE_URL` (the API root, e.g. ending `/v1`) and `CW_MODEL_NAME` |
| `anthropic` | Messages API, `POST <base>/v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`; base defaults to `https://api.anthropic.com`, model to `claude-sonnet-5-5` | `CW_MODEL_PROVIDER=anthropic` |

| Env | Meaning |
|---|---|
| `CW_MODEL_PROVIDER` | `local` · `openai-compatible` · `anthropic`. Any other value is refused. |
| `CW_MODEL_BASE_URL` | API root for a hosted provider. Set without an API provider it is refused rather than guessed at. |
| `CW_MODEL_NAME` | Model id. Required for `openai-compatible`; overrides the Anthropic default; pins the local model. |
| `CW_MODEL_API_KEY` | The key for a hosted provider. Read from the environment at request time; never stored, logged or put in an error. |
| `ANTHROPIC_API_KEY` | Accepted for `anthropic` only while the base URL is Anthropic's own. An overridden base needs `CW_MODEL_API_KEY`. |
| `CW_MODEL_TIMEOUT_MS` | Bound on one call (default 600 s local, 300 s hosted). |

A key is sent only to the configured host. Redirects are not followed, a key is refused over plain
`http` to anything but loopback, and a base URL carrying credentials is refused. Requests go through
`node:http`, not `fetch`, because `fetch` drops a response whose headers take more than 300 s, and a
local model sends none until it finishes. Every result carries
`answeredBy: { provider, engine, model, host }`. `model` is the model the server says answered.
HTTP errors, non-JSON bodies, replies with no completion and empty answers all return
`{ ok: false, error, status }`. An empty answer has `code: 'empty-answer'` and keeps any reasoning
the model produced.

Callers that go through it: `issue-llm.mjs`. Its issue records now name `engine`, `model` and `host`
from `answeredBy`, so an API-answered triage is attributed to the API. Callers that still call a
local server directly: `admin/routes/codeql-remediation.mjs`, `admin/routes/issue-detail.mjs`,
`admin/routes/remediation.mjs`, `ab-loop.mjs`, `finding-analysis.mjs`, `rate-llm.mjs`,
`lib/cobolwork-remediation-engines.mjs` and `monitor/detection-reducer.mjs`.

## Issue tracker — issue.mjs and issue-loop.mjs

`issue.mjs` fronts [`monitor/issue-store.mjs`](../monitor/README.md#issue-tracker--monitorissuesjson):
a JIRA-shaped durable work queue with none of JIRA — atomic claims, derived ready-work detection,
and closes that demand evidence. Store format, hash chain and auto-close semantics are documented
in the monitor README; this is the operator surface.

| Command | One line |
|---|---|
| `new --area A --title T --sev S` | Mint a manual issue (`--repo`, `--kind`, `--body`, `--remediation`, `--authority-required`). |
| `list [--area A] [--state S] [--suspect] [--json]` | List issues; every listing states each area's last-ingest slice — an empty list for a never-ingested area reads "NEVER INGESTED (explicit uncertainty)", not clean. |
| `ready [--area A] [--limit N] [--json]` | Derived ready work: open ∧ unblocked ∧ unclaimed ∧ unwaived ∧ ¬authority-required, sorted crit-first then SLA due date. Never stored. |
| `show <id> [--json]` | One issue + its event trail. |
| `claim <id> --by NAME [--session SID]` | Atomic claim with TTL; a live claim by another session exits 5. |
| `release <id>` | Return a claimed issue to the pool. |
| `close <id> --as fixed\|accepted\|refuted\|superseded --evidence "…"` | A close without evidence is an assertion, not a closure — refused. Another session's unexpired claim blocks the close (`--force` is a human override, never the loop's). |
| `link <id> --blocks\|--duplicate-of\|--supersedes <id2>` | Dependency edges (cycles refused), duplicate/supersede closes. |
| `ingest --area A \| --all [--queue q.json] [--dry-run]` | Pull rollup findings + scanner rows into the store and run the evidence-gated auto-close table; exit 4 when evidence was stale or unscanned. |
| `verify` | Recompute the event hash chain + derived-state consistency; exit 3 on any break. |
| `gc` | Expired claims back to the pool, expired waivers surfaced. |

Exit codes: `0` ok · `2` usage / unknown id · `3` store verify failed · `4` stale or unscanned
evidence (the void is a state, not a pass) · `5` claim conflict.

| Env | Meaning |
|---|---|
| `CW_ISSUES` | Store path (default `monitor/private/issues.json`, gitignored; `CW_ISSUES_JSON` and `CW_ISSUE_STORE` are accepted too). |
| `CW_NOW` | Deterministic clock — every timestamp and SLA comparison honours it. |
| `CW_ISSUE_MIN_SEV` | Ingest files individual issues at/above this severity (default `high`); below it, findings group per repo×package. |
| `CW_ISSUE_STALE_HOURS` | Rollups older than this are refused as evidence (default 26). |
| `CW_ISSUE_GROUP_CATEGORIES` | Scanner categories ALWAYS grouped one-issue-per repo×category×rule (default `secretsHistory`). |
| `CW_ISSUE_GROUP_THRESHOLD` | A rule firing at/above this many rows in one slice groups regardless of category (default 5) — 638 live CodeQL rows file as 13 rule-issues. Identity is sticky both ways, so a triple never flips between grouped and individual. |
| `CW_ISSUE_CLAIM_TTL_HOURS` | Claim lifetime before `gc` returns it to the pool (default 4). |
| `CW_ISSUE_AGENT_CMD` | The loop's agent-spawn seam (below). The default `claude -p` runs with default permissions and CANNOT edit files — the first live run blocked on exactly that. For a loop that actually fixes things: `CW_ISSUE_AGENT_CMD="claude -p --permission-mode acceptEdits"`. |

`issue-loop.mjs` is the headless remediation driver over the same store: pick ready work, claim
it, spawn an agent per issue (`CW_ISSUE_AGENT_CMD`), release on exit. **Dry-run is the default**
— it prints what it would claim and spawns nothing until `--apply` is passed. It refuses to run
on stale evidence (the ingest staleness gate, exit 4) and **never closes issues itself**:
evidence-gated auto-close happens at ingest, and manual closes stay a human act with `--evidence`
in hand.

`issue-rekey.mjs` declares the tenant and migrates flat `ISS-000000` ids to org- and class-scoped
`ISS-<ORG>-<CLASS>-<SUFFIX>` (`--org PORTLL` to preview, `--write` to apply). It is a **migration,
not a rename**: the store is an append-only hash chain whose hashes cover each event's `issueId`,
so rewriting past events would force the chain to be recomputed — and a chain recomputed at will
proves nothing. Instead it only appends: historical events keep their ids and still verify, each
issue records `priorIds`, an `issue-updated` event carrying `rekeyedFrom` enters the chain as
evidence, and `aliases{}` keeps every historical id resolvable. It refuses (exit 3) a chain that does
not verify before or after, a store already declared for another org, and any issue it cannot
classify; lock contention is exit 4. Declaring an org is optional: `--org` defaults to `PERSONAL`,
and a store with no declared org mints `ISS-PERSONAL-<CLASS>-<SUFFIX>`.

Two further one-shot migrations follow the same rules — dry-run by default, `--write` under the
issues lock, the chain and identity checks gating the save, idempotent on a second run:

- `issue-rekey-depsretire.mjs` moves `gs:<repo>|<category>|undefined` group keys (the rule-less
  lanes: `depsRetire`, and via `--category` `cspm`, `supplyChainPosture`, `accessibility`) onto
  identity-bearing keys derived from the repo's latest scan rows; an ambiguous record is refused
  unless `--split` is given.
- `issue-retire-cobolsecurity.mjs` carries the open issues of the retired `cobolSecurity` category
  (the `sast-cobol` lane, removed as a duplicate of `sast-cobol-cobolwork`) onto `sastCobol` keys.
  A record whose target key is already held by an open `sastCobol` issue closes as `superseded`
  with `duplicateOf`; one whose target is held by a closed issue, or that another session has
  claimed, is refused and listed. It refuses to run while `cobolSecurity` is still registered in
  `SCANNER_SPECS`.

`--issue <id>` pins a run to one issue rather than the severity-ordered head — it
narrows the selection and never overrides a refusal, so a pinned issue that is blocked, claimed
or authority-gated is still declined. It exists for the shared-tree case: when the top issue
anchors in a file another session is editing, work a quieter one instead of blocking the queue
to reach it.

Tests: `node bin/test-run.mjs 'bin/**/*.test.mjs'` (part of `npm test`). Quote the glob; a bare
`node --test bin/test/` resolves the directory as a module and fails on Node 26
([docs/TRAPS.md](../docs/TRAPS.md)).
