# Operational traps — commitwork

<!-- verified-against: 2026-10-08 -->

Hard-won operational knowledge about THIS repository and the machine it runs on: the things that
are true, non-obvious, and have already cost someone a session. Every entry earned its place by
happening.

**This file is the source of truth.** It lived in `CLAUDE.md` until 2026-08-19, which made it
harness-local: invisible to anyone reading the repository, absent from a clone, ungated by
`bin/docs-doctor.mjs`, and unreviewable in a diff that anyone but an agent session would open.
`CLAUDE.md` now links here. That is the whole point — this knowledge is a property of commitwork,
not of the tool used to edit it, and it should travel with the repository and be held to the same
freshness gate as every other durable doc.

Two consequences worth stating, because they are the reason for the move:
- **Authority.** A stamped, indexed, gated doc can be cited. A private instruction file cannot.
- **Portability.** A clone gets this. A different agent harness gets this. A human gets this.

New entries belong here, not in `CLAUDE.md`. Refresh the `verified-against` stamp when you confirm
or change one.

## House invariants

These are stated in full in [CLAUDE.md](../CLAUDE.md#house-invariants--apply-them-to-anything-you-write-here)
and are not duplicated here — an invariant restated in two places drifts in one of them, which is
this repository's own recorded failure mode (`SCANNER_SPECS` / `SCANNER_CHECKS` / `ROW_SCHEMAS`,
guarded by two tests precisely because it happened).

## Traps

- **CLOSED 2026-08-24 — there are no committed launchd plists any more.** This entry warned that
  the tracked plists were superseded templates. All three (`monitor/com.portll.commitwork-monitor
  .plist`, `monitor/com.portll.commitwork-liveness.plist`, `cra/com.portll.commitwork-cra-watch
  .plist`) were deleted in a commit on 2026-07-30 — three weeks before this file was moved out of
  `CLAUDE.md`, so it arrived here already describing files a clone does not carry. The rule that
  outlives them: launchd expands neither `~` nor a login shell's `PATH` in `ProgramArguments`, so a
  plist cannot be written portably and has to be GENERATED per machine. `node
  monitor/install-agents.mjs` is the only correct source. Any `.plist` you find under this tree is
  a stale copy in a `.claude/worktrees/` checkout, not a template to install.
- **memory-layer listens on 3030, and the health path is `/health` — but the real trap is that four
  sessions guessed instead of asking.** Measured 2026-09-02: `memory-layer` was listening on
  `127.0.0.1:3030` all evening, answering `/health` 200 and `/api/recall/tags` 200 in 0.35s. Four
  sessions independently probed 8080, 8787, 3000 and 7777, got `000`, and declared it unreachable —
  two of them degraded their close on that basis (no overlook snapshot, no memory persistence) and
  one filed a bug against a route that works, reading its own timeout as a hang in the service.
  `/api/health` is a genuine 404 even authenticated, so a correct-port probe of the wrong path also
  looks broken; unauthenticated any route answers `401 MISSING_API_KEY` in under a millisecond,
  which is the opposite of a hang. The port is printed at `memory-layer/src/config.rs:875`.
  **The durable point is not the number.** `vscode-skills/.claude/hooks/memory-layer-lib.sh` and
  `.claude/commands/close.md` already carried `127.0.0.1:3030` and `/health`, tracked and correct,
  for the whole period. Every session that reported memory-layer down had hand-rolled a `curl` against a
  guessed port rather than calling the tooling that already knew. A probe that never reaches its
  subject reports about the subject, and four sessions agreeing made it look established.
- The registry's `areas[]` (`monitor/private/projects.json`) is the routing unit; `slug` ≠ `out` on purpose. Resolve report
  dirs via `monitor/area.mjs`, never by joining `reports/<name>` by hand.
- Multiline-regex scans over YAML backtrack catastrophically (pegged a core 14+ min once —
  see sitemap/README). Prefer linear line scans.
- Agent workflows: keep effort/model modest for scan stages; heavy runs have burned whole usage
  windows (see workflows/README cost note).
- **Several sessions write this tree at once.** Every measurement goes stale in minutes. Re-run a
  number before believing it and re-read a file before editing it; the expensive mistake here is
  acting on a stale snapshot. Corollary: **the test gate cannot attribute on a shared tree** — it
  assumes one writer. It reported "you broke 69 tests" during a window when three sessions were
  landing work, and the true floor 15 minutes later was 1. Re-measure after a pause before
  accepting any baseline: accepting immediately banks someone else's half-landed change as the
  permanent floor and hides their next real break.
- **This checkout contains more checkouts of itself, so a leaked working directory answers
  correctly about the wrong tree.** Re-measured 2026-08-30: `git worktree list` shows the root plus
  three LEAKED worktrees — one session scratchpad and two `cw-asset404-*` test leaks under the
  system temp dir — each a full copy of this repository at a DIFFERENT commit. Re-measured
  2026-09-13: `.claude/worktrees/` EXISTS and holds four registered worktrees — `agent-a7aa848af9652adb0`,
  `agent-a93265960f24c8c11`, `agent-afe69e304e07b23c0` and `secrets-vault-plan` — alongside
  `gate-head-*` checkouts under `.git/` and a peer's `/private/tmp/cw-attr`. An earlier edit of this
  entry said the directory no longer existed; that was true of one moment and wrong by 2026-09-06.
  The population churns; the trap does not. Elsewhere a stray `cd` gives you an error; here it
  gives you a plausible answer from a sibling checkout — the same filenames, the same symbols,
  different content — and nothing in the output says which tree replied. The shell a session runs
  commands in persists its cwd between calls, so one `cd` two calls ago silently rebases every
  later query. Use `git -C <dir>`, a subshell `(cd <dir> && …)`, or absolute paths; a `cd` is almost
  never actually needed. The same aliasing is why a `.plist` or a stale fixture found by a
  filesystem-wide `find` may belong to a worktree rather than to this tree — check the path prefix
  before drawing a conclusion from it.
- **`bin/anchor-staleness.mjs` is a READ that WRITES, and exits non-zero when an open entry has
  drifted.** A plain reporting run rewrites the audit corpus's `anchor-staleness.json`
  (`monitor/private/audit/`, sidecar-resident; `--out` moves it), and exits 1 when any
  still-open queue entry no longer matches its anchor (`--no-gate` suppresses that). The exit code
  silently breaks `cmd && cmd` chains: a comparison chained after it never runs, and the failure
  looks like the comparison failing rather than the gate reporting. The INPUT (`queue.json`) is
  safe — its writes are gated behind `--reanchor` and `--reverify-comment-only`, both atomic and both
  skipping entries in files with uncommitted changes unless `--force` — and the output is
  deterministic, so regenerating it under a peer reproduces their content rather than destroying
  it. Run it alone, read its exit code as a verdict.
- **Neither `monitor/sweep.mjs` nor `monitor/rollup.mjs` has a `--help`, and asking one for help
  can start real work.** Searching either for a help handler returns nothing; the `usage:` line in
  each is a COMMENT, read by no code. What they do with the argument instead:
  · **sweep** (`monitor/sweep.mjs:56-66`) collects every argument that does not start with `--` into
    a positional list, then takes `pos[0] || 'all'` as the GROUP and `pos[1]` as the project. A
    mistyped word is therefore a group, and `--help` is discarded as an unrecognised flag — leaving
    the group at its default `all` and the project unset, which means **a real `all` sweep of the
    registry's primary area** (`primaryArea`, `:98`). `--all` (`:66`) is the whole-fleet opt-in. An
    unknown group is not refused up front either: it is passed down to `commitwork run <group>` per
    repo, which exits 2; `scanOne`'s catch (`:528`) records that as "commitwork refused before
    scanning (exit 2)" through `scanOutcome` (`monitor/sweep-verdict.mjs`), and the run proceeds
    through batch creation, journals and rollup regardless, ending with exit 1 and a line naming
    the scans that did not run. `--dry` (`:219`) resolves the project list and runs nothing — put it
    first, always, and add `--all` when you mean the fleet. Only `--jobs`, `--repo` and `--exclude`
    are in `VALUE_FLAGS` (`:56`); a value-taking flag added without being registered there has its
    VALUE silently become the group.
  · **rollup** (`monitor/rollup.mjs:133`) reads `process.argv[2]` as the batch directory, and
    `:163` uses the mere PRESENCE of that argument to decide where output lands (`AMBIENT_OUT` when
    absent). A bare `node monitor/rollup.mjs` is not a query: it selects the newest batch covering
    the ambient area and **republishes** `rollup.json`, `dashboard.html`, `REMEDIATION.md` and the
    findings history over that area's dir. Aimed at an in-flight batch it publishes a partial sweep
    as current state; recover by re-rolling the last COMPLETED batch by explicit path. (`--help` is
    taken as a batch path; with no batch manifest there to name an area, it is refused with exit 4.)
  The refusals that do exist are worth knowing so an exit code can be read: 2 = empty batch (repo
  dirs present, no tool output; sweep treats 2 as "continuing"), 3 = another rollup holds the lock,
  4 = a cross-area or area-less batch refused, or nothing to roll up (sweep then skips the
  rollup-dependent steps), 5 = no batch to roll, 6 = the gate-exemption overlay present but
  unreadable, 7 = the history index or the previous slice it names is unreadable. There is
  deliberately **no unknown-scope fallback** (`:119-131`) — a scope-less pre-area batch is never
  adopted automatically, because a printed caveat does not undo a clobbered consumer contract.
