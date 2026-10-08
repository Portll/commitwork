<!-- verified-against: 2026-10-07 -->
# cobolwork remediation

commitwork's half of cobolwork's remediation pipeline. A local model drafts a fix for one cobolwork
finding, `cobolwork gate` decides whether the draft fixed it and moved nothing else, and a person
applies what passed. cobolwork's half — the fix packet and the gate — is specified in cobolwork's
`docs/spec/remediation-gate.md`.

| Piece | File |
|---|---|
| Finding and running cobolwork (`explain`, `gate`) | `lib/cobolwork-bridge.mjs` |
| The edit contract, the draft, the attempt loop, apply, verify | `lib/cobolwork-remediation.mjs` |
| The drafter (LM Studio) and the optional reviewer (`claude -p`) | `lib/cobolwork-remediation-engines.mjs` |
| Job records, the policy check, the adjudication record | `lib/cobolwork-remediation-jobs.mjs` |
| Panel routes, `/api/cobolwork/remediat*` | `admin/routes/cobolwork-remediation.mjs` |
| Terminal: `draft`, `apply`, `verify`, `list` | `bin/cobolwork-remediate.mjs` |

## Before it drafts anything

- **Policy.** `monitor/remediation-policy.json` in `report` mode drafts nothing, and that is the
  default, including when the file is absent. A file that will not parse or validate refuses too:
  the route answers 503 and the terminal exits 2. An operator sets `hitl-item` to allow drafts that
  a person then applies. Applying is a person's act in every mode; nothing here applies on its own.
- **cobolwork.** `CW_COBOLWORK_BIN` names it (a `.mjs` is run with this node), else the release
  `manifests/tool-pins.json` pins, installed and verified by `node bin/cobolwork-pin.mjs --install`
  (`lib/cobolwork-resolve.mjs`); a `cobolwork` on `PATH` is never used. Without one a draft ends
  `unscanned`, never as a result, and so does a run that crashed or timed out. What it can do is
  read from `capabilities --json` before `explain` or `gate` runs: a document other than
  schemaVersion 1 with fingerprint identity `cobolwork/v1`, one lacking the command or an option
  commitwork passes, or no document at all (0.2.0 has no `capabilities`) judged nothing, so the draft
  ends `unscanned` and a verify does not run. Only cobolwork's own refusal, exit 2 with its reason,
  is `refused`.
- **The model.** LM Studio at `CW_LLM_URL_LMSTUDIO`, `CW_LMSTUDIO_URL`, the launcher's `LM_BASE`, or
  `manifests/llm-hosts.json`, in that order; the loaded Qwen 3.8-family model unless
  `CW_COBOLWORK_LOCAL_MODEL` pins one, asked for reasoning `none` unless
  `CW_COBOLWORK_LOCAL_REASONING` names a level. `LM_API_TOKEN`, when the token launcher sets it, is sent as a
  bearer token and written nowhere.

## One draft, step by step

1. **Base.** HEAD of the repository, read from git objects into a temporary directory. The
   operator's working tree and index are not touched until apply.
2. **Packet.** `cobolwork explain` on that directory. A fingerprint the base does not hold is
   refused here.
3. **Draft.** The model is shown the packet inside the untrusted-text envelope and returns line
   edits, not a diff. The packet quotes only columns 7 to 72, so a model cannot write a diff whose
   context lines apply to fixed-format COBOL. commitwork renders each edit into the file's own
   columns and line endings.
4. **Edit checks, before the gate.** An edit anchors to a line the packet quotes (any op) or a
   declaration it names (lines beside it only). It never touches a line the packet withheld because
   the hidden-content rules flagged it, or a file the packet does not name. Code is printable ASCII,
   ends by column 72, and has a blank indicator column: no comments, no continuations. Where the
   packet quotes a statement past its first line (`endLine` and `rest`, where cobolwork gives them), every
   line of it is an anchor: lines inserted beside any of them go after the statement's last line or
   before its first, and a delete must take every line of the statement or none.
   A draft that repeats an earlier one, spacing aside, ends the run.
5. **Commit.** Base plus the edits, written through a private index and `git commit-tree`, so no
   hook runs. Nothing moves a branch.
6. **Gate.** `cobolwork gate --base <base> --head <draft> --target <fingerprint>` on the repository.
   A refused edit, a `fail` or an `undecided` goes back to the model as the next attempt's
   instruction, fenced, with what to change for that outcome, up to the attempt limit (3 by
   default, 5 at most). A draft identical to an earlier one ends the run: it would get the same
   verdict. A draft that deletes the flagged statement or the statement its input comes from
   fails, and the model is told to keep the statement and stop the route to it.
7. **Lodge.** The best attempt (pass, then undecided, then fail) is kept as
   `refs/cobolwork/remediation/<job>`, with its diff, the gate's verdict, outcome and reasons.
8. **Review, optional.** Only when the operator starts the job with `remote: true` does `claude -p`
   see the packet and the diff. The job records `sourceLeavesMachine`.

## Apply

A person applies from the panel's operator port, with a session, or with `bin/cobolwork-remediate.mjs apply`.

- `pass` applies. `undecided` applies only with `acknowledgeUndecided`, and the commit message says
  so. `fail` never applies.
- HEAD must still be the base the gate judged, and the files the draft changes must be clean.
- The commit is the gated draft's tree on the base, with the operator's identity, landed by
  `git merge --ff-only`: HEAD, index and files move together or not at all. No trailer.

## Verify

`cobolwork gate --target-only` from the base to HEAD, run any time after apply. A pass is
`verified-fixed`, and a target still reported is `refuted-still-present`. Either is appended to the
finding-adjudication journal (`bin/verdict-journal.mjs`, category `sastCobol`). A gate that could
not decide records no outcome, and the verification carries the shared unknown fields
(`monitor/unknown.mjs`, `not-adjudicated`): "not answered" is kept apart from "fixed". A job cobolwork
could not run carries `not-run` beside its own `unscanned` state.

## Job states

| State | Meaning |
|---|---|
| `running` | Drafting or gating in this process. `orphaned` when the panel restarted under it |
| `lodged` | A draft reached the gate; `final.verdict` says what it decided |
| `refused` | cobolwork refused the fingerprint at the base |
| `unscanned` | cobolwork is not installed, could not start or finish, or its capabilities do not meet the contract |
| `failed` | No draft reached the gate: the model failed, or every draft was refused before it |
| `stopped` | The operator stopped it |
| `applied` | Landed; `applied.commit` names it; `verifications` hold every verify |

## The fix the gate cannot pass

Moving literals into the sink's operand (`WHEN 'A' MOVE 'A' TO WS-CMD`) is the rule's own standard
fix, and the gate leaves it undecided. The route is gone, and the gate cannot tell a route that no
longer exists from one sent through something the engine does not follow. The first live run, on
2026-09-25 with `qwen/qwen3.8-27b`, drafted exactly that three times. The prompt now names the shape
that passes: an allow-list `EVALUATE` on the input field whose `WHEN OTHER` ends the run, with the
original `MOVE` and `CALL` left as they were. A literal-only fix still lodges, as undecided, for a
person.

## Not built

- A panel view. The routes serve JSON; the panel client (`admin/static/panel-*.js`) has no tab for them.
- spine's task record (`spine/finding-route.mjs`): it belongs to spine's repository.
- MCP tools. The HTTP routes are the surface.
- The compiler check has never met a real `cobc`.
