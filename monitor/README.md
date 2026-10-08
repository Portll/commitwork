<!-- verified-against: 2026-10-08 -->
# monitor/ — the scheduled cross-project security monitor

Promotes commitwork from a per-repo local-CI runner into a **scheduled monitor over declared
areas**. No new server stack — a registry, a scheduler, a rollup, and viewers; the :7878 web
front end lives in [`admin/`](../admin/README.md).

_This file replaces MONITORING-SERVER.md (2026-07-29), which predated areas, the per-area report
dirs, the plist generator and the slice/ledger machinery._

## The unit: areas

`projects.json` is the registry. Explicit `projects` entries plus Steam-library-style `roots`
(org folders scanned for git repos up to `maxDepth`; explicit wins; `~/` expands per machine;
commitwork's own checkout is never auto-discovered). **Areas** (`areas[]`) are the declared unit
of report output, retention, freshness, deploy declaration and picker identity — registry-entry
to area is N:1 and declared, never inferred from a sweep's contents. `slug` is route/artifact
identity, `out` is the report dir under `reportsRoot`; they are distinct on purpose.
`monitor/area.mjs` is THE resolver (routing carried by `CW_MONITOR_OUT` in child env) — the
hardcoded `reports/clientA-monorepo` join is the bug class it exists to kill.

## The sweep pipeline

```
sweep.mjs [group] [project|--all] [--dry] [--repo NAME]   groups: all · fast · supply-chain · deep
`deep` is scheduled WEEKLY (Saturday, 18:00 ladder) by `install-agents.mjs` since D19 item 17; on demand it is the same command, `node monitor/sweep.mjs deep <area>`.
`node bin/offbox-fetch.mjs` pulls the latest attested off-box probe result into `CW_OFFBOX_EVIDENCE` for `deploy --verify` (six-hourly agent `com.portll.commitwork-offbox-fetch`).
  │                                                       (group may also be ONE check id)
  │  batch-manifest.json anchors each repo's SHA/branch/dirty state
  ├─ per repo: bin/commitwork.mjs run <group>  ──▶ reports/sweep-<stamp>[-<area>]/
  ├─ rollup.mjs <batch>   ──▶ reports/<area out>/{rollup.json, dashboard.html, REMEDIATION.md,
  │                            lifecycle.json, history/}   (exit 2 empty batch, 3 lock held)
  ├─ envelope-witness.mjs  (opt-in CW_LIVE_LLM=1, set on the scheduled `all` agents; live injection-corpus replay →
  │                         reports/prompt-envelope/corpus-live.json, the witness stpa-sweep.mjs and remediation-policy.mjs
  │                         read; exit 3 = skipped: fresh, or another replay holds .replay.lock)
  ├─ liveness.mjs · timeline.mjs · runtime-report.mjs · bin/races.mjs   (each non-blocking)
  │  batch-verdict.json + reports/<area out>/sweep-journal.jsonl — what HAPPENED, per step
  │  (the manifest is intent; the verdict pairs with it: rollup outcome, issues, preflight,
  │  host-inventory, races, durations — structured-only, this tree is tunnel-served; and the
  │  --all parent appends reports/sweep-fleet-journal.jsonl. Reader:
  │  `node bin/verdict-journal.mjs --tally`; liveness alarms when a rollup outruns its journal,
  │  and — since a commit, when the writer itself was dead for a day — when a CURRENT rollup has
  │  no journal at all. Absence beside a stale rollup still only reports: that one is an era gap)
  ├─ compact-reports.mjs --apply     retention (reports/ once hit 37G and took the fleet down)
  ├─ export-overwatch.mjs            rollup → memory-layer overwatch-layer (SUBSTRATE_EXPORT=0 disables)
  │  then memory-export-health.mjs classifies the receipts it wrote into the area verdict's
  │  `memoryExport` field — the child exits 0 on EVERY outcome, so its exit code is not evidence
  │  and the receipts beside the rollup are. Read with `since` = the slice start, because the
  │  receipts file sits at a fixed path and an export that skipped leaves the previous run's answer
  │  in place. Measured 2026-10-03 before the field existed: 34 of 34 rollups carried a receipts
  │  file, 42 of the 390 receipts in them recorded a write that never happened, and no verdict or
  │  panel surface named any of it. The same classifier feeds the Fleet tab's Memory export tile
  │  and admin/lib/memory-view.mjs, so the page and the verdict cannot disagree.
  ├─ --map / MAP_REFRESH=1: modernization.mjs + map/render.mjs
  └─ bin/projectstatus.mjs           PROJECTSTATUS + html refresh (diff-driven, best-effort)
```

Omitting the project argument sweeps the **active primary area only**; `--all` sweeps every
project. Preview the resolved fleet with `node monitor/sweep.mjs all --dry`.

**Narrowing a sweep.** `[group]` is passed through to `commitwork run`, which accepts a group *or a
single check id* — so `sweep.mjs sast clientA` re-runs only Semgrep across that area. `--repo NAME`
narrows to one repo; it is applied *after* the area filter, so it can only ever select from repos
the scope already permitted, and naming a repo outside the scope exits 2 rather than widening to
find it. Both are what the panel's ⏺ buttons drive (see `admin/README.md`); `monitor/scanner-checks.mjs`
maps a rollup scanner category to the check id that produces it, and a test holds it against
`SCANNER_SPECS` in `extractors.mjs`.

Flags that take a value (`--jobs`, `--repo`, `--exclude`) have that value skipped when positionals are parsed —
before this, `sweep --jobs 4` parsed as group `4`.

## Slices, lifecycle, ledger

Every rollup is a **slice** — a historically accurate cut through the fleet
(`schema/slice.schema.json`): KEV/EPSS enrichment frozen per slice (`history/enrichment/`),
provenance-gated lifecycle (`born | persisting | resolved-* | unknown-not-scanned` — a finding may
only *resolve* if its repo was scanned AND its tool provably ran; grey ≠ green), and
`ledger.mjs` → `remediation-ledger.json` recording each verified fix with tiered evidence
(strong = lockfile diff between git anchors, medium = fix version known, weak = NOT counted).
`monitor/private/annotations.json` (`CW_ANNOTATIONS`; a private record, absent means nothing is
annotated, `monitor/annotations.example.json` is the shape) applies human acceptances as-of each
slice's timestamp — `annotations[]` for
dependency CVEs (wildcard-by-omission matcher), and `scannerAnnotations[]` for scannerFindings
rows under a STRICT matcher: every field of the category's identity tuple (`detail-schema.mjs
identity`, never `line`) plus `repo` is required, `scope:'fleet'` is the only fleet opt-in, and
each record's fate is published in `rollup.scannerAnnotationStatus` (applied / noMatch / expired /
invalid / carried). `carried` is the un-evaluated state: the carry block installs a skipped
category's rows — annotations already attached — *after* the overlay runs, so records in a carried
category were never matched against anything this slice. They are not `noMatch`, which means "I
looked and this suppression matched nothing" and is the cue to hunt a typo'd path. An annotated
row keeps its place with `annotation` attached; only the aggregates (and
headline totals) drop, with `annotated` recorded beside them. Authoring: `bin/annotate.mjs` (CLI,
refuses zero-match writes against `--check-rollup`) or the panel's scanner tabs
(`POST /api/annotations/scanner`, session-attributed). `timeline.mjs` /
`timeline2.mjs` render the fleet grid, two-slice diffs and per-finding worldlines; `history/corrected/`
holds the three-tier corrected index (`corrected-history.mjs`, checked by `verify-corrected.mjs`).
Rollups serialise via a lockfile (`lockfile.mjs` adds the root-wide scope); re-rollups are
byte-idempotent. Pre-v1 history is preserved untouched and marked in each area's `LOG.md`.

Every category declared in `detail-schema.mjs` emits **per-finding detail**: `repos[].scanners.<key>.findings`
and the fleet-flattened `scannerFindings` block (secrets → rule/file/line/commit, whitelisted so no
gitleaks `Secret`/`Match` field can ever cross; OSV `MAL-` → id/package/version/ecosystem/advisory;
GuardDog → rule/package/version/message). Capped at 10,000 rows per repo and category with the drop RECORDED
(`truncated`), sorted so re-rolls stay byte-identical, and carried across narrow sweeps alongside
the counts — a group-scoped sweep must not empty the panel's drill-down while the count still
stands. Counts (`total`) are never capped; only the row list is.

The slice's `new/fixed/carried` counters above are **dependency-lane only** (they diff
`findings[]` and clear the ledger's evidence bar). The scanner lanes carry their own diff:
`scanner-delta.mjs` → `slice.scannerDelta` (+ `scannerNew`/`scannerFixed` on the index row),
computed per category between consecutive slices. Identity is the **place** — `repo | category |`
the category's `detail-schema.mjs` identity tuple, never `line` — so pure line movement and
partial row reduction inside a place are not fix events; a place is *fixed* only when all its rows
are gone from a slice whose scanner **ran in both slices** (a carried or skipped category refuses
comparison with a named status and `null` counters — never 0). Its "fixed" is **scan-absent
tier**: weaker than the dep ledger's lockfile proof, and every consumer labels it as such.
`timeline.mjs` draws it as a third cumulative line plus a per-category/rule fixes panel;
`backfill-scanner-delta.mjs` retrofits it onto existing histories (dry-run default, `--write`
under the reports lock, idempotent, ENOENT-pruned slice bodies skipped). It commits the index
row's `sliceSha256` after **every** rewrite, not once at the end — an index-last walk that threw on
its sixth slice orphaned five (2026-09-01) — repairs a hash whose bytes moved behind a current
delta, stops by name on a corrupt slice (exit 2: the next delta would be computed against it), and
re-reads the disk afterwards with `store-consistency`'s `checkHistoryIndex` (exit 4 on anomalies).

Every slice write is also recorded in `history/chain.jsonl` (`history-chain.mjs`): rollup seals any
unrecorded rows, appends one event per write (`replace` on a re-roll), and copies the new tip to
`.claude/store/chain-tips.jsonl` in the sidecar. `verifyChain` reports four separate facts, and they never collapse into one tick: `unrecorded`
(a write the log never saw), `drifted` (an index row whose hash is not what the log last recorded —
a slice rewritten together with its hash, which stamp-only verification could not see), `anchored`
(consistent with the LOCAL anchor — same disk, same uid as the chain, so a consistency check rather
than evidence), and `committed` (the newest anchor at the sidecar's HEAD, read with `git show`,
opt-in via `{committed:true}`). `committed` is tri-state on purpose: `null` undetermined (no repo,
nothing committed yet), `false` HEAD contradicts the chain, `true` the committed tip is in it. It
never upgrades `verified` or `anchored`, and `null` never reads as a pass. `bin/anchor-commit.mjs`
is the pathspec commit between the local file and its committed copy (`--check`, `--push`; every
git call bounded, push reporting "committed, not pushed" on timeout); `sweep.mjs` prints all four
per area after forensics, and `CW_ANCHOR_COMMIT=1` opts a sweep into committing the store.

Chain lines carry a `chainVersion`. Version 2 (from 2026-09-06) hashes EVERY field on the line
except `prev`/`chain`, canonically — so `note`, `resealedAt` and any flag are bound. Version 1
hashed six fields and left the rest editable. The body is chosen per line from the line's own
`chainVersion`, so no re-seal was needed: old lines verify as written, new ones are fully bound,
and adding or stripping the field recomputes under the wrong body and breaks. `v1Lines` and
`protectedFrom` on the verdict say where full binding starts rather than letting "verified" imply
it everywhere. What v2 does NOT stop: rewriting the whole log from genesis is self-consistent and
verifies — only the committed anchor catches that. `source` on slices, index rows, `rollup.json` and the dashboard is the batch dir
relative to the reports root (`area.mjs` `sourceKey`); rows recorded absolute before 2026-09-02
key identically, so re-rolls still dedupe.

## Retention — two axes, and they union

`compact-reports.mjs` is the only thing that removes anything under `reports/`, and what it removes
is narrow: **regenerable CodeQL database internals only**. Every `*.sarif`, summary and per-repo
JSON/log survives, and a whole batch dir is never deleted — so "retention" here is a *database*
window, not an evidence one. Each pruned batch gets a `prune-manifest.json` carrying the anchor SHA
and a rebuild recipe.

`retention.mjs` owns the policy and is pure; the compactor only acts on it. Two axes, declared
top-level in `projects.json` and overridable per area:

| key | meaning |
|---|---|
| `keepFullSweeps` | newest N batches **of each area** kept whole. A global slice would let a busy area starve a quiet area's newest batch. |
| `keepDays` | age floor in days. A batch inside the floor keeps its databases regardless of rank. |

They **union, never intersect** — a batch survives if it satisfies *either*. Protection only ever
adds, because the consumer deletes: "the two rules disagree" must resolve to keeping.

An area may declare its own `retention: { keepFullSweeps, keepDays, note }`, which replaces the
global for that area only; unknown keys inside it are **errors**, not warnings, so a typo cannot
silently restore the global on the one area someone deliberately singled out.

Age comes from the batch **name** (`sweep-YYYYMMDDHHMMSS`, UTC, stamped by `sweep.mjs`), never
mtime — pruning rewrites mtime, so an mtime-aged batch reads as freshly created the instant it is
compacted and would never age out again. A name whose stamp will not parse is **protected and
excluded from the newest-N quota**: unknown age is not permission to delete, and an unparseable
stamp sorts wherever its digits fall, so letting it compete would spend the slot the genuinely
newest batch needed.

Current declarations: global `keepFullSweeps: 1`; `commitwork-admin` adds a `90d` floor (commitwork's
own posture is P0, so a historical query stays re-runnable against the real database for a quarter).
Since the 2026-08-22 merge that area is **one area of four projects** — `commitwork`,
`commitwork-web`, `commitwork-research`, `commitwork-remote` — so the floor covers the whole
commitwork surface. The corpus area deliberately has **no** floor: that is where the 13G-per-sweep
lives, and giving it one means redoing that arithmetic first.

The three merged-away `out` dirs (`commitwork-web`, `-research`, `-remote`) are listed in
`retention.protect`. They are no longer any area's output, so without that they would fall to the
"undeclared, protected by default" path and read as junk awaiting cleanup — they are neither: they
hold 27 history slices kept deliberately, so the merge stays reversible.

## Archiving batches — a verified portable copy, not an offload

`archive-batches.mjs` writes one encrypted, compressed file containing whole batch dirs, plus a
sealed manifest. It **never deletes and never uploads** — offload and deletion stay human acts.
`archive-container.mjs` owns the format and is testable without touching `reports/` or the keychain.

```sh
node monitor/archive-batches.mjs --dry                 # what would be shipped; writes nothing
node monitor/archive-batches.mjs [--older-than DAYS] [--area SLUG] [--level N] [--redact]
node monitor/archive-batches.mjs --verify <file.cwar>  # separate invocation, re-fetches the key
```

**Encrypted at full fidelity, not redacted.** The raw per-batch reports carry plaintext secret
*values* — measured 2026-08-23: 172,695 gitleaks records each carrying its `Secret`, 7,518 distinct,
plus 2,568 TruffleHog `Raw` values. `rollup.mjs` whitelists those out of the *published* artifacts;
that whitelist never applied here. The first design redacted by denylist over `Secret`/`Match`/`Raw`
and missed `snippet.text` — Semgrep and CodeQL SARIF carry the matched source line, which for a
secret rule *is* the secret. A denylist cannot see a field nobody told it about, so safety rests on
the key and fidelity is preserved. `--redact` exists for a deliberately lower-fidelity artifact and
is **not** the safety mechanism.

**Why frames.** Single-shot GCM over a 500 MB file authenticates only at the end, and naive chunking
is *truncatable*: drop the trailing frames and every survivor still verifies. Each frame's AAD binds
`version || archiveId || frameIndex || isFinal`, and the manifest — carrying the total frame count —
is sealed **inside** the ciphertext. Truncation then fails three ways.

**The key** is 32 random bytes in the login keychain (no passphrase, no KDF), printed **once** to
stderr for escrow. There is no `--key` flag: argv is visible in `ps`. A malformed keychain item is
an error, never a reason to mint a second key — that would orphan every existing archive.

**Coverage is keyed on VERIFIED archives only.** A build does not count; `--verify` does. Counting
an unverified archive would let a partial run mask a gap that someone then deletes the source for.
Selection excludes the newest batch of each area and anything under 6h old, because sweeps write
~54 batches/day and a batch copied mid-write hashes fine and restores wrong.

Measured on this tree: 1332 eligible batches, 15.9 GB raw, 8275 secret-bearing files. Area-grouped
`zstd -3` compresses batch output ~38x (19.07 GB → 0.50 GB); per-file `zip -9` manages 14.8x on the
same bytes, because ~90% of the win is cross-batch redundancy that per-file compression cannot see.

## Scheduling — do NOT copy the plists

No plists are committed. Hand-written ones hardcoded another machine's home, node and PATH, which
is how the freshness deadman came to be installed-but-dead. Generate them instead:

```sh
node monitor/install-agents.mjs                # dry run
node monitor/install-agents.mjs --write --load # install: per-area nightly sweeps 15 min apart from 02:30, weekly areas
                                               # Sunday 01:00, Saturday 18:00 deep sweeps, hourly liveness, and the
                                               # panel, cra-watch, offbox-fetch and sitemap-data agents
```

The `all` sweep agents carry `CW_LIVE_LLM=1`, so the first sweep to find the envelope witness
stale replays the injection corpus through `claude -p` under the operator's own login (no API key)
and the rest skip until it lapses again, seven days later. The deep agents do not carry it.

`liveness.mjs` is the deadman: fresh ⇒ 0, expired/unknown ⇒ 1, fanning out over every area when
given no argument. `freshness.mjs` is the pure decision module behind it.

**On-commit self-refresh.** `node monitor/install-git-hook.mjs --write` installs a `post-commit`
hook (dry run without `--write`; `--uninstall` removes it; a hook it did not write is never
clobbered or removed unless `--force` is given with `--write`). Each commit to this checkout spawns a detached `sweep fast <self-area>` —
the area is resolved at install time from the registry entry declaring this checkout, never
guessed, and the absolute node path is baked in (a GUI commit has no shell PATH; that is how the
plists died). The panel serves its artifacts from disk per request, so the sweep finishing IS the
published web updating — no push step. `CW_SELF_SWEEP=0` skips a commit without uninstalling;
overlap is refused by the sweep's own lock (`reports/self-sweep.log`, exit-3 lines are benign).
The hook bakes `CW_PROJECTSTATUS=0`, so the self-sweep does not regenerate the status document on
every commit; scheduled and manual sweeps refresh it in `monitor/private/`.

## Issue tracker — monitor/private/issues.json

`issue-store.mjs` is the tracker's single owning library (store, mint, lifecycle, ready-work
detection, ingest + evidence-gated auto-close); `bin/issue.mjs` is the CLI (command table and
exit codes in [`bin/README.md`](../bin/README.md#issue-tracker--issuemjs-and-issue-loopmjs)).
It is the fifth remediation tier: it **references** the other four (rollup finding keys, ledger
evidence tiers, annotations, queue entry ids), never duplicates their data.

**Store format.** `monitor/private/issues.json` (`CW_ISSUES` overrides), versioned in the private
sidecar repository and never edited by hand (the
`cra/cases.json` discipline). `events[]` is the append-only, **hash-chained** evidence trail
(each event carries `prevHash` + its own chain hash); `issues{}` is derived current state;
`byKey{}` maps sourceKey → ISS id (idempotent mint — a reopen is the same id coming back, never
a duplicate); `lastIngest{}` guards slice monotonicity (an old rollup replayed mutates nothing).
`node bin/issue.mjs verify` recomputes the chain and cross-checks the derived state (exit 3 on
any break). Loading fails closed: only `ENOENT` means empty; corrupt/unreadable is an error,
never "no issues". Because the chain orders events linearly, the store tolerates a **linear git
history only** — a merge that interleaves two divergent `events[]` tails cannot be reconciled;
rebase, don't merge.

**sourceKey namespaces** (identity of what an issue tracks):
`f:<finding key>` dep finding · `g:<repo>|<pkg>` grouped below-threshold findings ·
`sc:<repo>|<category>|<rule>|<file>|<line>` scanner row ·
`gs:<repo>|<category>|<rule>` grouped scanner rows (always-grouped categories via
`CW_ISSUE_GROUP_CATEGORIES`, default `secretsHistory`; or any rule firing ≥
`CW_ISSUE_GROUP_THRESHOLD` rows in one slice, default 5 — identity is sticky both ways so a
triple never flips between grouped and individual) · `q:<anchor>|<id>` audit queue entry.
Manual issues have no sourceKey and always mint fresh.

**Auto-close is evidence-gated, never absence-gated** (condensed decision table):

| Source | Closes when | Merely absent |
|---|---|---|
| `f:` dep finding | ledger evidence tier strong/medium for its exact key | scan-absent evidence appended, stays OPEN |
| `g:` group | every member has strong/medium ledger evidence | stays OPEN |
| `sc:` scanner row | row gone AND anchored code line demonstrably changed (hash mismatch / file gone) | row gone + line unchanged ⇒ marked `suspect`, stays OPEN |
| `gs:` grouped rows | never auto-closed (no per-row anchor can prove drift) | all members absent ⇒ marked `suspect`, stays OPEN |
| `q:` / manual | never auto-closed | — |

An unscanned area, a tool with missing provenance (missing = NOT-ran, fail closed) or a rollup
older than the last ingested slice mutates **nothing**; a closed issue whose sourceKey reappears
REOPENS under the same id.

**A CARRIED category did not run.** When a sweep does not re-run a scanner, the rollup chains the
previous slice's counts *and rows* forward and sets `carried: true` — while leaving `ran` at the
carried value. So `ran > 0` alone reads TRUE for a tool that produced nothing this slice, and
before `categoryRan()` also required `!carried`, that fed the `sc:` anchor-drift rule above with
an earlier slice's rows: a live finding absent from the chained set closed as FIXED on a scan that
never happened. Measured 2026-08-04 on the live commitwork-admin rollup (`sastCodeql`
`{ran:1, carried:true, carriedFrom:'sweep-20260803173004'}`) — the old gate closed one issue and
marked four suspect where the new one correctly touches nothing. `ingest --json` now reports
`skippedReasons` per category (`carried` vs `not-ran`), because those are different facts.

**When the ingest runs.** `monitor/sweep.mjs` ingests the area it just rolled up, in-process under
the store lock, after the rollup publishes and before the timeline rebuilds. It never fails the
sweep; a failure prints that the tracker is now BEHIND. It was previously a manual command nothing
ever called, and the tracker froze at whatever slice someone last typed it against — on 2026-08-04
that was fourteen hours and several slices behind the live rollup. The panel's Issues tab compares
`lastIngest` to the live rollup and renders **BEHIND** as its own state beside `never-ingested`;
`POST /api/issues/ingest` is the manual path, and it is the same `ingestArea()` with the same gates.

**Lodged fixes (`issue.fix`).** A human's account of how a finding was addressed:
`{fixType, notes, who, at, dispositionId}`, written by `lodgeFix()` (panel: `POST /api/issue/fix`).
`fixType` is one of `code-change` · `config-change` · `dep-upgrade` · `compensating-control` ·
`suppression` · `wont-fix`. It is a **claim**: it never touches `state`, `closedAs` or `evidence`.
Distinct from `issue.remediation`, which is the *scanner's* suggestion captured at mint
("fix available: 4.17.21"), and from `dispositions[]` (`ingest-external.mjs`), which is a ruling on
whether the finding is real. Three different questions, three fields, none of them a close.

**SLA escalation — `issue-escalate.mjs` (the actuator).** Every open issue carries `slaDueAt`
(`SLA_TIERS` in `lifecycle.mjs`: crit 7 d · high 30 d · med 90 d · low 180 d) and `lifecycle.mjs`
*detects* a breach; until 2026-08-23 nothing *acted* on one (measured: 977 open, 14 past due, all
crit, median 11.2 d over, 0 claimed, 0 attempted). `node monitor/issue-escalate.mjs` mirrors
`cra/escalate.mjs`: it selects issues that are `open`, past due, with no claim and `attemptCount`
0, and no chain-covered `paged` event keyed `{issueId, slaDueAt}`; POSTs one **opaque** body per
issue (`ref = sha256("issue-page|"+id)[0..16]`, severity tier, days overdue, run count — never the
id, title, repo, area, rule or path) to `CW_ISSUE_WEBHOOK_URL` (resolved through `lib/secrets.mjs`;
**https only**; deliberately not `CRA_WEBHOOK_URL` — an issue page is a work-queue nudge, a CRA page
is a regulator clock, and sharing a channel lets the noisier one train the reader to ignore the
other); and only **after** delivery appends the `paged` event under `withIssuesLock`, re-loading
the store inside the lock and schema-validating before the atomic save. The record's
`escalated`/`escalatedAt` are a projection of that event, written beside it — the event is the
truth, and a reopen that moves `slaDueAt` re-arms the page. Flags: `--dry` (list, POST nothing,
write nothing, exit 0) · `--json`. Env: `CW_ISSUE_WEBHOOK_URL`, `CW_ESCALATE_NOW` / `CW_NOW`
(clock, read at call time), `CW_ISSUES`, `CW_ISSUE_SCHEMA`, `CW_SECRETS_FILE`. Exit **0** nothing
due or every page delivered and recorded; **2** unknown argument (an unrecognised flag must never
fire real pages); **5** an overdue, untouched issue is left unpaged — no webhook configured (the
message names the env var), non-https target, delivery failure, delivered-but-unrecorded, or an
unreadable store. A second run over the same `slaDueAt` pages nothing. **Scheduling it is an
operator act**: this file declares the command and its contract; wiring it into a LaunchAgent
(after the sweep's ingest, the way `cra/escalate.mjs` follows `cra/watch.mjs`) is applied by a
human and is not done here.

**ISS- vs CWX-.** ISS- is a parallel id space to CWX-: CWX- encodes "self-found vulnerability"
provenance (`cwx-registry.mjs` identity rule) and overloading it for work items would corrupt
that rule. Same 6-char overflow ladder, same idempotent-mint discipline, different prefix.

## What a severity is a severity OF (`LANE_KINDS`, 2026-08-26)

`crit/high/med/low/undetermined` was one scale over an unpartitioned population, so a licence-policy
alert and a remote-code-execution finding summed into the same number. Every lane in
`lane-kinds.mjs` (lifted out of `extractors.mjs` 2026-09-05, and re-exported by it) now declares
`{kind, additive, actionable, why}`:

- **kind** — what is claimed, and therefore what a reader should DO: `vulnerability` (exploitable) ·
  `posture` (a control's state) · `integrity` (is this artifact what it claims) · `policy` (a rule
  *we* chose) · `hygiene` (a real defect, not a security claim).
- **additive** — does the lane reach the flat severity sum. `false` states which of two unrelated
  reasons: `duplicate` (another lane already counted this data) or `not-a-vulnerability`.
- **actionable** — may a row be handed to somebody as work (operator ruling D4).

`TOTALS_EXCLUDE` and `METRIC_CATEGORIES` are DERIVED from it, so the two lists cannot drift from the
reasoning above them. `sumTotals` returns `byKind` alongside the flat totals — a partition of the
same counts, never a filter. A lane whose rows carry different kinds (Socket is five claims in one
lane) supplies its own `byKind`, which wins over the lane-level declaration. **An undeclared lane
lands in `unclassified`, never folded into `vulnerability`** — a lane arriving without a declaration
shows as a gap rather than as a vulnerability nobody made.

## Registering a scanner lane — eight places, and the test that catches each (2026-09-02)

A lane is not registered until it appears in all eight. This list existed only in session handoffs
until now, which is why it kept being rediscovered by registering rather than by reading.

**Every one of the eight is enforced.** Measured 2026-09-02 by mutation, not by reading the tests:
in a detached HEAD worktree, `nodeHazards` was deleted from each registry in turn and the suite
re-run, with the result taken as the *delta* in failing test names against that worktree's own
baseline (a pristine worktree carries ~20 pre-existing failures from absent gitignored stores, so
absolute counts mean nothing here). No omission passed silently.

| # | where | key form | what fails if you miss it |
|---|---|---|---|
| 1 | `manifests/security-baseline.json` → `checks[]` | `id: node-hazards` | `monitor/test/scan-scope.test.mjs:138`, `approach-taxonomy-coverage.test.mjs:103` |
| 2 | `monitor/scanner-checks.mjs` | check id | `monitor/test/category-class-completeness.test.mjs:64` |
| 3 | `monitor/extractors.mjs` → `SCANNER_SPECS` | camelCase key | `category-class-completeness.test.mjs:44` + `:64` |
| 4 | `monitor/lane-kinds.mjs` → `SCANNER_LABELS` | camelCase key | `scanner-checks.test.mjs:67`, `scanner-registry.test.mjs:17` |
| 5 | `monitor/lane-kinds.mjs` → `LANE_KINDS` | camelCase key | `lane-kinds.test.mjs:59` |
| 6 | `monitor/detail-schema.mjs` | camelCase key | **136 failures across the suite** — see below |
| 7 | `monitor/perf-profiles.json` → `scanners` | **hyphenated check id** | `perf-tuning.test.mjs:32` |
| 8 | `monitor/issue-key.mjs` → `CLASS_FOR_CATEGORY` | camelCase key | `category-class-completeness.test.mjs:29` |

**Registering #6 also wires suppression.** The annotation store's scanner-annotation route is
generic over any category present in `detail-schema.mjs`'s `ROW_SCHEMAS`, so a lane becomes
annotatable the moment it appears there — no separate step. Verified 2026-09-02 through the consumer:
`applyScannerAnnotations` returns `applied: 1` for a `nodeHazards` annotation, marks only the matching
row, and leaves a same-rule row at a different file alone. Do not go looking for a suppression wiring
task after registering a lane; there isn't one.

Plus `admin/index.html`'s `SCANNER_LABEL` fallback (`admin/test/lane-registry-derivation.test.mjs:33`),
and a schema regen — `node monitor/detail-schema.mjs --write`.

**Two traps the table encodes rather than describes.**

*The key form is not uniform.* Seven registries take the camelCase key (`nodeHazards`);
`perf-profiles.json` and `security-baseline.json` take the hyphenated check id (`node-hazards`), and
`perf-profiles` nests it under `scanners`, not at the top level. A grep for the camelCase key
therefore reports a lane "missing" from `perf-profiles.json` that is correctly registered — this was
measured happening during the very check that produced this table.

*A missing `detail-schema.mjs` entry does not look like a registration gap.* It produces **136**
new failures against 1–2 for every other registry, because the schema is load-bearing far outside
the lane. If a single omission has turned the suite red across unrelated files, check #6 first
rather than reading 136 stack traces.

**Both halves must land in ONE commit.** `scan-scope.test.mjs` fails the moment a category names a
check id the manifest lacks, so a half-registered lane has no green state and splitting the commit
cannot be made safe. `monitor/test/lane-kinds.test.mjs` snapshots are needed **only** for
non-additive lanes (`lane(H,…)` or `lane(V,'duplicate')`); a plain `lane(V)` needs none.

## Module map (one line each; headers in each file are authoritative)

Registry/derivation: `registry.mjs`, `area.mjs`, `discover.mjs`, `project-scope.mjs`.
Pipeline: `sweep.mjs`, `rollup.mjs`, `health-sweep.mjs`, `compact-reports.mjs`, `retention.mjs`
(pure policy), `archive-batches.mjs` + `archive-container.mjs` (verified portable copies; never
deletes, never uploads), `lockfile.mjs`.
BOLA (object-level authz): `bola-fleet.mjs` (resolves the areas that declare a `bola` block —
manifest + testbed base — their credential readiness via `lib/secrets.mjs`, and the latest
`reports/<out>/bola-latest.json`; readiness is judged DECLARED-or-SET, never by probing a keychain
value, so it is safe on the panel poll), `bola-sweep.mjs` (the on-demand per-area run the panel's
BOLA tab triggers — refuses unless secrets are configured, drives `bin/bola-run.mjs`, persists the
result). An area's `bola` field is a DECLARATION like `deploy`: it names the manifest + local
testbed base and holds no credentials.
Scanner artifacts: `extractors.mjs` (one reader per artifact, `(dir,file) -> counts`). Its readers
live in part modules under `extractors/`, grouped by what the lane reads (SARIF, SAST/lint, supply
chain, Socket, secrets, posture, DAST, tree contents, the agent surface, commit history);
`extractors.mjs` keeps `SCANNER_SPECS` and re-exports every name, so importers only ever name it.
Its header carries the map of which part holds which reader, and
`monitor/test/extractors-source.test.mjs` fails if a part is missing from that map.
Also:
`lane-kinds.mjs` (the lane register: `SCANNER_LABELS` names each lane, `LANE_KINDS` says what it
CLAIMS, and `sumTotals`/`partitionByKind` are the headline arithmetic over both — nothing in it
reads a file, which is why it is no longer inside `extractors.mjs`),
`detail-schema.mjs` (ONE declaration of a drill-down row per category — `rollup.mjs`'s DETAIL_KEYS,
the published `schema/scanner-finding.schema.json` and the panel's columns all derive from it, and
`rowsFor()` CONSTRUCTS each row from the declared fields so an undeclared one cannot reach a
browser), `scan-scope.mjs` (what each scanner was NOT allowed to look at), `scanner-checks.mjs`.
Truth layer: `lifecycle.mjs`, `ledger.mjs`, `annotate-lib.mjs`, `attribution.mjs`,
`validate-authored-judgment.mjs`, `cwx-registry.mjs`, `defence-vector.mjs`, `dwell.mjs`,
`freshness.mjs`, `liveness.mjs`, `issue-store.mjs`, `scanner-delta.mjs` (the scanner lanes'
place-keyed new/fixed diff — see "Slices, lifecycle, ledger").
Population and reachability — what a finding is ABOUT, decided before what it is worth. Each
classifies and never drops: the row keeps its identity, its original claim and its place in the
artifact, and moves out of the headline counts into a named state. `unknown.mjs` is the shared
predicate (one boolean, one closed reason set — a lane inventing a sixteenth adjective for
"unknown" is the defect it exists to prevent). `fixture-paths.mjs` separates a test corpus from the
software: 723 of the fleet's 800 criticals sat under `spec/fixtures/`, all real, none describing the
project. `advisory-reach.mjs` asks whether a malicious-package advisory could have reached the
installed version at all — npm requires semver, so a non-semver version was never resolved from the
registry and an npm SEMVER range cannot have matched it; the MAL- lane was 3 for 3 false without it.
`corroborate.mjs` marks the 135 osv/npm row pairs that are one advisory under two ids — as a VIEW,
never a merge, because identity includes the tool and a deleted key is how the ledger says FIXED.
The same module's `markSastPlaceCorroboration` (meta-SAST, added 2026-09-01) does the SAST-side
equivalent: Semgrep, CodeQL, gosec and the rest are peer scanners with no shared advisory namespace
to join on, so it keys on `repo|file` instead, tightened to `repo|file|CWE` when both rows assert
one (via `sarif-read.mjs`'s `cweOf()`, which reads CWE tags the scanners were already shipping and
this tree previously dropped at the door — see that module's own header). Two tools on the same
file is corroboration; sharing a CWE too is corroboration on a CLAIM, not just a coincidence of
location, and the twin is labelled `[cwe]` so a reader is never told the weaker one in the
stronger one's word. Serialized as a capped string (`corroboratedBy`) rather than the SCA join's
array of objects, because these rows pass through `detail-schema.mjs`'s strict `validateRows()`,
which has no array/object field type. Same discipline as its sibling: additive only, `rule`/`file`
untouched, `CW_CORROBORATE=off` disables both.
`dep-provenance.mjs` records where each dependency actually resolved from and reports the
MIGRATION between slices, not the state, since a git-pinned dependency is ordinary and moving off a
registry is the event. `sbom-provenance.mjs` puts back what syft's CycloneDX writer drops, so the
SBOM stops asserting a registry identity for something the registry never served (upstream:
anchore/syft#5230).

History: `corrected-history.mjs`, `verify-corrected.mjs`, `backfill-dimensions.mjs`,
`backfill-docs.mjs`, `backfill-scanner-delta.mjs`, `retro-ledger.mjs`, `sync-map-history.mjs`.
Viewers/exports: `timeline.mjs`, `timeline2.mjs`, `runtime-report.mjs`, `codeql-fleet-data.mjs`,
`sitemap-data.mjs`, `sitemap-overlays.mjs`, `modernization.mjs`, `refresh-modmap.mjs`,
`export-overwatch.mjs`, `deploy-state.mjs`, `memory-export-health.mjs`.
Deps: `renovate-dryrun.mjs`, `renovate-status.mjs`. Infra: `install-agents.mjs`,
`image-acceptance.mjs`, `worklist-reconcile.mjs`.

Forensic lanes (added 2026-08-26, from Amnesty International's Pegasus forensic methodology —
the technique, not the indicator list). `forensics.mjs` is the entry point for the six forensic lanes, and the
sweep calls it once; `observables.mjs` builds the corpus the matching lanes consume. None of these writes
to the issue store and none produces a severity; each answers a question the existing lanes could
not phrase:
`forensics.mjs` (runs its six lanes, store-consistency, observables, indicators, lookalike,
coincidence and host-baseline, fleet-once from `sweep.mjs`, writes `reports/forensics.json`,
never fatal — and a lane with no input reports `not-configured` rather than zero, because "0
matches against no indicator set" is indistinguishable from a fleet that was really checked;
`CW_INDICATOR_BUNDLE`, `CW_LEGIT_PACKAGES` and an accepted host baseline are what turn on
indicators, lookalike and host-baseline, and until they are set the sweep says so on every run),
`observables.mjs` (what the fleet's manifests actually NAME — package-lock v1/v2/v3, package.json,
go.mod, Cargo.lock, requirements.txt, yarn.lock v1; ecosystems it does not read are in
DECLARED_VOIDS with a reason rather than silently absent. 25,351 distinct observables over 170
repos on 2026-08-26; the origin-host distribution is the interesting part, and it immediately
showed one repo resolving 47 packages from `registry.npmmirror.com` rather than the registry the
other 11,713 came from),
`store-consistency.mjs` (referential integrity ACROSS this repo's own stores — orphan / widow /
mismatch, where *widow* is the leftover-row case a forward pointer-walk structurally cannot find),
`coincidence.mjs` (cross-KIND wall-clock correlation over slices, issue events, verdicts and
commits, thresholded per kind-pair by rank against that pair's own rhythm),
`indicators.mjs` (STIX 2 and plain-list indicators as an INPUT — the matcher and the indicator set
are separate artifacts, and an unparseable pattern is retained and counted rather than skipped),
`denominator.mjs` (a count and its coverage as one value; `publishable()` converts a zero drawn
from partial coverage into an explicit unknown, because a zero is the one headline that does not
degrade gracefully under sampling), `lookalike.mjs` (typosquat / homoglyph / separator / scope
confusion, with the legitimate side supplied as a DECLARED set so direction is never inferred),
`host-baseline.mjs` (the host inventory as a ratchet; a port is never reported gone on the
strength of an observation that could not read the socket table),
`unknown-rate.mjs` (the fleet-scope question the unknown unification was built for — what fraction
of PUBLISHED cells is an unknown, by reason and by lane, freshness-gated on the sliceId scan stamp
so a rate over a dead sweep contributes undetermined, never observed),
`lane-capability.mjs` (which lanes can actually SPEAK — every SCANNER_SPECS extractor executed
against a golden fixture and classified counting / shape-only / zero-on-golden / no-fixture, with
declared-additive-but-cannot-count published as a defect; behaviour, so a stub's graduation flips
the classification without editing the lens; `measured` also credits a lane from the scan canary's
both-direction record and from real-output fixtures its extractor tests read, each lane naming the
evidence kinds in `creditedBy`, and a lane none credits stays undetermined),
`surface-census.mjs` (the SOURCE axis coverage-manifest's dependency axis never had: per repo ×
language, surface present vs lanes that can, did, and demonstrably read it — unscanned surface is
a first-class grey, Kotlin is its own row, and two enumerators that cannot share a failure mode
dispute their way to grey rather than agreeing by construction),
`egress-baseline.mjs` (which EXECUTABLES on this box talk out, diffed against an `--accept`
baseline: identity is the executable path, never the pid and never the remote address, and the
change basis is the set of remote port classes — a new executable dialling out is the finding, a
known one on a new port class is a lead, and unprivileged lsof's `user-processes-only` coverage
limit rides on every payload),
`listening-ports.mjs` (every listening TCP socket on the box, not only commitwork's, diffed against
an `--accept` baseline: identity is the port, a new port or a changed owner is the finding and
presence alone never is, and an enumeration failure makes the whole lens unknown; exit 0 ok, 1
findings, 2 unknown),
`process-ancestry.mjs` (who spawned each commitwork-relevant process, judged on the direct parent
against a declared allowlist with per-entry exceptions for engines that parent their own workers;
a chain that cannot be walked is unknown, never expected; exit 0 all expected, 1 unexpected parent,
2 unknown),
`sandbox-coverage.mjs` (how much of a sweep ran confined: lanes by isolation × `executesRepoCode`,
and every lane that ran a repository's own code with `isolation: 'none'`, with its reason. When no
manifest declares the flag the whole dimension reads unknown rather than false, because "0
unconfined repo-code lanes" from a join that never resolved is a false clean, not a result).

The persistence surface (`persistence-diff.mjs`) covers editor extensions, sudoers, ssh, git's
global config, `/etc/hosts` and `/etc/resolver`, pam's sudo stack, kexts, system extensions,
configuration profiles and login items alongside launchd and the shell profiles. An accepted
baseline records the KINDS it covered, so items of a surface added after it read as `unbaselined`
(re-run `--accept`) rather than as a wave of findings on the day the surface shipped.

`vulncheck-enrich.mjs` fetches VulnCheck's KEV catalog into a cache (`--refresh`, which needs
`CW_VULNCHECK_KEY`) and reports the cache's age and size (`--status`). Its enrichment step marks a
finding's CVE as actively exploited, as absent from a catalog that was fetched, or as unknown when
there is no key, no cache or a rejected token. The rollup applies it from the cache and never
fetches: each CVE row carries `activelyExploited`, null when there is no cache, and the totals say
whether the catalogue was consulted and when it was fetched. The panel's integrations card refreshes
the cache with a stored key.

Tests: `node --test monitor/test/`; the `monitor/**` glob in `npm test` covers these plus
`monitor/worklist-reconcile.test.mjs` (which also runs via `verify-corrected.mjs`).

## Tool status

`commitwork setup` (or the first-interactive-launch prompt) installs the scanner toolchain from
`manifests/install-catalog.json` via the local package manager; sweep runs never prompt (non-TTY
guard + `CW_SKIP_SETUP=1` for children). Missing tools show as `blocked` in `commitwork doctor`
with an install hint, never fatal.