- **A census that decides a safety property must enumerate by CAPABILITY, not by token.** Auditing
  every writer of the annotations store by grepping `writeFileSync|appendFileSync` returned ZERO for
  `bin/annotate.mjs` — it persists through `writeAtomic` from `monitor/lockfile.mjs`. The census
  would have concluded there was one writer where there are two, and declared the path cleaner than
  it is. Compounding it, `grep` returned contradictory counts for one file in the same session (5,
  then 0, same pattern) — the NUL-byte false-negative below, recorded as "UTF-8-dense" until
  2026-08-24, which was the wrong cause. Enumerate by asking what PERSISTS,
  and get the authoritative answer from Node or Python rather than grep.
- **Anchor drift is line movement, not new debt.** `anchor-changed` means the finding still exists,
  at a new line. Baselining it is correct; treating it as new findings is not.
- **Scanner categories are declared in SEVEN places, and this entry said THREE until 2026-08-23.**
  `SCANNER_SPECS` + `SCANNER_LABELS` + the export list (`monitor/extractors.mjs`), `SCANNER_CHECKS`
  (`monitor/scanner-checks.mjs`), `ROW_SCHEMAS` (`monitor/detail-schema.mjs`),
  `PARSED_FORMATS`/`REPORT_FORMATS` + the `parseReport` branch (`bin/commitwork.mjs`), the panel
  fallback label (`SCANNER_LABEL` in `admin/static/panel-posture.js`, since the panel client left
  `admin/index.html`), the regenerated `schema/scanner-finding.schema.json`, and —
  the seventh — `CLASS_FOR_CATEGORY` (`monitor/issue-key.mjs`), which **THROWS**. Two tests fail if
  the first few drift; **nothing failed for the seventh**. Five categories added in one day reached
  production and threw `no class declared for scanner category 'supplyChainPosture'`, surfaced by a
  peer session rather than by the suite. (A prompt-carrying check also needs `CHECK_ALIASES`, plus
  `RUNTIME_CATEGORIES` if it executes repo code.) The throw is the right design — a silent default
  is how a vocabulary fragments — but a count in a trap file is itself a hand-maintained list, which
  is why this one was wrong by four.
- **`// codeql[...]` does not suppress under `codeql database analyze`** — it is a GitHub Code
  Scanning platform feature. `// nosemgrep` does work. The local path for scanner rows is
  `scannerAnnotations[]` in the annotation store (`monitor/private/annotations.json`, authored by
  `bin/annotate.mjs` or the panel), which
  is a **strict** matcher — every identity field required, no wildcard-by-omission, unlike the
  `annotations[]` array in the same file. Two opposite rules under one filename: check which array
  you are writing to. Both matchers live in `monitor/annotate-lib.mjs` and the file says so at the
  top of each: `annMatch` is "`{id, package, repo}` AND-ed, omitted field = wildcard" (`:2`), while
  the scanner matcher is "deliberately not a generalisation of annMatch: every field in the
  category's identity tuple MUST be present, plus repo — absence is a validation error, never a
  wildcard" (`:45`), enforced at `:74` and applied by `scannerAnnMatch` at `:139`. One narrow
  exception: an `incorrect-scan-result` record is about the instrument, so a PLACE field it omits
  matches anything, while at least one instrument field (`detector`, `rule`, `tool`, `check`,
  `control`) must be named and repo/scope still bind (`:59-71`, `:135-146`). A SUPPRESSING scanner
  record also requires `expires` when it is authored (`:104`); a fleet-scoped suppression on a
  version-less identity without one is a permanent blindfold.
- **`LGTM_INDEX_FILTERS` is not code-scanning `paths-ignore` syntax.** A trailing `/**` fails the
  CodeQL build outright (`Illegal use of '**' in exclude path`). The converter between the two
  layers is `codeql/actions/tools/autobuild.sh` — **upstream, in the codeql-action repo, not in this
  tree**; grepping here for `autobuild.sh` returns nothing and has read as "that mechanism is gone".
  The published docs describe the other layer. Locally the value is exported by a `sed` that strips
  comments and blanks from `manifests/codeql-filters.txt`, repeated verbatim in each of the eight
  `sast-codeql*` lanes in `manifests/security-baseline.json` (js, java, ruby, python, cpp, swift,
  csharp, rust) — eight copies of one shell fragment, so a syntax fix has to be made eight times.
  Every one of them REFUSES to index when the filters file is unreadable, writing no SARIF, which
  classifies `noscan` rather than a clean zero.
- **`Host` is a forbidden fetch header** — undici drops it silently, so a test that sets it passes
  while testing nothing. Use `node:http`. This has bitten the project three times.
- **A NUL byte makes search tools skip a source file silently, and this repo once carried eleven.
  The entry blamed em-dashes until 2026-08-24.** The incident stands: `grep` over
  `bin/bola-run.mjs` produced four consecutive false conclusions in one session, every one of the
  form "this symbol is gone" about a symbol that was present and committed. The stated mechanism —
  "valid UTF-8 but dense with `—`, `×`, `→`, called binary under a C/POSIX locale" — was wrong, and
  wrong in the direction that makes the trap useless: it implied the fix was a locale, and it named
  one file.
  Measured at the time: of 987 tracked files, 28 contained a NUL byte; 17 were genuine binaries
  (PNG, ICO, TTF) and **11 were `.mjs` sources**, nine of them carrying a **deliberate** NUL — the
  composite-key idiom `` `${a}\0${b}` `` (NUL is the one byte that cannot appear in a path or an id,
  so the key is unambiguous), typed as a RAW byte rather than a `\0` escape. Good code with a bad
  encoding; the fix was one character per site, and it changes no runtime value.
  **Repaired, and now gated.** Re-measured 2026-09-27 at a commit: no `.mjs` in the tree carries a
  raw NUL (`grep -rlaP '\x00'`, with a planted positive control), and `bin/bola-run.mjs:373` reads
  `` `${name}\0${type}` `` as a two-character escape. `bin/test/no-nul-bytes.test.mjs` holds it: it
  reads the blobs at **HEAD**, never the working tree, fails on any tracked text source carrying a
  raw NUL, U+2028, U+2029, a mid-file BOM, a stray C0 control or a zero-width space (each with a
  reasoned allowlist), and reports the working tree only as a diagnostic. What follows still
  describes any file that does carry a NUL — a genuine binary, a file outside the gated extensions,
  another repository.
  `file(1)` reports `(binary data)` under the default locale as well as `LC_ALL=C` — the locale is
  not the variable. What each tool then does is NOT uniform, and **the house advice to prefer
  `git grep`/`rg` over bare `grep` does not save you**:
  · The shell's `grep` here is a shim over `ugrep` carrying `-I`, which SKIPS binary files with no
    output and **exit 1** — an affirmative "not found" for a pattern that is present. `grep -c`
    prints nothing at all, so the older claim that counts still come through is false.
  · `rg` and `git grep` depend on WHERE the NUL falls. Measured on the pre-repair files:
    `bin/anchor-staleness.mjs` (NUL at byte 6070 of 16318) yielded `binary file matches` /
    `Binary file … matches` and **exit 0** — success, zero lines; `bin/bola-run.mjs` (NUL at 25251
    of 38967) searched normally and returned the same 18 matches Node did.
  So the same tool answers correctly on one file and goes silent on the next, and neither failure
  sets a non-zero exit you could gate on. Pass `-a` to any of them, or ask Node what a module
  exports. A search tool answering "not found" when it means "I declined to look" is this repo's own
  false-clean class, turned on the tooling.
- **gitleaks fingerprints are relative to `--source`.** Give it an absolute path and every
  fingerprint is absolute-prefixed, matching nothing anyone cited from a report — a correct answer
  reads as 0/7. Run it cwd-relative.
- **NEVER install or modify the launchd agents WITHOUT PERMISSION** — ask, then act. The wording
  that stood here was an absolute "never", **narrowed 2026-08-22 to "not without permission"**
  (operator ruling: superseded in practice; `evaluations/DECISIONS.md`). The distinction is the
  whole point: doing it when asked is fine, doing it on your own initiative is not. This session
  restored the panel with `launchctl bootstrap` during an outage and then ran `install-agents
  --write` + `bootout`/`bootstrap`/`kickstart` WITHOUT checking this line first — the restore was
  wanted, the not-checking was the failure.
  It had been contradicted for weeks: the panel became a KeepAlive LaunchAgent in a commit on
  2026-08-03 and the box runs 37 installed agents. A rule saying "never" about a thing done
  thirty-seven times teaches a reader to ignore the file it lives in. What replaces it is the actual
  hazard, which is real and cost a five-and-a-half-hour public outage on 2026-08-22:
  - **`--load` does `bootout` then `bootstrap`, per agent.** If the bootstrap fails, the tool has
    STOPPED a service and not restarted it. Reproduced deliberately: `bootout` rc=0, then
    `Bootstrap failed: 5: Input/output error`, panel down, **immediate retry succeeded**. The race
    is transient and one attempt is not enough. Now retried and verified, but know the shape.
  - **`--write` alone rewrites plists and loads nothing.** A current plist beside an absent job is
    exactly what took the panel down: the file looked right and the service was gone. `--write` now
    reconciles the declared set against launchd and **exits 1** naming anything not loaded — so read
    the exit code, do not just read the "wrote …" lines.
  - **A restored job is not a verified job.** `launchctl bootstrap` can return 0 and leave nothing
    behind; check `launchctl list` (or `launchctl print`) before believing it.
