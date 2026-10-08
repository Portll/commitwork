<!-- verified-against: 2026-10-08 -->
# flow/ — mechanical dataflow oversight

Answers a question nobody in this repository could answer before: **which artifacts does nothing
read, and which readers have a producer that never runs?** Across 1,592 tracked `.mjs` sources
(2026-10-06), that was previously a matter of opinion.

Five components, per [docs/SPEC-dataflow-oversight.md](../docs/SPEC-dataflow-oversight.md) §2. Zero runtime
dependencies; Node as `package.json` declares (measured on 26.7.0).

| | file | what it is |
|---|---|---|
| C1 | `static.mjs` | read/write/spawn edges from path literals, `CW_*` env keys, spawn targets |
| C2 | `runtime.mjs` + `trace-hook.cjs` | actual opens and spawns during a run — the second witness |
| C3 | `reconcile.mjs` | compares them; false negatives kept apart from everything else |
| C4 | `orphans.mjs` | orphans in both directions, fallbacks reported separately |
| C5 | `liveness.mjs` | last write per store vs the freshness each consumer assumes |
| | `report.mjs` | runs C1–C5 and prints the measurement |

```sh
node flow/report.mjs                       # re-execs itself with --experimental-vm-modules
node --test 'flow/test/*.test.mjs'         # 111 tests
```

`node --test flow/test/` — the bare directory form — **does not work on Node 26.7.0**; it resolves
the path as a module and dies with `MODULE_NOT_FOUND`. Use the glob.

## The witness structure

C1's extraction is hand-rolled, and this repository has already paid for that once: a comment
stripper treated the `/*` inside a glob string as a comment opener, swallowed 1,375 lines of
`admin/serve.mjs`, and reported a clean tree it had never read. What repaired it was not a better
regex but V8 cross-checking the result **in both directions**.

So the lexer here is assumed unsound and given a floor. Four witnesses, and the two directions are
never summed into one confidence, because only one of them lies to you.

- **W1 `lexer.mjs`** — classifies every character as code / string / template / regex / comment. The
  one genuinely undecidable case without a full parser is regex-vs-division after `)` or `}`.
- **W2 `verify.mjs`** — V8, via `vm.SourceTextModule`, which parses without linking or evaluating.
  - *false-positive floor:* the source is rebuilt from W1's own classification, every classified
    interior replaced by same-length filler, and **V8 must still accept it**. A desync garbles real
    code and V8 refuses. Newlines are preserved in the rewrite: a newline inside a block comment is
    a line terminator for ASI, and losing it invents a parse failure in a valid file.
  - *false-negative test:* every static import specifier V8 reports must appear among W1's literals.
- **W3 `rawQuotedRuns`** — a deliberately dumb line-local quote scan with no state machine. It
  over-reports freely. Its purpose is that its failure mode (an odd number of quotes on one line,
  `don't`) is **not** W1's (comment or regex desync across lines). Two witnesses that fail the same
  way are one witness.
- **W4 `runtime.mjs`** — an observed open C1 never predicted is a hole in C1, found by a mechanism
  that shares no code with it.

**Bounded limitation, stated rather than buried in a coverage claim:** `dependencySpecifiers` is
static-only. A dynamic `import()` is absent from it entirely, computed specifiers doubly so. W2's
false-negative test therefore covers the static import subset **only** — it says nothing about path
literals, env keys or spawn targets. That is precisely why W3 and W4 exist.

**The floor is a floor, not a ceiling.** A misclassification that happens to stay parseable passes
W2. `flow/test/static.test.mjs` asserts that limit explicitly, so if it ever stops being true
somebody finds out.

## C2 must not be inert

A corroborating witness that silently observes nothing does not produce silence. It produces
**agreement** — an empty observation concurring with an empty expectation, and a reconciliation
reporting zero divergence.

Measured 2026-09-02, before any of C2 was written:

| preload | `import { readFileSync }` | `import * as fs` | `import fs from` | `await import` |
|---|---|---|---|---|
| `--import hook.mjs` (hook does `import fs from 'node:fs'`) | **MISS** | **MISS** | intercept | intercept |
| `-r hook.cjs` (hook does `require('node:fs')`) | intercept | intercept | intercept | intercept |

Importing the builtin instantiates its ESM facade and freezes the named bindings against the
original functions. The named form is the commonest in this tree, so the naive hook would have
traced almost nothing while looking like it worked. `flow/trace-hook.cjs` therefore `require`s
everything it patches, and `-r` is used rather than `--import`.

Three structural defences follow, all tested:

- the hook writes an `installed` row **and** proves it intercepted its own probe read
  (`selfWitness`). A trace without both is `unusable`, never an edgeless clean run;
- `reconcile()` returns `divergence: null, state: 'unmeasured'` — never `0` — when the trace is
  unusable or nothing was comparable;
- `flow/test/independence.test.mjs` asserts C2 imports **nothing** from `flow/`. "Shares no
  extraction code" decays one convenience import at a time, and the decay looks like agreement.

## Analysis limitations

Every bucket below is reported and none of them is a finding.

