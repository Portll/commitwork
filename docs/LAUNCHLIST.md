<!-- verified-against: 2026-10-08 -->
# launchlist

A launch checklist that runs against any repository in the fleet. It covers three situations:

- **publication**: a repository is about to go public;
- **marketing-site**: a product's marketing site is about to launch;
- **webapp**: a web application is about to go live.

A fourth profile, **featureset**, checks whether a project's features form a coherent set before
any of those launches.

Each item is either measured by a check or ticked by a person. The page is served behind the panel
login at `launchlist.commitwork.online` (and `/launchlist/` on any panel hostname). A self-contained
read-only copy is written to `reports/launchlist/index.html` on every run.

## Files

| Path | What it holds | Ships |
| --- | --- | --- |
| `manifests/launchlist.json` | The generic spec: profiles, sections and items, validated by `schema/launchlist.schema.json` | yes |
| `lib/launchlist.mjs` | Spec, config and state loading, ticks, evaluation | yes |
| `lib/launchlist-checks.mjs` | The measured checks | yes |
| `lib/launchlist-render.mjs` | The page | yes |
| `bin/launchlist.mjs` | CLI | yes |
| `admin/routes/launchlist.mjs` | Panel routes | yes |
| `$CW_LAUNCHLIST_DIR/config.json` | Per-project profiles, site URL, package names, holders, test command | no: sidecar |
| `$CW_LAUNCHLIST_DIR/state.json` | Ticks, project-specific items and an append-only log | no: sidecar |
| `$CW_LAUNCHLIST_DIR/results/<project>.json` | The last run's measurements | no: sidecar |

`CW_LAUNCHLIST_DIR` defaults to `monitor/private/launchlist`, which resolves into the private
sidecar. The store holds findings about private repositories, so it never lives in this tree.

## Commands

```sh
node bin/launchlist.mjs run --project <a,b>        # measure, save results, re-render
node bin/launchlist.mjs run --all                  # every configured project and every fleet repo
node bin/launchlist.mjs run --project <a> --history --tests
node bin/launchlist.mjs status                     # open HARD items per project
node bin/launchlist.mjs tick <project> <item> --state done|na|open --note "…"
node bin/launchlist.mjs add <project> --id … --title … --section … --severity … --owner … --size …
node bin/launchlist.mjs import <project> items.json
node bin/launchlist.mjs render
```

Exit codes: `0` means no HARD item is open, `1` means at least one is, and `2` means the command
could not complete. `--history` adds a full-history secrets scan. `--tests` runs the project's
declared `publicTest` from a clean `git archive` export, with `HOME` pointed at an empty directory
and no sidecar. It executes that repository's code, so it only runs when asked, and only with a
command the operator declared in the config.

## How an item is decided

- Checks read the committed tree (`HEAD`), because that is what an export ships. `dirtyTree` is the
  one check that reads the working tree.
- A check that cannot run returns **unmeasured**, with the reason. Unmeasured is never done.
- A manual item is done when someone ticks it, or marks it **n/a**.
- A measured item is done when it passes. A person can also **accept** a failing result, which
  requires a note. The acceptance is bound to a digest of the evidence it was made against, so it
  lapses as soon as the evidence changes. Evidence that is absent has not changed: while a check is
  unmeasured the acceptance is held but not counted, and it counts again when a run measures the
  same evidence.
- A run without `--history` or `--tests` keeps the last measured result of the check it skipped,
  with the time it was measured (`carriedFrom`), instead of writing unmeasured over it.
- Marking a measured item **n/a** closes it even when unmeasured; accepting it does not.
- Evidence never carries a secret value (gitleaks runs with `--redact`) or a redacted identity.
  The identity check uses the release gates' name scope and matcher (`bin/lib/release-scope.mjs`),
  minus the project's own name. It reports each hit by the scope document that holds the name, and
  masks names inside any path it prints.
- Every tick records who made it: a panel tick records the session identity, and a CLI tick records
  `CW_LAUNCHLIST_BY` or the OS user.

## Config