- **THE GIT INDEX IS SHARED BY EVERY SESSION ON THIS CHECKOUT.** `git add` then a bare `git commit`
  commits whatever *anyone* has staged, not what you staged. That is git's default, not anyone's
  mistake, and on this tree it is a near-certainty rather than a risk.
  **Reach for `node bin/commit-phase.mjs -- <paths>` first** (landed `7d57137`): per-session index,
  `read-tree` immediately before the land, and a compare-and-swap `update-ref` that git fails
  atomically if HEAD moved — plus a refusal on an empty change set, which the hand-rolled sequence
  does not give you, because `update-ref <new> <old>` guards the REF and not the CONTENT. It is
  strictly stronger than the pathspec form below, which re-reads the WORKING TREE at commit time and
  so can still take a peer's mid-commit write. Measured 2026-08-30: two sessions hit this on the same
  day with the tool already sitting committed and unreferenced — a commit (repaired a commit) and
  `994d6d9` (repaired `a71a230`). A correct tool nobody is pointed at is not a control.
  Otherwise, the pathspec form —
  `git commit -F - -- <paths>` — which ignores the index entirely and commits the working-tree
  content of exactly the paths you name. **`-F -` must come BEFORE `--`**, or git reads the flag as
  a pathspec and dies with `pathspec '-F' did not match any file(s)`.
  Measured 2026-08-11, four sessions in one day: a commit intended `monitor/projects.json` alone
  and took four other sessions' staged files under a message describing none of them, which then
  sent a fifth session chasing hunks that had already landed. Staging-then-committing in one shell
  invocation only shrinks the race window; the pathspec form removes it.
  When a file genuinely interleaves line-by-line and no pathspec can express it, the fallbacks are
  `git diff -- <file> > p`, delete the foreign hunks, `git apply --cached p` — or build the index
  content directly with `hash-object`/`update-index`, which leaves the working tree untouched for
  its owner. Verify after either: `git show --stat HEAD` plus a grep of the commit for a token that
  is unmistakably someone else's.
- **THE PATHSPEC FORM REMOVES THE INDEX RACE, NOT THE WORKING-TREE RACE.** The entry above says it
  "removes it". That is true of the shared *index* and false of the shared *working tree*:
  `git commit -- <paths>` commits the working-tree content of those paths **as it is at commit
  time**, so a co-session writing the file between your inspection and your commit is still taken.
  Measured 2026-08-22, a commit: pathspec form, hunks inspected first, and it still swept 34 lines
  of another session's `admin/index.html` work — then 40, because they added a second hunk during
  the window. Reading `git diff -- <file>` immediately before committing NARROWS this and cannot
  close it; there is no atomic check-then-commit against a tree others write.
  The form that does close it commits a tree you built, never the working tree:
  ```sh
  git diff -- f > mine.patch                       # capture; RE-capture right before you revert
  export GIT_INDEX_FILE=$(mktemp)                  # a private index — the shared one is untouched
  git read-tree HEAD && git apply --cached mine.patch
  TREE=$(git write-tree); C=$(git commit-tree "$TREE" -p HEAD -m "$(cat msg)")
  unset GIT_INDEX_FILE; git update-ref refs/heads/main "$C"   # fast-forward only; re-read HEAD first
  ```
  Verified 2026-08-22 in a scratch repo: with a co-session writing the working tree AND running
  `git add` on the same path between the staging and the commit, the resulting commit still contained
  only the authored hunk. Two costs, both of which have to be paid or the trick trades one silent
  loss for another:
  · `update-ref` moves HEAD without touching the shared index, so `git reset -- <paths>` your own
    paths afterwards or the next session reads a stale index.
  · The WORKING TREE is now stale **by your own lines** — you committed a tree you built, not the
    file on disk. Confirm `git diff -- <path>` shows your insertions gone before any
    `git checkout HEAD -- <path>`; doing that resync blind discards whatever a co-session wrote
    there while you were committing. (Reported by a second session that reached the same method
    independently on `evaluations/DECISIONS.md` and hit exactly this.)
- **THE PATHSPEC RULE ABOVE DOES NOT COVER `--amend`, AND THE SAFE-LOOKING FORM IS NOT SAFE.**
  `git commit --amend` amends **whatever HEAD is at that moment**, and on this tree HEAD moves
  between your commit and your amend. `--amend --only -- <paths>` constrains which PATHS are
  amended; it does **not** constrain which COMMIT. Measured 2026-08-19, twice in one day: one
  session amended and rewrote *another session's* commit under its own message (restored from
  reflog); a second ran a bare `--amend`, which took the shared index and replaced its own two-file
  commit with eight staged files belonging to somebody else. If you must amend, re-read
  `git rev-parse HEAD` immediately before doing it and confirm it is still the commit you made —
  and prefer a new commit, which needs no such check.
- **`git reset --soft` is the same hazard pointing backwards: it can orphan commits that are not
  yours.** Recovering from a bad amend by resetting to "the good commit" moves the *branch*, and any
  commit another session landed in between silently leaves the branch. Measured 2026-08-19: a
  recovery reset past two commits of a different session, which survived only as unreferenced
  objects (`git branch --contains <sha>` printing nothing is the tell — `git log` and `git show`
  both still print them happily). They were recoverable only because `--soft` preserved the index,
  so the working tree still matched them byte-for-byte and they could be re-committed by pathspec.
  Before any reset on a shared branch: `git log --oneline <target>..HEAD` and check every commit in
  that range is yours.
- **A commit is not the record of who wrote something.** Given the above, `git log` attributes to
  whoever ran `commit`, and the touch ledger maps session→file more
  faithfully. Counting Write/Edit calls per file across transcripts does NOT establish authorship
  either — it conflates "touched this file" with "authored this hunk" when five sessions edit one
  manifest in a day. Before telling anyone their work blocks yours: `git show HEAD:<file>` to see
  whether it already landed, then `git diff <file>` for what is genuinely outstanding.
- **Never push without running the suite at the commit you are about to push.** Not your working
  tree — your tree carries fixes nobody has landed, so it is green while HEAD is red. Use an
  isolated worktree (`git worktree add --detach <dir> HEAD`) or `git archive HEAD | tar -x`, never
  `git stash`: stashing on this checkout yanks other sessions' uncommitted work out from under them
  for the duration, and a failed pop strands it. A red HEAD reached origin this way on 2026-08-11.

- **`git rebase --skip` silently destroys the ADDED files of the commit you skip.** Measured
  2026-09-06. A session pulled 398 commits with `git pull --rebase --autostash`, hit a conflict on
  one stale unpushed commit, checked that its content had already landed via the sessions that owned
  it, and skipped it. That check was right about every MODIFIED file and blind to the rest: **a
  modification survives a rebase by being superseded, an addition just vanishes.** The commit also
  ADDED two files that existed nowhere else — `bin/test/gate-spine-overwatch-outage.test.mjs` and
  `monitor/data/epss-detail.json` — and both went with the skip. Nothing warned; the pull reported
  success; the loss surfaced only when a peer noticed them missing and recovered them from the
  dropped commit object, still reachable, in a commit. Before skipping anything, run
  `git show --diff-filter=A --name-only <sha>` and re-home what it lists. Before the pull, give the
  tip a name — `git branch backup/pre-pull-<date>` — so a dropped commit is reachable deliberately
  rather than by reflog luck. `--autostash` carries the same hazard as `git stash` above and for the
  same reason: this worktree routinely holds 100+ dirty files belonging to other sessions, and here
  it popped with a conflict and left the work parked in a stash nobody was looking for.

- **A `catch` that cannot tell a broken file from broken code.** Measured 2026-08-19: 745 `catch`
  blocks in shipped `.mjs`, 450 of them bare, 8 `throw e`. **Re-measured 2026-08-24 and the debt is
  growing faster than the fix**: across 252 shipped `.mjs` (tests excluded), **1,013 `catch` blocks,
  564 of them bare `catch {`** — which cannot even inspect the error — and **20 `throw e`**. The
  ratio barely moved (60% → 56% bare) while the absolute count rose ~36% in five days, so the
  practice has not changed; only the codebase grew. (Method, so the next re-measure is comparable:
  `git ls-files '*.mjs'` minus `test/` dirs and `*.test.mjs`, counting `/\bcatch\s*[({]/`,
  `/\bcatch\s*\{/` and `/\bthrow\s+e\b/`. The 2026-08-19 figures did not record their method, so
  the two are not strictly comparable — treat the trend, not the delta.) A `ReferenceError` is
  indistinguishable from an
  `ENOENT` at every one of those sites, and the house rule *a parse failure is never an empty
  store* is enforced on DATA and nowhere on CODE. This has bitten four recorded times: a
  `require()` in an ESM module threw on every call and the catch turned it into "store unreadable"
  — the gate reported healthy while permanently blind, and said so in its own comments
  (`bin/gate-spine.mjs`); an ESM `require` inside a test's try/catch made an assertion pass while
  proving nothing; a bare catch swallowing a `ReferenceError` produced 43 duplicate adjudications;
  and an `existsSync` diagnostic reported files as missing when the loop had thrown. `ReferenceError`,
  `TypeError` and `SyntaxError` are never expected failures of an I/O boundary — re-raise them,
  at least wherever a swallowed error becomes a NUMBER.
- **The lossy call is the shorter word.** `readJournal(gate)` walks the rotation chain
  (`<name>.jsonl.1` + `<name>.jsonl`); `readJournalFile(path)` reads ONE file. They are exported
  from the same module and the names do not distinguish *chain* from *file*. Reaching for the
  single-path one zeroed all adjudication coverage to a flat `0.0%` when the ledger rotated — which
  renders as "nothing has ever been adjudicated" about 2000+ records. It caught two sessions in one
  day. The asymmetry is why it recurs: the wrong choice loses data SILENTLY, the reverse is merely
  wasteful.