- a module C1 cannot analyse (unparseable / lexer bail / mask rejected) contributes no edges **and**
  its artifacts are excluded from orphan findings. "Nothing reads this", said about a file nobody
  could read, is fabricated;
- an edge whose direction was never determined is `touches` — neither a read nor a write. 2,002 of
  them on 2026-10-06, and calling them orphans would manufacture that many findings out of not knowing;
- a **bare filename** literal is a NAME, not a location (`join(dir, 'rollup.json')`). Several real
  files collapse onto one node, so those are `composed` and kept out of the headline;
- a static edge in a module the runtime never entered is `unknown`, not a contradiction. Scoring
  those as disagreement gives a divergence count proportional to how much code you did *not* run;
- an observed path that appears as a literal nowhere in the module that opened it was **never within
  C1's reach** — a directory walk, a join of variables, an argv value. Before this split existed,
  tracing one recursive walk reported 2,001 false negatives, 1,971 of them this category error. The
  instrument had become the crisis it was measuring;
- a store absent from disk is `absent`, which is not `stale`, and its age is `null` rather than 0.

**One deliberate deviation from the frozen contract, flagged rather than made quietly.** §1's
`existence` axis has `contradicted`, and the agreed mapping was *static-only in a visited module →
contradicted*. This implementation returns `unknown` with `unconfirmed: true` instead, because
coverage here is **module** granularity: that bucket is the union of a wrong static claim and a
correct claim on a branch the run did not take, and the two are not separable without statement
coverage. The single occurrence measured on this repo was the second kind. Publishing it as
`contradicted` would be an unknown wearing a verdict. Separating them needs branch coverage in C2;
until then `contradicted` is a value nothing can soundly assign, and that is a contract finding, not
an implementation shortcut.

## The measurement — 2026-10-06

```
C1 static      1591/1592 modules analysed, 1 unanalysable {"unparseable":1}
               nodes 5302  edges 10522
               FALSE NEG  v8 specifiers missed 0  unaccounted path-runs 0
               FALSE POS FLOOR  mask rejected 0  lexer bailed 0
C2 runtime     2/2 traced commands usable, coverage 18 modules
C3 divergence 1  (false negatives 0, unconfirmed 1) over 8 comparable edges
               confirmed by both 7 · out of scope 10452 · dynamic paths 1953 · matched by name 27
C4 orphans     written-never-read 3 · read-never-written 0 (+2 behind a fallback)
               direction never determined 2002 · bare-filename 64 · test fixtures 350
C5 liveness    461 read artifacts — present 47, absent 21, unknown 393
               stores with a consumer checking NO freshness 458 (765 such consumers)
```

The one unanalysable module is `workflows/adversarial-review.mjs`: a Workflow script whose top-level
`return` is legal in that runtime and illegal in a module. `bin/test/tracked-imports.test.mjs`
declares the same file for the same reason.

Every C4 finding was checked against the tree by hand. One holds; two are C1 limits, recorded as such:

| finding | verified |
|---|---|
| `reports/top-100.html` written by `bin/top100-html.mjs`, read by nothing | holds: a page for people to read, no code reader |
| `admin/.index-build.html` written by `bin/build-admin-panel.mjs:7` | C1 limit: a temporary file `renameSync`'d over `admin/index.html` at `:10`; C1 does not model a rename as a read |
| `monitor/chain-compact.mjs` "written" at `:74` | C1 limit: the path literal C1 bound to that `renameSync` is the `by` label on `:72`, not a path |
| `cra/cases.json` — reads, falls back — `bin/projectstatus.mjs:161` | absent; the fallback distinguishes `unreadable` from "no cases", i.e. correctly built |
| `/config.html` — reads, falls back — `admin/serve.mjs:1195` | a served route path, not a repo file |

On 2026-09-02 the same component found `data/kev.json` read behind a swallowed `try/catch {}` in
`monitor/rollup.mjs` while absent on disk: a read whose failure was swallowed, of a file that was
genuinely missing, in a module that kept reporting. That is the finding this component exists for,
and it no longer appears.

**Coverage is the honest weakness of this measurement.** C2 ran two commands and entered 18 modules
of 1,592, so 10,452 static edges are out of scope and the divergence figure is a statement about 8
edges, not about the repo. `docs/TRAPS.md` records that several tools here do real work when merely
asked a question — `monitor/rollup.mjs` republishes when run with no argument, `monitor/sweep.mjs`
treats an unknown first argument as a whole-fleet sweep — so `DEFAULT_COMMANDS` is a checked
read-only set and widening it is a deliberate act, not a default.

## Requests made while building, and where they stand

The build owned `flow/**` only (spec §4) and recorded cross-cutting changes rather than making them.

1. **`package.json` test glob** — done; the suite globs `flow/**/*.test.mjs`.
2. **`README.md` `## Documentation` index** — done.
3. **`docs/TRAPS.md`** — two of three recorded: the `--import` named-binding miss and
   `node --test <dir>` on Node 26. `NODE_TEST_CONTEXT` making a nested `--test` child exit 0 while
   running nothing is not recorded yet.
4. **Store default.** `CW_HARNESS_STORE` still defaults to `reports/harness/`, which is gitignored, so
   every artifact this produces by default is untracked. Where it should live durably is still undecided.
