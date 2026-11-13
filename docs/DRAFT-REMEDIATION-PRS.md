<!-- verified-against: 2026-10-22 -->
# Draft remediation pull requests

commitwork can open a pull request that clears a reachable Go dependency advisory, on the default
branch of the repository that carries it. The pull request opens as a draft, and a person clicks
"Ready for review" or closes it. On a repository the operator owns, policy can let it open ready.
Nothing here merges.

Operator ruling, 2026-10-22: remediation tooling may open pull requests for this one flow, and only
when the remediation policy's mode enables it. Every other remediation path still only drafts.

| Piece | File |
|---|---|
| The policy: `mode` and `draftPr` | `monitor/remediation-policy.json`, `monitor/remediation-policy.mjs` |
| The plan the flow starts from, and the head probe | `monitor/remediation-pr.mjs`, `monitor/upstream-probe.mjs` |
| The flow, in order | `monitor/remediation-draft-pr.mjs` |
| Opt-out, CLA and DCO detection, the duplicate rule, the draft rule | `monitor/draft-pr-gates.mjs` |
| The pull request body | `monitor/draft-pr-body.mjs` |
| Events on the issue store, caps, merge and close | `monitor/draft-pr-ledger.mjs` |
| gh, git and Go commands | `monitor/draft-pr-live.mjs`, `monitor/draft-pr-go.mjs` |
| Push, fork and `gh pr create` | `bin/create-pr.mjs`, `bin/lib/create-pr-fork.mjs` |
| Terminal | `bin/remediation-draft-pr.mjs` |

## Enabling it

The shipped policy is `"mode": "report"`, which opens nothing. To enable the flow, edit
`monitor/remediation-policy.json` and set the mode:

```json
"mode": "draft-pr",
```

`hitl-agentic` and `full-agentic` enable it too, because they rank above `draft-pr`. The panel API
refuses to set any of these modes, and refuses any change to `draftPr`; both are file edits.
`draftPr` holds the rest:

| Key | Values | Default | Meaning |
|---|---|---|---|
| `targets` | `own`, `upstream` | `["own"]` | `own`: a repository the gh identity administers (`viewerPermission` ADMIN). `upstream`: any other repository, through the identity's fork. |
| `ready` | `never`, `own-only` | `never` | `never` opens every PR as a draft. `own-only` lets a PR on an own repository open ready when nothing is asked of a person. |
| `maxOpenPerRepo` | integer 0–100 | `1` | PRs this flow has open on one repository. 0 opens none. |
| `maxOpenPerDay` | integer 0–100 | `3` | PRs this flow opens per UTC day, across all repositories. |

Then run it over the input `monitor/remediation-pr.mjs` reads, where each advisory also names
`repo`, the scanned repository its finding was filed under. `monitor/remediation-plan.mjs <slice>
--write` writes that input, with the head states its probe measured, to
`reports/remediation-pr-plan.json`:

```sh
node monitor/remediation-plan.mjs slice.json --write           # CW_SLUG_MAP, CW_CHECKOUTS, CW_OSV_FIXED
node bin/remediation-draft-pr.mjs reports/remediation-pr-plan.json          # dry run
node bin/remediation-draft-pr.mjs reports/remediation-pr-plan.json --open   # act
node bin/remediation-draft-pr.mjs --reconcile                               # record merges and closes
```

The credential reaches gh in `GH_TOKEN`, or gh's own login is used. It is never in argv.

## The rules

Each rule stops the flow with a reason. Every stop after the issue lookup is written to the issue
store as a `remediation-pr-not-opened` event carrying that reason. A repeat of the same reason for
the same advisory is not written again.

- **Given** the mode is `report` or `hitl-item`, **when** the flow runs, **then** it opens nothing,
  runs no command and writes nothing.
- **Given** the plan does not propose the advisory (not reachable, no fix target, unsafe fields,
  already fixed upstream, upstream state unverified), **then** nothing is attempted. The plan
  records why.
- **Given** no issue in the store holds the advisory (`sc:<repo>|depsGo|id=<id>|package=<package>`,
  directly or in a group), **then** no PR is opened, because it could not be recorded.