- **A rotation under a DENOMINATOR flatters; under a numerator it announces itself.** Same
  mechanism, two very different signatures. A missed rotation under a numerator zeroes a rate and
  someone notices. Under a population denominator it SHRINKS the denominator and inflates every
  rate computed over it, and nobody notices. THE LEDGER LIVES AT `.claude/store/touches.jsonl`,
  not `.claude/touches.jsonl` — the latter has not existed for some time, and eight places in this
  repository still cited it on 2026-08-27, including `SEPARATE_FIRST` in
  `bin/gate-ratchet-core.mjs`, a string a GATE PRINTS at sessions telling them to consult it. A
  query against the dead path returns nothing, and nothing reads as "no owner" rather than "wrong
  path": attribution guidance publishing unsupported pass. It cost a real misattribution — a session
  hunting the holder of a contended `admin/index.html` concluded there was none.
  IT HAS NOW ROTATED (this entry previously said it never had): `.jsonl.1` is 2.0 MB, rotated
  2026-08-26T15:09, and the live file was 623 KB the next day. So a single-path read now silently
  drops everything before that instant — query BOTH generations. Filter on the `f` key rather than
  matching the raw line: rows are `{s, at, f}` for edits and `{s, at, x, via:"exec", cmd}` for
  shell, and an exec row's `cmd` can merely mention the path you are asking about.
