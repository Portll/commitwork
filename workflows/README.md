<!-- verified-against: 2026-09-25 -->
# workflows/ — agent-workflow scripts

Scripts for the Claude Code **Workflow** tool (not CLIs — they run with an ambient `args` binding
and orchestrate subagents; no filesystem access inside the script itself).

## adversarial-review.mjs

Adversarially reviews a commitwork audit packet into a coherent, dependency-ordered remediation
plan. Four phases: **Dimension** (bifocal edge-walk/fractal + foureyes void analysis) →
**Adversarial** (breakers stress security/perf/correctness/sequencing) → **Overloop** (critique →
revise, ≤4 rounds, independent critic each round) → **Synthesize** (final ordered plan).

Args: `{ packet, draft, project, reviewCommands? }` — the producer is `bin/audit.mjs`, which
emits `audit-packet.json` + `remediation-draft.md`.

**Tool-first against internal-d** — one source of truth, no prompt-level copies: agents call
internal-d's bifocal-plan and overloop MCP tools when that server is connected,
and otherwise read the canonical methodology files from internal-d's `.claude/commands/`
(`bifocal-plan.md`, `eye-foureyes.md`, `fang-breakers.md`, `hand-overloop.md`); override the
location with `args.reviewCommands`.

The other half of the internal-d seam lives in the monitor: `monitor/export-overwatch.mjs` pushes
each rollup into the overwatch-layer (memory-layer server) at the end of every sweep so internal-d's
overlook/meta_audit can reason over audit history — health-gated, rate-limit-aware, idempotent,
disabled with `SUBSTRATE_EXPORT=0`.

Known open defects against this script are in the reconciled audit queue: a machine-specific
default for the methodology location, a failed critic counted as approval, a null round-1
revision reaching Synthesize, and an unvalidated `args.draft`. Queue ids are positions and
renumber on regeneration, so find them by file rather than by id.

## Cost note (2026-07-30)

Workflow runs burn tokens fast — a 25-agent audit consumed 3.3M tokens and spent ~80% of its
7-hour wall-clock paused on usage-window resets. Prefer default effort + a smaller model for
mechanical scan stages (`opts.model`/`opts.effort`), partition inputs instead of having every
agent re-read the whole surface, and start heavy runs on a fresh usage window.