```json
{
  "accounts": { "npm": "<npm user>", "crates": "<crates.io login>", "docker": "<hub namespace>" },
  "defaults": { "profiles": ["publication"] },
  "projects": {
    "<project>": {
      "repo": "<path, absolute or relative to the fleet root>",
      "profiles": ["publication", "marketing-site", "featureset"],
      "site": "https://…",
      "github": "<owner>/<repo>",
      "packages": { "npm": ["…"], "crates": ["…"], "pypi": ["…"], "docker": ["ns/name"], "pypiOwned": ["…"] },
      "copyrightHolders": ["…"], "upstreamHolders": ["…"],
      "allowedEmails": ["…"], "selfNames": ["…"], "secretsExpected": ["fixtures/", "bin/test/"],
      "publicTest": { "cmd": "npm", "args": ["test"], "timeoutMs": 1800000 }
    }
  }
}
```

A project with no config entry gets the default profiles. A project with no `site` has every site
check unmeasured, and one with no `packages` has the name check unmeasured.

## Experimental feature flags (feat.ring)

Ring-outward groups are flagged rather than cut. The declaration is in
`manifests/feature-charter.json` (`experimentalFlags` and each group's `flag`), the census reports the
flag on every row, and `lib/feature-flags.mjs` resolves it. Every flag defaults to on.

To switch a group off: Settings → Experimental features in the panel, or
`POST /api/features {"flag":"<id>","on":false}`; for one process, `CW_FEATURE_<ID>=off`
(`CW_FEATURE_SCAN_IMAGES=off`), or `CW_EXPERIMENTAL=off` for every group. For the CLI,
`CW_FEATURE_SCAN_IMAGES=off commitwork help` lists `scan-images` under "experimental (off)". Re-run
`node monitor/install-agents.mjs` (dry run) to see which installed jobs a switched-off group retires.
What each enforcement point does is in [admin/README.md](../admin/README.md#experimental-feature-flags).

## Featureset census: proposed prompts

The featureset items are ticked by hand today. The proposal below would measure them. It is not
built yet.

A project gets three small artifacts, each of which does one job:

1. **Inventory (deterministic, no model).** Extract every entry point into `features.json`: CLI
   commands, HTTP routes, UI views, MCP tools, jobs, configuration flags and exported package APIs.
   Record location, tests, docs and UI reachability for each. Per-language extractors, from the
   sitemap harvest, the flow graph, route tables or tree-sitter, keep this independent of the
   project's language, because the model never parses code.
2. **Census prompt (one fixed template per run, read-only).** Its input is the inventory, a charter
   of three to five sentences on what the product is for, and the design-system reference. Its
   output is schema-validated JSON that puts every feature in exactly one class:
   - **core**: needed for the charter's main job; removing it breaks the product's promise.
   - **clean extension**: builds on core through public seams, is complete (entry point, tests, docs,
     error states), and could be removed without touching core.
   - **ring-outward**: serves an adjacent audience or job; core does not depend on it.
   - **fragment**: missing an entry point, tests, docs, error handling or a UI path, or referenced
     but unreachable.
   - **orphan**: reachable from nowhere.

   Each class carries a one-line membership test that a second rater applies. Two independent runs
   are compared, and disagreements go to the operator rather than being averaged.
3. **Conformity prompt (per UI feature, core and extensions only).** Its input is that feature's UI
   files and the shared vocabulary (`docs/THEME.md`, the component list and the navigation map). It
   reports deviations as `file:line`, rule and fix: foreign components, hard-coded colours,
   navigation placement, missing empty, error or loading states, and keyboard or accessibility gaps.
   Remediation is a separate, narrowly scoped task per batch.

**Containment, so no agent can act beyond its task:**

- Census and conformity runs get no shell, no network and no write access. Their only input is a
  pre-extracted bundle, and repository text inside it is wrapped as untrusted data by
  `lib/prompt-envelope.mjs`.
- The templates are versioned in this repository, and project facts arrive as data. A repository
  under analysis cannot edit the prompt that analyses it.
- Output is accepted only if it validates against the schema. Free-text fields are length-capped and
  never executed.
- A remediation agent works in a disposable worktree with an allowlisted write set, no credentials
  and no network, behind the PreToolUse guard. Its change lands only through `bin/commit-phase.mjs`
  after the tests and a fresh launchlist run pass, and a person approves it.
- Each run covers one project, and the sidecar is never mounted into a run.

Once built, the census writes its class map beside the launchlist results. `feat.census`,
`feat.fragments` and `feat.conformity` then become measured checks: the census must be newer than
HEAD, every fragment must carry a decision, and conformity deviations must be zero. For a marketing
site, every claim in the copy should map to a core or extension feature, which is what
`content.copy` asks a person to confirm today.
