<!-- verified-against: 2026-10-06 -->

Run one A/B build loop: dispatch prompt variant A and prompt variant B to the local LLM, blind-judge the pair on the 12-dim rubric, and persist every loop artefact locally (memory-layer degrades to a replayable backfill file). This is the invokable form of the A/B backbone.

Slash-command source for `bin/ab-loop.mjs`. It becomes `/review-ab` once symlinked into
`~/.claude/commands/`; nothing in this repository creates that link (the convention internal-d's
own command corpus uses — see `~/.claude/CLAUDE.md`'s `@fn:` resolution rule). The templates it loads live in spine's `prompts/` directory, named by `CW_AB_PROMPTS_DIR`; this
checkout holds no copy.

Usage: `/review-ab <fileA> <fileB> [question]`

Migrated from internal-d 2026-09-01 — `bin/ab-loop.mjs` now lives in this repo, resolves its LLM
endpoint from `manifests/llm-hosts.json` (the same declaration `admin/` and `monitor/` use, not a
hardcoded port), and persists through `lib/memory-layer-client.mjs`'s upsert/verifyReceipt (three-
state receipts, redaction gate) instead of a raw POST. `@fn:` primitive resolution is unchanged —
`$HOME/.claude/_functions/{p0,p1}` was always a user-scope convention, not a internal-d-repo one.

**What to do**:

1. Write the two prompt variants to files (or take the paths the user gave).
2. Run:
   ```
   node bin/ab-loop.mjs \
     --a <fileA> --b <fileB> \
     --question "<the comparison question>" \
     --label <short-slug> [--tool <template>] [--parent latest] [--double-judge]
   ```
   - `--tool <name>` loads `$CW_AB_PROMPTS_DIR/<name>.md` as the template and injects each file at `{{context}}` (with recursive `@fn:` resolution from `~/.claude/_functions/p0` then `p1`).
   - Omit `--tool` for raw prompt-vs-prompt.
   - Omit `--b` for single-variant mode (baseline run, no judge).
   - `--parent latest` chains this loop to the previous run automatically (reads the runs dir `LATEST` pointer); pass an explicit runId to chain elsewhere.
   - `--double-judge` re-judges with presentation order swapped and flags self-disagreement.
   - `--llm-url` overrides the resolved default host; `--runs-dir` overrides `reports/ab-runs/`.
   - Unknown flags are REJECTED with a human-language report and a did-you-mean — never silently ignored. If the runner refuses, relay its message verbatim and fix the flag; do not retry blindly.
3. Read `reports/ab-runs/<runId>/report.md` and `run.json`. Relay the winner, the key trade-offs, the warnings (truncation, reasoning-exhaustion retries, judge parse failures, position inconsistency), and the "Next loop" guidance. `reports/ab-runs/index.json` holds the cross-run trajectory; `LATEST` names the newest run. `reports/` is gitignored — these are generated artefacts, not durable records.
4. Report `run.json`'s `internalC` block: writes / verified / degraded. Any degraded write has its exact payload in `reports/ab-runs/<runId>/memory-layer-backfill.json` for later replay.
5. **Audit before trusting**: skim `judge.md` — if scores lack cited observations or the delta table is malformed, treat the verdict as unparsed and audit the pair yourself. `judge-reasoning.md` (thinking models) shows how the verdict was reached.

Exit codes: 0 loop complete · 1 config/variant failure (readable reason on stderr) · 2 variants ok, judge failed.

$ARGUMENTS