- **Widening a sentinel invalidates every truthiness test that read the old one.** Adding a
  `CORRUPT` Symbol alongside `null` in `bin/gate-spine.mjs` broke `spineRows || []` (a Symbol is
  TRUTHY, so it flowed through and would have thrown on `.filter`) and `touches !== null` (a Symbol
  is not null, so a corrupt touch ledger read as present-with-zero-rows, i.e. "this session edited
  nothing", and fell silent) — both IN THE SAME FILE the widening was fixing, and both found by
  re-running the canaries rather than by reading. When a function gains a new sentinel, grep every
  truthiness test that read the old one.
- **Never filter the test suite at CAPTURE time — capture everything, grep the file afterwards.**
  `npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)|^✖ '` keeps the test NAME and discards the
  assertion detail, so an intermittent failure becomes unrecoverable the moment it scrolls past:
  you know a guard fired and not which of its failure modes did. That happened on 2026-08-23 to a
  cascade test with four distinguishable modes — two pointing at a truncated read, two at content
  that arrived intact and said something unexpected — and neither session could tell which, because
  the diagnostic was thrown away at the pipe. The suite is past 9,000 tests (9,606 declarations
  across 764 files, counted 2026-09-27) and piping it to `grep` is the obvious move, which is exactly
  why this costs what it costs. Redirect to a file, then grep the file.
- **A test that PARSES a served page is the only one that sees transport corruption.** `buf += d`
  on a `res.on('data')` Buffer decodes each CHUNK independently, so a multi-byte character split
  across a chunk boundary becomes U+FFFD. This tree's pages are multi-byte dense — the login page
  alone carries 185 (151 box-drawing `─`) — and chunking varies with load. Every test that regexes
  for a marker survives it; the one that parses the bytes fails intermittently and looks flaky.
  `Buffer.concat(chunks).toString('utf8')`.
- **zsh's builtin `echo` expands backslash escapes and corrupts captured JSON.** `echo "$RESPONSE"`
  turns a body containing `\n` into a real newline, so valid JSON becomes unparseable — and the
  corruption is INVISIBLE in the terminal, because the mangled output looks like pretty-printed
  JSON. It has cost at least two sessions a wrong verdict about a service (a memory-layer `/api/recall`
  readback read as a memory-layer defect; it parsed first try under `printf '%s'`). Use `printf '%s'` before
  blaming the far end.
- **`bin/gate-spine.mjs` blocks on TWO different arms, and the remedy for one makes the other
  worse.** First level — is it blocking at all? The headline alone (`bin/gate-spine-core.mjs`
  non-block path) is advisory, exit 0. Headline **plus** the `hookSpecificOutput.additionalContext`
  block containing "WHY THIS BLOCKS RATHER THAN REMINDS" and a `CW_SPINE_MIN_EDITS=N` escape hatch
  is a real refusal, exit 2. Second level — the `reason` field says which arm: `no-spine-record`
  (edits, nothing filed) wants a session opened and work filed, while **`decoy-suspected` (records
  filed since the last block, none of which has left `pending`) wants an accurate STATUS, and
  filing more records against it makes it worse**. Two sessions misread this on 2026-08-23: one
  read a real block as informational and nearly published that generalisation to the fleet; the
  other filed records against `decoy-suspected` through four consecutive blocks (10 → 13 → 14 → 15)
  because the count was never the thing being asked for. Read the arm before acting on the block.
- **`git commit -q` erases the commit from the attribution ledger, silently.**
  `bin/lib/touch-ledger-core.mjs` `commitShaFrom()` recovers the sha by parsing git's own output for
  `[<branch> <sha>]`, and `-q` makes `git commit` print **nothing at all** — verified in a scratch
  repo, not inferred. No sha means no `via:'commit'` row, so every file in that commit is
  permanently unattributable to the session that landed it. Nothing errors and nothing is missing
  from the ledger's own point of view; the commit simply never happened as far as attribution is
  concerned.
  Measured 2026-08-29: the ledger held 117 commit-derived rows across other sessions and **zero**
  for the session that had just committed 23 files with `-q`. `bin/gate-tests.mjs` then reported
  "of the 591 file(s) committed since the floor, YOU touched 0" to that session's own author, and
  would have told a co-session that nobody owned those files — the P1 blame-under-concurrency class
  the ledger exists to serve, produced by the ledger.
  `git rev-parse HEAD` is NOT the repair, and the header of `bin/touch-ledger.mjs` records why: with
  ~28 sessions committing, HEAD moves under you between the commit and the read. Drop the `-q`
  instead. The tidier output is not worth the authorship.
- **A `commitwork-NN` name is not an address, and the roster that resolves one is only as current
  as its last `--scan`.** Those peer-facing names live in the harness session registry, which no
  file records and which leaves when the session does. `bin/session-roster.mjs` is the durable
  register; `--resolve <cwNN|ref|uuid>` answers, `--scan` feeds it, `--list` shows freshness.
  **Run `--scan` before you trust a name**, and read the verdict rather than the row: `LIVE` means
  a pid still holds a session socket, `STALE` means something positively contradicts the binding,
  and `UNVERIFIABLE` means nothing on this machine can check it — a bare `ref` is a harness handle
  and only ListAgents resolves one. A `--resolve` that finds rows but nothing live exits **3**.
  The failure this replaced is worth knowing, because an unfed append-only register does not go
  quiet — it gets *confident*. Nothing fed this store between 2026-08-29 and 2026-09-01, so
  `--resolve <name>` printed `<name> = [<ref>] = <transcript>` with no caveat, off a single three-day-old
  row, while the live session of that name was a different one on a different pid. The "reports the
  whole history when a name has moved" safety path cannot fire when there is only one row to
  report. unsupported finding with the sign flipped.
  **Never derive a name from a session title.** `bin/session-title.mjs` reads titles, which are
  hand-maintained: measured 2026-09-01, a title said `cw-15` for the session whose harness name is
  `c5`. `mirror()` in `bin/session-roster.mjs` now refuses a title binding that contradicts a
  better-ranked row, because
  append-only makes a wrong row permanent and it looks exactly like a right one.
  **Names are reused, and often.** 25 of 80 names in the register have had more than one holder;
  `cw8d`, `cw40`, `cw81`, `cwab`, `cwb4` and `cwc4` have had three each. Two live holders of one
  name is failure class L8, and `--resolve` refuses to pick between them rather than guessing.
  **Pass your pid to `--record`, or the row you write is not an address.** `--record <NN> <ref>
  [uuid] [pid]`. Until 2026-09-06 it took no pid, so the ranked-*authoritative* source could only
  mint `UNVERIFIABLE` rows — a `ref` resolves nowhere locally, so there was nothing left to
  corroborate them with, and `--resolve` was right to refuse every one. The SessionStart hook now
  supplies the pid in the command it prints, by walking its own ancestors to the one holding a
  session socket. A pid that holds no socket is **refused**, not downgraded: a row that reads `LIVE`
  while naming another session's process is worse than the gap it closes. An absent socket directory
  is unmeasurable rather than contradicting, and records normally.
  **And the transcript id is not the escape hatch from all this.** Measured 2026-09-06: pids 99699
  (one session name) and 76259 (another) were both alive, both holding sockets, both listed
  by ListAgents — on ONE transcript id, after a restart left the old process running. A transcript
  identifies a *conversation*; a worker is a process. Reaching for it because names are contended
  reproduces L8 in a field nobody thought to check for uniqueness.

### A commit message is shell input, and backticks in it get executed

`bin/commit-phase.mjs -m "…"` takes the message as a shell argument. Inside double quotes, zsh
performs command substitution — so a backtick pair in prose is **run**, and its output replaces it.

Measured 2026-09-02. A message describing a hadolint finding contained ``on `USER node` `` and the
shell printed `command not found: USER`; the commit landed reading *"returned DL3066 on ."* The
detail was gone and the commit was already in history before the blank was noticed. Backticks are
the natural way to quote an identifier, which is exactly why this recurs — the more carefully a
message is written, the more likely it carries them.

**Use single quotes for the `-m` argument, or drop the backticks.** A message is prose, not code, so
the loss is silent: nothing fails, nothing warns, and the sentence still parses in English with a
word missing. The same applies to `$(…)`, `$VAR` and `!` in double-quoted messages.

**And it cannot be repaired once HEAD moves.** Amending needs the commit to still be the tip; with
~28 sessions committing, it will not be for long. Put the durable version of the fact somewhere that
is not the message — the commit above survived only because the same detail was in a JSON file it
shipped alongside.

### `${PIPESTATUS[0]}` is bash. This shell is zsh, and the bash form reads as empty

zsh's array is `pipestatus` and it is **one-indexed**, so `${pipestatus[1]}` is the first command's
status. The bash spelling does not error — it interpolates to the empty string:

```
echo hi | tail -1   ->  ${PIPESTATUS[0]}=''   ${pipestatus[1]}='0'
false  | tail -1    ->  ${PIPESTATUS[0]}=''   ${pipestatus[1]}='1'
```

**A failing pipeline and a passing one render identically.** Not merely uninformative — actively
indistinguishable, and an empty exit code reads as success to a human skimming and to most
`[ "$e" = 0 ]` tests.

Measured 2026-09-02 across two sessions on the same night, both using the bash idiom, neither
noticing. It was hiding real failures in both trees: one session reported a test file 10/10 that
was actually `exit 1, 3 pass 1 fail`, and a peer reported 5/5 on a file that was `rc=1, 4 pass 1
fail`. Both reds were genuine and both had been published as green.

**Run the thing, capture `$?` on its own line, and do not pipe it.** `node --test x > /tmp/o 2>&1;
e=$?` then read the file. Piping to `grep`/`tail` to shorten output is where the status is lost, and
shortening output is precisely what one does when the output is long.

**On Git Bash the bash idiom WORKS, and that is the hazard.** Measured 2026-09-23, bash
5.3.9(1) on Windows 11: `${PIPESTATUS[0]}` reads `1` for `false | tail -1` and `37` for a command
that exited 37. Everything above is about zsh, so a reader on Windows checks the spelling, finds it
sound, and concludes the entry is not about them.

What bites there is the plain `$?`, which after a pipeline is the LAST command's:

```
sh -c 'exit 37' | cat ;  $?=0   ${PIPESTATUS[0]}=37
```

Measured the same day, in this repository: a session ran
`git worktree remove --force <path> 2>&1 | tail -1; echo "exit=$?"`, read **0**, and reported that
git had exited 0 while printing `fatal:` — i.e. that failures there are undetectable and every
`|| cleanup` is blind. git had exited 128. The claim reached a draft of THIS FILE and was caught
only because it was re-measured before landing; every other exit code in the same report was
captured directly and every one of those held up.

So the rule is the same in both shells and it is lost two different ways: zsh drops the status to a
spelling, bash drops it to the pipe. `tail`/`grep` on the end of the thing you are measuring is the
tell, and shortening long output is exactly when you reach for it.

**A third way to lose it, and the only one that has landed a defect here: don't SUBSTITUTE a
predicate for the status.** Measured 2026-09-25 — a session gated a commit on a `grep` of a test
run's output instead of on the runner's exit status, the grep matched the line describing the
FAILURE, the guard went green and a commit with a failing test landed on main (`fe9ad007`, repaired
by `b55e4135`).

Nothing was piped away here. The status was available and a different question was asked in its
place, and the substitute inverts: the louder a run fails, the more text it prints, and the more
likely a grep finds what it was looking for. `node --test … | grep -q "pass"` is satisfied by
`ℹ pass 0`, by a failure summary, and by a filename containing the word.

Three instances in three days, all the same family and no two the same mechanism — the status lost
to a spelling (zsh), lost to a pipe (Git Bash), and replaced by a proxy (this one). The rule that
survives all three: **run it, capture `$?` on its own line, branch on that number, and let the
output be output.** A test runner's exit code is the assertion; its stdout is a description of the
assertion, and descriptions are not verdicts — which is the same distinction this repository
enforces everywhere else about scanner findings.

### A panel tab is invisible until its WORKSPACE is selected — `offsetParent === null` is not a bug

The panel client lives in `admin/static/panel-*.js`, with the navigation component
`admin/menus/navigation.js` inlined between those scripts. `setView()` (`admin/static/panel-router.js`)
calls `applyGroup(v)` on every view change, and this is the loop that decides what is laid out:

```js
for(const b of tabs){
  b.classList.toggle('ghide',workspace==='findings'||workspaceOf(b.dataset.v)!==workspace||workspace==='manage');
```

`workspaceOf()` maps each view to one workspace — the project's Summary, Findings, Websites &
services, Site map, Work or History, the All-projects `fleet` pages, or Manage. So **a `#views .vtab`
is in the layout only when its workspace is the current one, and in Findings and Manage no tab button
is laid out at all**: a Findings page is reached through the category buttons in `#groups` and the
check selector (`#check-picker`), and a fleet or Manage page through the rail. Every hidden `.vtab`
carries `ghide` and reports `offsetParent === null`. There is no per-project tab gating in that
mechanism at all.

**Two things this bites, and it bit both on 2026-09-02** (under the earlier section strip, which
hid tabs the same way).

A session adding a tab reads the strip, sees its button in the DOM, and concludes it is reachable.
It is not, unless its workspace happens to be selected — and a new view falls through
`workspaceOf()` to Findings and, with no `TAB_GROUPS` entry, to the "Other checks" category, which
almost nobody opens.

Worse for anything that DRIVES the panel: a sweep that clicks "every visible `.vtab`" sweeps **one
workspace**, not the panel. A browser smoke measured 6 of ~78 tabs and read that as the whole
surface. The denominator was a tenth of the target while reading as all of it — and nothing in the
output said so, because every tab it did reach passed. Diagnosing it as a per-project gate is the
natural wrong answer, and it was given confidently by the session that had added the tab.

**Reach a view by its PATH, not through the strip.** Every view lives at a real path (`/overwatch/`,
`/codeql/`), the client's `VALID_VIEWS` and the server's `PANEL_VIEWS` are held equal by
`admin/test/panel-view-paths.test.mjs`, and `setView` calls `applyGroup(v)` itself — so the
navigation follows the view. That is immune to strip staleness too: opening a tab re-renders the
strip, so a snapshot of buttons taken before the first click goes stale and yields phantom "element
vanished" failures (32 of them, on a panel with none).

To sweep the whole panel, iterate `VALID_VIEWS` by path; do not iterate what is visible at any
single moment.

### `node --test <dir>` fails on Node 26, and the failure wears a passing suite's clothes

A bare directory argument is resolved as a MODULE, not walked as a test root:

```
$ node --test t
Error: Cannot find module '/private/tmp/traptest/t'   code: 'MODULE_NOT_FOUND'
ℹ tests 1   ℹ pass 0   ℹ fail 1
```

Measured on v26.7.0, 2026-09-02. The tally is the whole problem. `tests 1 / pass 0 / fail 1` is
**byte-identical in shape to one genuine failing test**, so the natural reading is "a test broke",
and the natural next move is to go read that test — which does not exist. The same directory under
`node --test 't/*.test.mjs'` exits 0.

**Quote the glob.** Unquoted, the shell expands it and the behaviour depends on how many files
happen to match — one match is a file path and works, which is how this survives a spot-check.

Found independently by two sessions on 2026-09-02, neither told; the second spent the same time
re-deriving it.

### An ESM preload can only patch the DEFAULT import of a builtin. Named, namespace and dynamic all miss

Monkeypatching a builtin from a preload behaves completely differently depending on which preload
flag loaded it. Full matrix, measured 2026-09-02 on v26.7.0 — one subject reading `/etc/hosts`
through each import form, one preload wrapping `fs.readFileSync`:

| subject writes | `--import patch.mjs` | `-r patch.cjs` |
|---|---|---|
| `import { readFileSync } from 'node:fs'` | **MISSED** | intercepted |
| `import fs from 'node:fs'` | intercepted | intercepted |
| `import * as fs from 'node:fs'` | **MISSED** | intercepted |
| `const fs = await import('node:fs')` | **MISSED** | intercepted |

The ESM preload catches exactly one of four. Importing the builtin inside `patch.mjs` instantiates
its ESM facade and freezes the named bindings, so the later assignment mutates only the CJS exports
object that the default import happens to alias. **The named form is the commonest spelling in this
repo**, so an ESM-preloaded tracer reports almost nothing while running clean, exiting 0, and
looking wired.

**Two rules.** Use `-r` for a preload that patches. Use `module.registerHooks({resolve, load})` for
one that only observes — verified in the same run to see `node:fs` under all four forms, both hooks.

The trap is the flag, not the API: a hook that is genuinely blind and a hook watching a subject that
genuinely never reads a file emit the same output. Assert a positive control — a read the tracer
MUST see — before believing a quiet one.

### `'\b'` inside a template literal is a backspace, and it deletes your word boundaries silently

`\b` means "word boundary" in a regex and "backspace" (U+0008) in a string literal. A regex built by
interpolation gets the string meaning:

```js
`x\by`.length            // 3 — codes 120, 8, 121
new RegExp(`\bword\b`)   // matches "a word b"? false
/\bword\b/               // matches "a word b"? true
```

Measured 2026-09-02. Nothing throws, and `re.source` *prints* as `word` because a terminal renders
the control characters as nothing — so the regex looks right in a debug line while matching
nothing at all. A guard built this way reports its subject as broken. One did: a panel state check
read "0 of 4 states — a missing one has collapsed" against a page where all four rendered fine.

**Double the backslash (`\\b`) in any template literal that becomes a regex**, and prefer a literal
regex where the pattern is static. This bites hardest in browser-driving code, where the pattern is
necessarily a string on its way into the page.

### A TOTP step is burned by enrolment, and every step at or before it is dead

`admin/auth.mjs` records `lastTotpStep` on success and refuses `step <= lastTotpStep` — in
`confirmTotp()` ([auth.mjs:392-393](../admin/auth.mjs#L392-L393)) and in `verifySecondFactor()`,
which `authenticate()` and the SSO second-factor route `/auth/sso/totp` both call
([auth.mjs:496-499](../admin/auth.mjs#L496-L499)),
each re-checked under the store lock against the freshly read record. That is correct replay
protection, and it means `/auth/totp/confirm` **consumes** the code it verifies.

Reusing that same code against `/auth/login` inside the same 30-second window returns
`invalid second factor` — which reads as a broken credential, a wrong secret, or a clock skew, and
sends the reader to debug the enrolment that just succeeded. Note the comparison is `<=`, not `==`:
a code from an EARLIER window is refused too, so a slow retry with a stale code fails the same way.

**Wait for the next window and generate a fresh code.** Any script that enrols and then logs in must
sleep across the step boundary rather than reusing the token it just proved.

### "Index last" is a commit marker for ONE write — over a multi-slice rewrite it orphans every slice before a crash

`rollup.mjs` writes `history/index.json` last so a crash anywhere above heals on re-roll: every
earlier write is an upsert keyed by natural key. `backfill-scanner-delta.mjs` copied the pattern
for a walk that rewrites N slices — and there it inverts. Measured 2026-09-01: the walk threw on
its sixth slice, five bodies were already rewritten, the index write never ran, and five rows kept
hashes their bytes no longer matched. The re-run could not heal them: each body already carried
the new `scannerDelta`, so the rewrite path counted it `unchanged` and never re-hashed it. The
orphan was permanent, invisible to the tool that made it, and visible only to `store-consistency`
— which a backfill never ran.

**When one walk mutates many hashed files, commit the hash with each write, not at the end**
(`backfill-scanner-delta.mjs` now writes the index after every rewrite and repairs a hash whose
bytes moved behind it even when the delta is current), and **re-read the disk after the walk**
(`checkHistoryIndex`, exit 4). A corrupt slice stops the walk by name (exit 2) rather than being
skipped — `prev = slice` chains every delta to its predecessor, so skipping one writes a plausible
wrong number for the next.

### A chain that verifies is not a chain that was fed — and a chain that is fed still cannot see a consistent rewrite

`history/chain.jsonl` verified 10/10 on 2026-09-02 while **the newest row of every chained area was
unrecorded**: rollup's feed had been unwired at a commit because the module was untracked, and
738 of 752 rows were retro-seals from a one-off. `verifyChain` then compared stamps only — a slice
rewritten together with its index hash (a scrub, a backfill) left `verified:true, unrecorded:[]`.
And a chain beside the bytes it attests, written by the same uid, verifies perfectly after a
rewrite from genesis; that was done deliberately the same day, with a note on every row, in one
script.

Three separate facts, three separate checks, none implied by the others: **fed** (`sweep.mjs`
prints unrecorded rows per area at sweep time, not only on a panel read), **drifted** (`verifyChain`
compares each index row's hash to the chain's last event for that stamp), **anchored** (each append
copies the tip to `.claude/store/chain-tips.jsonl` in the sidecar, and the verifier checks the
newest anchor is a hash in the chain). `anchored:true` means consistent with the LOCAL anchor —
same disk, same uid — and the route says so; tamper evidence begins at the sidecar commit.

**Both halves are now instrumented** (2026-09-06): `chainVersion: 2` binds every field on a line
rather than six, chosen per line so nothing needed re-sealing, and `verifyChain({committed:true})`
reads the newest anchor from the sidecar's HEAD through `git show` — the first copy the chain's
own writer does not control. `bin/anchor-commit.mjs` lands it. Measured the same day on the live
fleet: 28 of 28 areas `committed:true`, and the first v2 line proved bound by editing its note and
watching the chain break. **What is still true and stated on the panel:** 1,632 lines predate v2
and their notes are not covered, and a rewrite of a WHOLE log from genesis still verifies — v2
closes the selective edit, the committed anchor closes the wholesale one, and neither closes the
other. A verdict that renders those as one tick has thrown away the distinction.

A chain has **two** independent ways of being green and meaningless, and a reader who has
internalised one will not look for the other: *never fed* (this entry) and *self-witnessed* —
`bin/lib/verdict-journal-core.mjs:409-411` anchors each journal's head under `CW_VERDICT_ANCHORS`, which
defaults inside the operator's own `$HOME`, so the journal, its anchor and the verifier share one
trust domain and a wholesale rewrite of both reports green (measured 2026-09-02).
The chain-tips store above had the same shape until its git-backed check landed
(`verifyChain(…, {committed:true})` in `monitor/history-chain.mjs`, run per area by the sweep); the
verdict-journal anchors still have no such check. And the env
override that makes such a store testable is not a seam by itself: one `npm test` wrote 360
fixture-area anchors into the real store because every rollup-spawning test uses a scratch
`CW_MONITOR_OUT` and none named an anchor store — the writer must also check the subject belongs
to the surface the store is for.

## An instrument that fails by returning something plausible — 2026-09-06

Five instances in one session, all mine, all caught late or by a peer. The family is not
"a tool broke". It is **a tool answered a question you did not ask, in a shape that parses**.

| what I did | what it returned | what I published |
|---|---|---|
| truncated a presigned URL with my own `.slice(0,110)` in printing code | HTTP 404, 36-byte JSON body | "0 errors on the base build" — the opposite of true |
| probed veld on three ports recalled from memory | connection refused ×3 | "veld is unreachable" — fleet-wide, from the wrong address |
| read a recall row's `content` when the field is `experience` | `[object Object]`, 15 chars | "the record stored nothing" |
| printed `slice(0,8)` of 12 prior-art hits | 8 rows, count `12` printed directly above | "no existing class holds this" — it was hit 12 |
| read `gh pr checks` for a required workflow that never ran | absent from the rollup | "it dropped off the list entirely" |
| subtracted a UTC field from a local-time field | 9h30m | "the MCP server restarted mid-session" |

**None of these errored.** Every one produced a value, and in four of six the value supported the
conclusion I already held — which is the direction that should worry you, because a result that
contradicts you gets checked and one that agrees does not.

**THE MECHANICAL FLOOR, for the fetch cases:** `bin/lib/fetch-checked.mjs` refuses rather than
reports. A non-2xx, an empty body or a body under `minBytes` throws, and the status refusal quotes
what would have been parsed. A caller cannot treat a failed fetch as an empty answer because there
is no value to treat. Use it for anything whose absence you might report as a zero.

**THE RULE THAT GENERALISES, and it is the only one here with a measured success record.** On the
same day, one argument of mine survived every challenge and every renaming: my exclusion of two
failing tests. It held because it used **no identifier and no tool summary** — only artifacts.
`registry-coverage.test.mjs` imports `registry.mjs`, `discover.mjs`, `area.mjs`; my commit touched
three files; none is read by that test. That argument cannot rot, because it never depended on
knowing who anyone was or on what a tool said about state.

So: **where a question can be answered from artifacts — imports, change sets, blob hashes, file
contents — answer it that way.** Reserve identifiers and tool summaries for *addressing* (whom do I
send this to) and never for *attribution* (whose work is this) or *absence* (is this thing gone).

**AND THE HONEST LIMIT OF THIS ENTRY.** Writing a trap down does not prevent it. Several of the six
above are already documented in this file — the pipeline `$?`, the truncated grep — and I hit them
anyway, hours after re-reading them. Treat a trap entry as a way to *recognise* a defect you have
already made, not as a control that stops you making it. The controls are the ones with a mechanism:
`fetch-checked` here, `--find` in `taxonomy-db`, the NEW-SINCE-LAST-RUN block in `gate-tests`.
## `mcpServers` in `.claude/settings.json` is inert — Claude Code never reads that key from there

Measured 2026-09-07. The operator asked why plans had stopped reaching spine. `.claude/settings.json`
carried a complete, correct `mcpServers` block naming `substrate` and the right absolute path to
`spine/mcp.mjs`. Claude Code reads that file for hooks and permissions and takes MCP servers from
`.mcp.json` (project) or `~/.claude.json`. There was no `.mcp.json` in the repo, and `~/.claude.json`
declared `mcpServers` for **zero** projects. So the block did nothing, and had been doing nothing
silently — no warning, no startup error, no absent-server line. A config that is present, valid,
and in the wrong file fails in the one way nothing reports.

**The server was never broken, which is why nobody found it.** Probed over stdio it answers the
handshake as `substrate-spine 1.2.0` and exposes 23 tools; `list_plans` returns rows; the store is
writable. Every layer anyone thought to check was healthy. The unchecked one was whether the file
could be read for that key at all — a presence check standing in for a reachability check, which is
the same defect this file records against gate-spine and the anchor stores.

**The cost**: eight sessions fell back to writing `spine/db.mjs` directly, tagging rows
`via="substrate MCP not attached to this session"`. Those rows were later read as evidence the tool
WAS reachable and granted a fleet-wide outage exemption — the measurement inverted by the shape of
the thing it measured.

**Correction to a commit's message, recorded here because a pushed commit cannot be amended on a
shared tree.** That message says substrate "has never been reachable by any session on this box."
That is refuted: one session measured 64 `create_plan` rows carrying REAL returned ids between
2026-08-13 and 2026-08-29, so filing demonstrably worked for two weeks. The misplaced config
explains the silence after the cutover and cannot explain the history before it. There is a second,
separate event — the task store at `~/.substrate/tasks.db` holds nothing older than
`2026-08-29T10:23:31.108Z` with `freelist_count 0`, i.e. it was replaced rather than emptied, and
its predecessor has not been found. Two failures that were each survivable alone: the first removed
the evidence, the second removed the writer.

**A WAL footnote worth keeping**, because it voided a leg of that diagnosis: `~/.substrate/tasks.db`
is in `journal_mode=wal`, so the main file's mtime does not move until a checkpoint. Reading it as
"last written Aug 30" while `tasks.db-wal` was being written the same hour is the sqlite version of
reading the wrong file. Check the `-wal` before concluding a sqlite store is idle.

**Superseded 2026-09-14.** The project `.mcp.json` that fixed this named the server `substrate` at
an absolute path from the other box, and the 2026-09-12 sync brought it here, where every session
reported `substrate` CONNECTION_CLOSED. Spine is now declared once in `~/.claude.json` as `spine`,
so the project file is removed. A per-box absolute path in a tracked MCP config breaks on every
other box; declare MCP servers at user scope.

## An unexported shell variable becomes `undefined` in the child, and the path built from it reads as ABSENT

Measured three times in one session, 2026-09-06/07, by the same person making the same mistake:

```sh
D=/some/path                 # a SHELL variable, not an environment variable
node -e '... process.env.D ...'      # -> undefined
node -e '...' D="$D"                 # -> an ARGV entry, not an env var. Also undefined.
```

Neither form reaches the child. `export D=...` or `D=... node -e '...'` do.

**Why it is worse here than a normal typo.** The result is not a crash, it is a PATH — `undefined/verdicts/liveness.jsonl` — and this repo's readers are careful about absence: they return `state: 'absent'` with zeroed totals rather than throwing. So the bug arrives wearing the costume of a clean result. On 2026-09-06 six verdict journals were verified this way and reported as `breaks: 0` — they had never been opened. `state: 'absent'` was sitting in the same object, unread, because the caller checked the field it wanted rather than the one that would have caught it. `totals.examined` exists because of this (`bin/lib/touch-chain.mjs`), and the rule it encodes is the general one: **assert the check EXAMINED something before believing what it reports.**

The third occurrence, an hour after writing that rule down, was `D="$D"` placed after the script. Knowing the trap does not close it; asserting `examined > 0` does.

## A partially-chained ledger has an unchained prefix, and rewriting a row there proves nothing

Found while negative-controlling `bin/chain-guard.mjs` against the live `verdicts/docs-doctor.jsonl`.
Rewriting line 6 changed its content and its hash, the line count stayed at 379, and the guard
correctly reported no degradation — because lines 6 and 7 carry **no `prev` field at all**. 7 of that
file's 379 rows predate the chain. A row whose successor does not link to it cannot orphan anything.

The chain was introduced partway through these stores' lives, so every one of them has such a prefix
(`store/touches.jsonl`: 84 of 1533 rows chained at one point; `docs-doctor.jsonl`: 372 of 379). When
building a negative control against a real ledger, **pick a row whose SUCCESSOR carries a `prev`**,
or the control passes for a reason that has nothing to do with the thing under test.

The first reading of that result was "the guard I just shipped does not fire." It fires; the subject
was wrong. Two candidate explanations were separated by measurement rather than by picking one — the
first control had also been vacuous (a `replace()` that matched nothing), which is worth stating
because a vacuous control and a broken tool are indistinguishable from the exit code alone.

## A hyphenated pseudonym substituted into an IDENTIFIER position still parses, and throws at runtime

The redaction sweep rewrites client names to pseudonyms across prose and code. Pseudonyms carry a
hyphen; identifiers cannot. Measured 2026-09-19 at a commit, in code that had been on `main` since
a commit on 2026-09-06:

```js
process.env.client-a_DIR        // parses: (process.env.client) - (a_DIR)
// ReferenceError: a_DIR is not defined
```

**`node --check` passes on it**, because it is valid syntax — a subtraction of an undeclared
identifier. Nothing is flagged until the line is evaluated, and `monitor/renovate-dryrun.mjs` only
evaluates it when `CW_RENOVATE_DIR` is unset, so the module was dead for every operator without that
variable and fine for the one who set it. It was found by a drifted-anchor re-read of an unrelated
finding on the same file, not by any gate.

Two properties make this worse than an ordinary typo. A string substitution cannot see the
difference between prose and an identifier, so one sweep over a mixed file changes both, and the
diff reads as uniformly harmless. And the repair was ALREADY in a working tree, uncommitted, for the
whole time — the author's own runs were green, so nothing pressed them to land it, which is the
worktree-invisibility class this file records elsewhere.

**Sweeping for it is cheap, and the sweep must cover every identifier position, not just `env`:**

```sh
git grep -nE "process\.env\.[A-Za-z_]*-[A-Za-z_-]*" HEAD -- '*.mjs' '*.js' '*.sh'
git grep -nE "\b(const|let|var|function)\s+[A-Za-z_]+-[A-Za-z_]+" HEAD -- '*.mjs' '*.js'
```

Run them against `HEAD`, never the working tree: the tree carries whatever fix somebody has not
committed, which is exactly the state that hid this one. Unquoted object keys, import bindings and
shell variable names take the same substitution and fail the same silent way.

### `PROJECTSTATUS.md` is built from stores a clone does not have

`node bin/projectstatus.mjs` writes the status document into `monitor/private/`, beside the issue
store and fleet registry it reads. It was tracked at the repository root until 2026-09-30 and moved
because it tabulates the fleet, which makes it an operational record.

The trap it carried while tracked is the one worth keeping. On a box without the stores, the
refresh did not fail. It succeeded and reported the absence as this repository's status. Measured
2026-09-05: regenerating on a checkout with no `monitor/private/` turned 33 scanned areas and
1,578 open issues into two grey rows, and `git diff` showed it as an ordinary refresh. An
unmeasured result must read neither as a pass nor as a finding, and an absence attributed to the
fleet rather than to the machine is the second of those. The refresh now refuses when the private
redaction map is absent, and its output lives where only a checkout with the stores can write it.

### A customer or fleet record is absent from every checkout but the operator's

Since 2026-09-30 the records that name customers, their repositories or the operator's estate are
private records under `monitor/private/` (the sidecar link), each resolved at call time in
`monitor/store-paths.mjs` with its own `CW_*` override: the annotation store, gate exemptions,
image acceptances, stub allowlist, owner map, programme worklist, config-correctness ledger,
per-area security annotations, BOLA manifests (`bola/`), the CRA product registry
(`cra-products.json`), the credential scope, the EPSS detail store, the disregarded-warning register, and the draft and
hidden docsite documents (`docsite/`). A fresh worktree or a public clone has none of them. Each reader treats that
as the record's documented absent state: the rollup applies no annotation or exemption, the stub
scan allows nothing, `image-acceptance.mjs` and `credential-scope.mjs` exit 2 with the reason, and
the docsite is the published site alone. So a rollup run in a worktree publishes rows the live one
suppresses. That is the absent state, not a regression. The tests that need a real record skip with
the reason; set the `CW_*` override to run them against a copy.

The old in-tree paths are ignored so a stray copy is not re-added. One leftover outside the tree:
`~/.commitwork/data-anchors.jsonl` is keyed by absolute path, so the anchor on the old
`monitor/annotations.json` reads JOURNAL-GONE once the file leaves. Retire it with
`node bin/verdict-journal.mjs --retire-data-anchor <old path> --reason "moved to monitor/private"`.

### `commit-phase --from-blob` from another worktree leaves the shared tree looking reverted

`--from-blob` lands supplied CONTENT and reads no working tree — that is the whole point of it, and
`bin/commit-phase.mjs` is explicit that the two forms are mutually exclusive. It `hash-object -w`s
the file you name, stages that blob into the private index with `update-index --cacheinfo`, and
never writes the worktree. Step 6 then `reset -q HEAD`s the SHARED index onto the new commit.

So when the content came from a *separate worktree*, the shared tree still holds the old file
afterwards and it now reads as ` M` against the commit that just landed — and any file the commit
ADDED is ` D` there, because it never existed in that tree. HEAD is correct. The tree looks like an
uncommitted revert of what you just did, and a peer's pathspec commit of that path would land the
old content back over it without either of you seeing a conflict.

**Repair it in the same breath as the land**, not later:

```sh
git hash-object -- <path>        # must still equal the @<base> blob you pinned
git checkout HEAD -- <paths>
```

The order is load-bearing and the second command is the dangerous one: `checkout HEAD --` discards
whatever is uncommitted at those paths, and on this tree that may be a peer's in-flight work. The
`hash-object` check is what proves there is none — it is a different question from the one
`--from-blob`'s own `@<base>` guard answers, which compares your pinned blob against **HEAD**, not
against the worktree. One guards against reverting what landed; this guards against discarding what
has not.

Land LF copies, not CRLF worktree files, or the blob you freeze picks up carriage returns that were
never in HEAD.

**And do not check that with `grep -c $'\r'`, in either direction.** Measured 2026-09-23, GNU grep
3.0 under Git Bash, against byte counts taken with node:

| file | real CR bytes | `grep -c $'\r'` | `grep -cU $'\r'` |
|---|---|---|---|
| LF, 3 lines | 0 | 0 | 0 |
| CRLF, 2 lines | 2 | **0** | 2 |

Bare, it reports **zero on a file that genuinely has carriage returns** — grep opens in text mode
and strips the CR before matching, so the idiom answers "clean" about exactly the file it was asked
to catch. `-U` (`--binary`) suppresses the stripping and both directions come out right.

The other failure is louder and easier to misread. Through enough quoting layers `$'\r'` can reach
grep as an EMPTY pattern, and an empty pattern matches every line: on the LF file above it then
returns 3, one per line, which reads as "every line has a CR" about a file with none
(`grep -c "" lf-probe.txt` → 3 reproduces it directly). Both failures are silent and they point
opposite ways, so a result from this idiom is not evidence in either direction. Count the bytes:
`node -e "…readFileSync(f).filter(b=>b===13).length"`.

### `git worktree remove` can fail, deregister the worktree anyway, and leave the directory

Measured 2026-09-23 on git 2.54.0.windows.1, Git Bash on Windows 11. The cause is a process whose
CURRENT DIRECTORY is inside the worktree — which on this box means a backgrounded
`cd <worktree> && node …`, i.e. exactly how a test run in a worktree is driven.

An open file handle is **not** enough. Control, same setup, handle held on `<wt>/package.json` with
the shell's cwd outside: removal succeeded, exit 0, directory gone.

```sh
git worktree add --detach <wt> HEAD
( cd <wt>/monitor && node -e "setTimeout(()=>{},25000)" ) &   # cwd inside
git worktree remove --force <wt>
#   error: failed to delete '<wt>': Permission denied
#   exit=255
git worktree list            # NO entry for <wt> — deregistered despite the failure
test -d <wt>                 # still there
git worktree remove --force <wt>
#   fatal: '<wt>' is not a working tree
#   exit=128
git worktree prune -v        # nothing to do, exit 0 — the directory is not its problem
rm -rf <wt>                  # the only thing that clears it
```

**The trap is the half-done job, not the failure.** The first call fails loudly and has already
deregistered the worktree; what survives is a directory git no longer knows about. A cleanup that
reads a non-zero exit as "nothing happened" and retries gets `is not a working tree`, which reads as
*already gone* and is a correct-sounding reason to stop. It is right that the worktree is gone. It
is wrong that the directory is.

So after a failed `git worktree remove`, do not retry it and do not reach for `prune` — neither
looks at the directory. Test for the path and `rm -rf` it.

One claim checked and NOT reproduced, recorded because it changes what you can rely on: the retry
was reported elsewhere as exiting **0** while printing `fatal:`, which would make
`git worktree remove … || cleanup` read the retry as success. Here it exits 128, and so does
`git worktree remove` against a path that was never a worktree at all. Both calls fail detectably
on this version. The hazard is not a silent success — it is a second error worded like an
all-clear.

### A plain `git commit` in a linked worktree starts a real sweep unless `CW_SELF_SWEEP=0`

Git hooks live in the COMMON git dir, so the `post-commit` hook that
`monitor/install-git-hook.mjs --write` installs fires for a commit in every linked worktree of this
repository, not only in the main checkout. It resolves `CW` with `git rev-parse --show-toplevel` —
the worktree — and starts that tree's own `monitor/sweep.mjs fast <area>` under `nohup`, in the
background, logging to the worktree's `reports/self-sweep.log`. The area is the one baked into the
hook when it was installed (`commitwork-admin` in the hook installed on this box, read 2026-09-27).

That is a real sweep, not a refresh. Before scanning anything, `monitor/sweep.mjs` runs
`bin/scanner-preflight.mjs --update` (`monitor/sweep.mjs:574`), which downloads the trivy database
and runs `grype db update` — network egress and a change to shared host state, started by a commit
whose author meant to record an edit. Recorded 2026-09-26: a sweep started from a worktree commit
ran exactly that preflight.

Two things hide it. The hook exits 0 at once and prints nothing, because the sweep is detached. And
`bin/commit-phase.mjs` never fires it, because it lands with `git commit-tree`, which runs no hooks —
so the sessions that commit the documented way never see it, and a plain `git commit` in a worktree
is exactly where it happens.

**Prefix every plain commit in a linked worktree with `CW_SELF_SWEEP=0`** — the hook's first line
exits on it. `CW_SWEEP_NO_PREFLIGHT=1` is not a substitute: it skips the preflight and still runs the
sweep.

The sweep also writes stores that live outside the tree. Recorded 2026-09-29: three commits in a D3b
worktree each anchored that worktree's stray `.claude/verdicts/*.jsonl` into
`~/.commitwork/verdict-anchors.jsonl`. That store is keyed by journal basename, so verification of
the real journals went to ALARM (REWRITTEN) until the main checkout re-anchored them with
`node bin/verdict-journal.mjs --anchor`. The same sweeps anchored the worktree's
`monitor/annotations.json` into `~/.commitwork/data-anchors.jsonl`, which is keyed by absolute path,
so removing the worktree turned it into a permanent JOURNAL-GONE. A store that is gone for a known
reason is now retired with `node bin/verdict-journal.mjs --retire-data-anchor <path> --reason "<why>"`.
Verification then reports it as `retired` rather than alarming, and a later anchor of that path
restores the guard.

The installed hook now exits in a linked worktree before it resolves `CW`, because
`git rev-parse --git-dir` differs from `--git-common-dir` there. Reinstall it with
`node monitor/install-git-hook.mjs --write` to pick that up. `CW_SELF_SWEEP=0` stays the explicit
form for hooks installed before the guard.

### A GitHub Actions step with no `shell:` has no pipefail, so `| tee` decides whether it passed

GitHub runs a `run:` step with no `shell:` as `bash -e {0}`. There is no `pipefail`, so
`cargo test --no-fail-fast 2>&1 | tee test-output.txt` exits with `tee`'s status. veld's Tests job
was written that way on 2026-05-21 and hid 216 failing tests until 2026-09-27; its summary step also
read only the last test binary's counts with `tail -1`.

`shell: bash` runs `bash --noprofile --norc -eo pipefail {0}` and is safe. `shell: sh` and custom
templates without pipefail are not. `bin/actions-gaps.mjs` reports the pattern as
`exit-masked-by-pipe`; on its first pass over the fleet it found 47 such steps, including veld's
clippy step and commitwork's own `node --check` loop.

Fix it with `set -o pipefail` at the top of the step, or `shell: bash`. A script that reads
`${PIPESTATUS[0]}` and exits with it is handled too.

### An empty `HOME` removes dyld's `$HOME/lib` fallback, and `DYLD_*` does not survive `sh`

When a dylib named through `@rpath` is not found, dyld falls back to `$HOME/lib`, reading `HOME` from
the environment. This machine has `~/lib/libclang.dylib`, a link to Command Line Tools' libclang, and
bindgen build scripts such as `librocksdb-sys`'s find libclang only through it. On 2026-09-28
`bin/hermetic-test.mjs`, running a build with an empty `HOME` to reproduce a CI runner, aborted that
build script with SIGABRT: `Library not loaded: @rpath/libclang.dylib`. An earlier empty-`HOME` run had
passed only because the build script had already run once with the real `HOME` and did not need to
run again.

Setting `DYLD_FALLBACK_LIBRARY_PATH` did not fix it. System Integrity Protection strips `DYLD_*` from
`/bin/sh` and everything it starts, and the prepare step ran through `sh -c`. The lane now puts one
link to the host's libclang in the empty home's `lib/`, which dyld reads through `HOME`, and names it
in the report. It is the counterpart of a runner's "Install LLVM" step.

### Git on exFAT reads macOS AppleDouble files as refs and pack indexes

On an exFAT volume macOS stores extended attributes as AppleDouble files named `._<name>`, 4096 bytes
each, beginning with the magic `0x00051607`. Inside a git repository they land in `.git/refs` and
`.git/objects/pack`, where git reads them as refs and pack indexes. On 2026-09-27 `git log` in a
repository copy on an external exFAT drive failed with
`non-monotonic index .git/objects/pack/._pack-….idx`: 43 such files were in `.git` and 15,950 in the
working tree.

Removing them fixed git, but any git write on exFAT recreates them; `git status` alone recreated
`.git/._index`. The drive was reformatted to APFS the same day.

Keep git repositories off exFAT. A repository that must stay on one should be treated as read-only,
with `core.fileMode false`, because exFAT reports every file as mode 755.

### A sandbox write test proves nothing if its path is already writable

The host sandbox makes the report directory, `TMPDIR` and `/tmp` writable for every lane. A test that
shows a lane can write a declared folder proves nothing about that folder's grant if the folder sits
under one of those paths. On 2026-09-28 the end-to-end test for the sweep's cargo folder
(`bin/test/cargo-target.test.mjs`) still passed with the write allowance deleted, because its root was
under `TMPDIR`. Once the root moved under `$HOME`, the test failed with the allowance removed.

Put a sandbox witness outside every path the sandbox already grants, and prove it by removing the
grant.

### `process.exit()` can hang forever on Node 24 and 26

`process.exit()` joins V8's worker threads without disposing the isolate. If one of them is a
background compile parked waiting for a GC, only the main thread can run that GC, and it is the
thread doing the join. The process never exits. Upstream this is
[nodejs/node#64274](https://github.com/nodejs/node/issues/64274); the fix,
[#66171](https://github.com/nodejs/node/pull/66171), was still open on 2026-10-07. A sampled hang
shows `Environment::Exit → NodePlatform::Shutdown → uv_thread_join` on the main thread and
`CollectionBarrier::AwaitCollectionBackground` on a worker.

It is rare for most scripts and frequent for allocation-heavy ones. `bin/docsite-og-image.mjs`
renders a 20 MB canvas and then exited. On Linux CI it hung 5 of 6 test runs, from 2026-10-06 to
2026-10-07, and each one surfaced as the 20-minute job timeout. Its test calls `spawnSync`, so one
hung child stalled the whole suite and printed nothing about which file. The hang reproduced on
macOS Node 26.7 as well: 1 in 40 runs of the test file, and 17 in 48 `--check` runs under
`--stress-concurrent-allocation`.
An uncaught throw takes the same path (3 in 48 under stress).

Set `process.exitCode` and return, and catch every error at the top so nothing reaches the
uncaught path. With that change the renderer hung 0 times in 96 stressed runs. Spawned children in
tests should carry a `timeout`, so a hang fails with a name rather than eating the job. 234
non-test modules here still call `process.exit()`, so a future CI timeout should be checked
against this first.