- **Given** the issue store already records an open PR from this flow for the advisory, **then** it
  is reported `already-open` and not attempted again.
- **Given** the flow already has `maxOpenPerRepo` PRs open on the repository, or has opened
  `maxOpenPerDay` today, **then** it stops (`cap-per-repo`, `cap-per-day`) before any gh call. Open
  means an opened event with no later merge or close.
- **Given** gh has no identity, or the identity's permission on the repository cannot be read,
  **then** it stops. **Given** the repository is `own` or `upstream` and that target is not in
  `targets`, **then** it stops (`target-not-enabled`).
- **Given** the default branch cannot be cloned, **then** it stops (`default-branch-unreadable`).
  The flow never opens against a branch it could not read.
- **Given** the default branch carries `.github/no-automated-prs`, `.github/no-bot-prs`,
  `.github/NO_AUTOMATED_PRS`, `.no-automated-prs` or `.no-bot-prs`; or a CONTRIBUTING file or PR
  template has a sentence where a bot word (automated, bot, AI, LLM, machine-generated) sits within
  three words of a PR word (pull request, PR, contribution, patch) beside a refusal (not accepted,
  will be closed, do not open, no bot …); or the repository has a label such as `no-bots`,
  `no-automated-prs` or `no-ai`, **then** it stops (`opted-out`). **Given** those files or the
  label list cannot be read, **then** it stops (`opt-out-unreadable`).
- **Given** an open PR whose title or body names the advisory id, the package or the module being
  bumped, or an open issue that names the advisory id, or names the module beside a bump word,
  **then** it stops (`already-proposed`) and names the URLs. **Given** the search cannot be read,
  **then** it stops (`dedupe-unreadable`).
- **Given** govulncheck on the fresh clone does not report the advisory, **then** it stops
  (`upstream-already-fixed`); **given** it cannot analyse, **then** it stops
  (`head-probe-undetermined`).
- **Given** `go get` or `go mod tidy` fails, `go build ./...` fails, or govulncheck still reports
  the advisory or cannot analyse after the change, **then** it stops (`fix-did-not-apply`,
  `build-failed`, `advisory-check-failed`). **Given** the fix changed anything but `go.mod` and
  `go.sum`, **then** it stops (`commit-failed`).
- **Given** CONTRIBUTING, `.github/dco.yml` or a workflow asks for a DCO, **then** the commit
  carries `Signed-off-by` for the configured git identity. **Given** CONTRIBUTING, `.clabot`,
  `.github/cla.yml` or a CLA workflow asks for a CLA, **then** the PR body lists it as a task for a
  person and the PR opens as a draft whatever `ready` says.
- **Given** the target is `own`, **then** the branch `commitwork/deps/<advisory>` is pushed to the
  repository and `gh pr create --draft` runs. **Given** the target is `upstream`, **then** the gh
  identity's fork `<login>/<name>` is made if missing, the branch is pushed to it, and
  `gh pr create --draft --repo <upstream> --head <login>:<branch>` runs. A same-named repository
  that is not a fork of upstream is a refusal. `--draft` is left out only when `ready` is
  `own-only`, the target is `own` and nothing is asked of a person.
- **Given** the PR opens, **then** a `remediation-pr-opened` event records its URL, the draft flag,
  the target, the fork, the default branch and the probed commit. **Given** `--reconcile` later
  reads it merged, **then** a `remediation-pr-merged` event is written and a `dep-upgrade` fix is
  lodged on the issue if none is, so the next slice verifies or contradicts it through
  `fix-verified` or `reopened-contradiction`. Closed unmerged writes `remediation-pr-closed`.

## The pull request body

It carries the advisory id with a link, the call path govulncheck traced on the default branch,
the module versions before and after, the head-probe result with the commit it was measured at,
each command run and its exit status and result, any CLA task, and a last line saying an automated
tool prepared it and no person has reviewed it yet. It names nothing from the scanning side: no
scanned-repository name, no issue id.
