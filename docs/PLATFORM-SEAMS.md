<!-- verified-against: 2026-10-08 -->
# macOS-only seams

Every place tracked source depends on macOS, grouped by seam class, with the portable path that
already exists or the limit that stands in for one. A seam with no Linux or Windows path is a stated
limit, not a gap that reads as support.

## How this is measured

```sh
node bin/lib/platform-seams.mjs . --files
```

Population: tracked `.mjs .cjs .js .sh .bash .zsh .py .ts` files outside `test/` directories (740
on 2026-10-08, all read). Whole-line comments are skipped, so a hit is code or a string literal
rather than prose about a seam; `users-path` is the exception and counts comments too, because a
home path in a comment discloses as much as one in code. A `zsh` line that also names `bash`, or a
`macos-tools` line that also names `python`, `perl`, `ruby` or `node`, is an interpreter name list
used for classification and is not counted. The regex per class is in `bin/lib/platform-seams.mjs`
(`SEAM_CLASSES`).

Measured 2026-10-08:

| Class | Files | Lines | What it matches |
|---|---:|---:|---|
| `launchd` | 10 | 40 | `launchctl`, `LaunchAgents`/`LaunchDaemons`, plist schedule keys |
| `keychain` | 7 | 14 | spawning `security`, `security find-/add-/dump-…`, `keychain:` refs, `osxkeychain` |
| `zsh` | 1 | 2 | zsh shebangs, `'zsh'` literals, `.zshrc`/`.zprofile` |
| `users-path` | 3 | 3 | `/Users/<name>` |
| `homebrew` | 20 | 46 | `/opt/homebrew`, Cellar, `brew <subcommand>`, `'brew'` literals |
| `sandbox-exec` | 1 | 3 | `sandbox-exec` |
| `macos-tools` | 10 | 37 | `sw_vers osascript xcrun codesign plutil softwareupdate xattr`, `open -a`, BSD `sed -i ''` |

`bin/test/platform-seams.test.mjs` re-measures on every suite run and fails when a class appears
in a file the [allow-list](#ratchet-allow-list) does not name, or when a listed file no longer has
the seam. Line counts inside a listed file are not pinned: they move with ordinary edits.

## Linux, as packaged

Linux has no seam of its own in the table below; what it lacks is listed there as each macOS
seam's limit. It has two install paths, both described with their limits in
[container/README.md](../container/README.md). `bin/install.sh` is POSIX `sh` and installs a
checkout's HEAD or a release tarball checked against its SHA-256. `container/Dockerfile` builds a
Debian 12 image with bwrap, pasta and seven scanners, and sets `CW_SANDBOX=require`. Without
`--security-opt seccomp=unconfined` its host lanes are refused as `noscan` rather than run
unconfined, and without `--device /dev/net/tun` so are the lanes with network egress. `.github/workflows/container.yml`
builds it on `ubuntu-latest` (amd64) when the container files change, runs its smoke test, and fails if any
lane ran unconfined; it was also built and run on Docker Desktop for arm64.

## launchd

| Files | What it does | Portable path or limit |
|---|---|---|
| `monitor/install-agents.mjs` | Generates and loads the per-area sweep, liveness and watch agents (plists, `launchctl bootstrap/bootout/print`) | **Limit.** Refuses on non-darwin and says to run the same commands from systemd user timers or cron. No unit generator exists. Portable alternative: a `systemd --user` `.service` + `.timer` pair per agent with `OnCalendar=` taken from the same schedule, or one crontab line per agent. For example, the daily evidence refresh (`com.portll.commitwork-cra-refresh`, 06:30) maps to `OnCalendar=*-*-* 06:30` or `30 6 * * * node cra/refresh.mjs`; its freshness reader (`cra/evidence-status.mjs`) is portable and reports the pack stale whichever scheduler stops. The daily docsite publish (`com.portll.commitwork-docsite-publish`, 07:00) maps to `OnCalendar=*-*-* 07:00` or `0 7 * * * node bin/docsite-publish-scheduled.mjs`, with `CW_WRANGLER`, `CW_DOCSITE_PROJECT` and `CW_CLOUDFLARE_ZONE_ID` set in the unit's `Environment=` or the crontab; the script itself is portable and `--status` reads its ledger under any scheduler |
| `monitor/service-health.mjs`, `bin/agent-surface.mjs`, `admin/static/panel-settings.js` | Ask `launchctl print gui/<uid>/<label>` whether a job is loaded; the panel shows `launchctl` in place of a toggle for launch programs | service-health already records a failed or missing `launchctl` as `null` (unknown), never as "not loaded". Portable alternative: `systemctl --user is-active <unit>` |
| `admin/routes/rollups.mjs`, `bin/adjudication-sampler.mjs` | Read schedules from installed plists: when each area runs next, and the liveness cadence the deadman check measures lateness against | Env-overridable (`CW_AGENT_DIR`, `CW_LIVENESS_PLIST`). A missing plist reads as `absent` or lateness undefinable, never on time. On Linux both stay that way until schedules are read from timers |
| `admin/lib/spine-preconditions.mjs` | Checks the supervisor plist for the overwatch layer | Already returns `not-applicable` off darwin; `CW_LAUNCH_AGENTS_DIR` overrides the path |
| `bin/panel-local-name.mjs` | Writes install scripts for `commitwork.local` using a pf anchor and a LaunchDaemon | **Limit: macOS only.** Portable alternative: an nftables/iptables redirect, or `setcap cap_net_bind_service` on the panel's node |
| `monitor/persistence-diff.mjs` | Watches LaunchAgents/LaunchDaemons as persistence surfaces | Portable already: a Linux surface set (systemd units, cron, profiles) is selected by platform |
| `bin/deploy.mjs` | Lists `~/Library/LaunchAgents` among paths it refuses to write | Protective, not a dependency. The same list carries `/etc/cloudflared` for Linux |

## Keychain

| Files | What it does | Portable path or limit |
|---|---|---|
| `lib/secrets.mjs` | Resolves `keychain:<service>/<account>` refs with `security find-generic-password` | Portable already: the `file:<absolute path>#<key>` backend works on every platform, and a keychain ref off darwin returns `unsupported-platform` instead of an empty value |
| `bin/secrets.mjs`, `bin/addsecret.mjs` | `set` stores a value with `security add-generic-password` | `set` refuses off darwin; `secrets ref NAME file:…` records a file-backed ref on any platform. A libsecret (`secret-tool`) or `pass` backend would be a third `REF_RE` form |
| `monitor/archive-batches.mjs` | Keeps the archive encryption key in the login keychain | **Limit: macOS only.** No fallback is read. Portable alternative: resolve the key through `lib/secrets.mjs` so a `file:` ref works |
| `monitor/credential-scope.mjs` | Parses `security dump-keychain` to inventory stored items | Returns `null` off darwin (unknown, not empty); `CW_CRED_DUMP` supplies a fixture |
| `monitor/journey.mjs` | Names `bin/secrets.mjs set <NAME> keychain:<service>/<account>` as the credentials step of the guided setup | Text only. The step is optional, and `secrets ref NAME file:…` records a file-backed ref on any platform |
| `monitor/images.mjs` | Names `docker-credential-osxkeychain` in a fix hint | Portable already: the hint is chosen per platform, with a Linux line for `secretservice`/`pass` |

## zsh

No tracked script needs zsh. Of the 19 tracked `.sh` files, 18 start `#!/usr/bin/env bash` (13),
`#!/bin/bash` (2) or `#!/bin/sh` (3), and `bin/lib/docker-config.sh` is sourced and declares
`shell=bash`. The one counted file,
`monitor/persistence-diff.mjs`, watches `.zshrc` and `.zprofile` as persistence surfaces beside
`.bashrc` and `.profile`; that is observation, not a dependency. Interpreter name lists that include
`zsh` beside `bash` (`bin/agent-config.mjs`, `monitor/process-ancestry.mjs`) are not counted. The zsh
material in [TRAPS.md](TRAPS.md) concerns the operator's interactive shell, not the product.

## `/Users/` paths

No tracked file names a real home directory. Every hit in source is a placeholder or a detector:
`bin/anchor-staleness.mjs` (`HOME_PLACEHOLDER = '/Users/username/'`, the redaction target),
`lib/launchlist-checks.mjs` (the regex that finds home paths for the launch checklist), and
`bin/session-roster.mjs` (a comment using the placeholder path). Outside source the same holds:
tests keep a home-shaped path only where the code under test is about home directories, with
synthetic names (`x`, `u`, `op`, `user`, `someone`, `operator`), and put repository, report and
tool paths outside any home (`/work`, `/srv`, `/opt`, `/tmp`). Lane-capability fixtures carry
`/src/fixture` for the home directory of the run that produced them. `monitor/failure-taxonomy.json`,
`docsite/*/taxonomy-reference.html` and `provenance/upstream-sources.chain.jsonl` carry
`/Users/username/…`, the redacted form. Re-run with
`git grep -I -o -h -E '/Users/[A-Za-z0-9_.-]+' | sort | uniq -c`. Nothing needed an
`os.homedir()` fix. The launch checklist's `absolutePaths` check is the gate that keeps it so.

## Homebrew

| Files | What it does | Portable path or limit |
|---|---|---|
| `bin/setup.mjs`, `admin/routes/scanners.mjs`, `lib/launchlist-checks.mjs` | Treat brew as one installer among several | Portable already: setup tries `brew pipx npm cargo gem composer go`, plus `release apt dnf` on Linux |
| `bin/commitwork.mjs`, `bin/races.mjs`, `bin/tls-headers-scan.mjs`, `bin/scorecard-scan.sh` | `brew install X` in a not-installed message | Text only. The tool is found on `PATH` whatever installed it |
| `monitor/package-inventory.mjs`, `monitor/update-vulns.mjs`, `monitor/app-inventory.mjs`, `admin/routes/packages.mjs` | Inventory and upgrade lanes for brew formulae and casks | A missing `brew` is `unavailable`/`absent`, never "up to date". **Limit:** no apt/dnf counterpart lane |
| `monitor/install-agents.mjs`, `monitor/detection-reducer.mjs`, `sitemap/harvest.mjs`, `bin/hermetic-test.mjs` | `/opt/homebrew/...` in binary candidate lists | install-agents is darwin-only (above). The other three also list `/usr/local` or Linux paths, or take an env override |
| `admin/routes/journey.mjs` | `/opt/homebrew/bin` among the directories the guided setup searches for a tool installed off `PATH` | The list also holds `~/.local/bin`, `~/.cargo/bin`, `~/go/bin` and `/usr/local/bin`, and `CW_JOURNEY_INSTALL_DIRS` replaces it |
| `bin/lib/sandbox.mjs` | `/opt/homebrew` in the macOS read allow-list | Used only in the darwin profile |
| `bin/deploy.mjs` | `/opt/homebrew/etc/cloudflared` among refused write paths | Protective; `/etc/cloudflared` is listed beside it |
| `joernwork/bin/fix-local-joern.sh` | Finds joern via `brew --prefix` | `JOERN_PREFIX` overrides it |
| `monitor/images.mjs` | Brew in the macOS fix hint | Per-platform hint (see Keychain) |

## sandbox-exec

| Files | What it does | Portable path or limit |
|---|---|---|
| `bin/lib/sandbox.mjs` | Builds the macOS Seatbelt profile that confines scanner lanes | Portable on Linux: the same entry point builds a `bwrap` argv. **Limit:** any other platform throws `no host sandbox for platform`, and the probe reports `available: false` |

## Other macOS tools

| Files | What it does | Portable path or limit |
|---|---|---|
| `monitor/update-vulns.mjs`, `monitor/package-inventory.mjs`, `admin/routes/packages.mjs` | OS update lane: `sw_vers`, `softwareupdate`, `plutil` | **Limit: macOS only.** A missing tool is `tool-failed`/`unavailable`, never clean. No Linux distro-advisory lane exists |
| `monitor/app-inventory.mjs` | App bundles: `plutil`, `codesign`, `xattr` quarantine | **Limit: macOS surfaces only.** A missing tool marks the surface absent |
| `admin/routes/remediation.mjs` | Opens VS Code with `open -a` and Terminal via `osascript` for a hand-off | `CW_OPEN`/`CW_OSASCRIPT` override the binaries. Portable alternative: `code <dir>` and the overwatch runner, which the route tries first |
| `bin/daily-run.mjs`, `monitor/images.mjs` | Desktop notification or popup through `osascript` | Best-effort. images reports `osascript not found` as such. Portable alternative: `notify-send` |
| `bin/md-view.mjs` | Opens a rendered page with `open` | Portable already: `cmd /c start` on win32, `xdg-open` elsewhere |
| `bin/codeql-swift-build.sh` | Runs `/usr/bin/xcrun swift build` for CodeQL's Swift extractor | **Limit: macOS only**, as CodeQL's Swift support is |
| `bin/panel-local-name.mjs` | BSD `sed -i ''` in the generated uninstall script | Part of a macOS-only tool (see launchd) |

## Ratchet allow-list

The files each class may appear in. The test parses this table; add a row in the same change that
adds a seam, and say in the sections above what the portable path is.

| Class | File |
|---|---|
| launchd | `admin/lib/spine-preconditions.mjs` |
| launchd | `admin/routes/rollups.mjs` |
| launchd | `admin/static/panel-settings.js` |
| launchd | `bin/adjudication-sampler.mjs` |
| launchd | `bin/agent-surface.mjs` |
| launchd | `bin/deploy.mjs` |
| launchd | `bin/panel-local-name.mjs` |
| launchd | `monitor/install-agents.mjs` |
| launchd | `monitor/persistence-diff.mjs` |
| launchd | `monitor/service-health.mjs` |
| keychain | `bin/addsecret.mjs` |
| keychain | `bin/secrets.mjs` |
| keychain | `lib/secrets.mjs` |
| keychain | `monitor/archive-batches.mjs` |
| keychain | `monitor/credential-scope.mjs` |
| keychain | `monitor/images.mjs` |
| keychain | `monitor/journey.mjs` |
| zsh | `monitor/persistence-diff.mjs` |
| users-path | `bin/anchor-staleness.mjs` |
| users-path | `bin/session-roster.mjs` |
| users-path | `lib/launchlist-checks.mjs` |
| homebrew | `admin/routes/journey.mjs` |
| homebrew | `admin/routes/packages.mjs` |
| homebrew | `admin/routes/scanners.mjs` |
| homebrew | `bin/commitwork.mjs` |
| homebrew | `bin/deploy.mjs` |
| homebrew | `bin/hermetic-test.mjs` |
| homebrew | `bin/lib/sandbox.mjs` |
| homebrew | `bin/races.mjs` |
| homebrew | `bin/scorecard-scan.sh` |
| homebrew | `bin/setup.mjs` |
| homebrew | `bin/tls-headers-scan.mjs` |
| homebrew | `joernwork/bin/fix-local-joern.sh` |
| homebrew | `lib/launchlist-checks.mjs` |
| homebrew | `monitor/app-inventory.mjs` |
| homebrew | `monitor/detection-reducer.mjs` |
| homebrew | `monitor/images.mjs` |
| homebrew | `monitor/install-agents.mjs` |
| homebrew | `monitor/package-inventory.mjs` |
| homebrew | `monitor/update-vulns.mjs` |
| homebrew | `sitemap/harvest.mjs` |
| sandbox-exec | `bin/lib/sandbox.mjs` |
| macos-tools | `admin/routes/packages.mjs` |
| macos-tools | `admin/routes/remediation.mjs` |
| macos-tools | `bin/codeql-swift-build.sh` |
| macos-tools | `bin/daily-run.mjs` |
| macos-tools | `bin/md-view.mjs` |
| macos-tools | `bin/panel-local-name.mjs` |
| macos-tools | `monitor/app-inventory.mjs` |
| macos-tools | `monitor/images.mjs` |
| macos-tools | `monitor/package-inventory.mjs` |
| macos-tools | `monitor/update-vulns.mjs` |
