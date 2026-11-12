<!-- verified-against: 2026-10-19 c80908bc -->
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
| `monitor/private/cra-cases.json` — reads, falls back — `bin/projectstatus.mjs:161` | absent; the fallback distinguishes `unreadable` from "no cases", i.e. correctly built |
| `/config.html` — reads, falls back — `admin/serve.mjs:1195` | a served route path, not a repo file |

On 2026-09-02 the same component found `data/kev.json` read behind a swallowed `try/catch {}` in
`monitor/rollup.mjs` while absent on disk: a read whose failure was swallowed, of a file that was
genuinely missing, in a module that kept reporting. That is the finding this component exists for,
and it no longer appears.

**Coverage is the honest weakness of this measurement.** C2 ran two commands and entered 18 modules
of 1,592, so 10,452 static edges are out of scope and the divergence figure is a statement about 8
edges, not about the repo. Several tools here do real work when merely
asked a question — `monitor/rollup.mjs` republishes when run with no argument, `monitor/sweep.mjs`
treats an unknown first argument as a whole-fleet sweep — so `DEFAULT_COMMANDS` is a checked
read-only set and widening it is a deliberate act, not a default.

## Data flow diagrams (`dfd@1`)

`flow/` printed text. `flow/dfd*.mjs` draws: a data flow diagram of this repository's own graph, or
of any system described in a `dfd@1` file — a scanned repository's flows, a threat-model diagram.

| file | what it is |
|---|---|
| `../lib/dfd.mjs` | the `dfd@1` model, `validateDfd`, the analysis (`analyse`), the filter (`filterModel`) — pure functions |
| `dfd-adapter.mjs` | the adapters: `fromFlowGraph` (this repository's flow graph) and `fromCodeFlows` (a scanned repository) |
| `../lib/dfd-render.mjs` | deterministic layered layout and one self-contained HTML page with an inline SVG (`renderHtml`, `layout`, `collapseGroups`) |
| `dfd-cli.mjs` | the command; its `parseArgs` and `prepare` are also the panel route's |
| `../admin/routes/dfd.mjs` | the panel page `GET /dfd/` and the document `GET /api/dfd`, behind the login |
| `../schema/dfd.schema.json` | the document's shape; ids, flow ends, declared layers and groups are checked in `validateDfd` |

```sh
node flow/dfd-cli.mjs --from lib/test/fixtures/dfd-synthetic.json --out /tmp/dfd.html
node flow/static.mjs                                   # writes <CW_HARNESS_STORE>/flow.json
node flow/dfd-cli.mjs --graph --prefix flow/ --out /tmp/flow-dfd.html
node flow/dfd-cli.mjs --graph --focus monitor/rollup.mjs --hops 2 --direction in --emit model   # what feeds it, as dfd@1
node flow/dfd-cli.mjs --graph --collapse-all-groups-over 12 --orientation TB --out /tmp/flow-dfd.html
node flow/dfd-cli.mjs --help
node --test --experimental-test-coverage lib/test/dfd*.test.mjs flow/test/dfd*.test.mjs admin/test/dfd*.test.mjs
```

| flag | what it does |
|---|---|
| `--from <file>` · `--graph [<file>]` | the source: a `dfd@1` file, or the flow graph through the adapter (default `<CW_HARNESS_STORE>/flow.json`); `--tests` and `--imports` keep what the adapter leaves out |
| `--prefix <p>` · `--focus <node>` · `--hops <n>` | seed the filter and keep everything within n flows (default 1); `--focus` is passed as `around` |
| `--direction in\|out\|both` | walk only into the seeds, only out of them, or both (default); needs `--prefix` or `--focus` |
| `--collapse <g>[,<g>]` | draw each named group as one node; flows across it merge per other end, mode and role, `×n` in the label; a name with no element exits 22 |
| `--collapse-all-groups-over <n>` | collapse every group with more than n elements |
| `--orientation LR\|TB\|auto` | ranks left to right, top to bottom, or `auto` (default): TB when LR is wider than 1,600 units and TB is narrower |
| `--max <n>` | refuse to draw more than n elements (default 150), counted after collapsing |
| `--emit html\|model\|analysis` · `--out <file>` · `--fonts` · `--title` | output; `model` is the filtered document before any collapse; `--out` prints the drawing's size, crossings and label collisions |

Exit 0 written, 2 usage, 20 not a valid `dfd@1`, 21 an input absent, unreadable or not a flow graph
(or `--repo` not a git checkout, or `--codeql` neither SARIF nor dataflow records), 22 the filter
matched nothing, `--collapse` named an empty group, the drawing is over `--max`, or `--repo`/`--codeql`
found no flow to draw.

Changed 2026-11-12 (owner decisions 2 and 3). The command was `node flow/dfd-cli.mjs` only and "not
a `commitwork` subcommand"; it is now also `commitwork dfd`, dispatched ahead of first-run setup in
`bin/commitwork.mjs`, with the same flags and exit codes (docs/EXIT-CODES.md reads them from this
module's header). `flow/` is in `package.json` `files` (its tests are not), because the subcommand
and `admin/routes/dfd.mjs` import it. The route reads the file `CW_DFD_FILE` names, else the flow
store's graph; its query keys are the flags above, and `/api/dfd` takes the filter keys only.

### A scanned repository (`--repo`, `--codeql`)

`commitwork dfd --repo <path>` runs C1 over ANOTHER git checkout's tracked `.mjs .cjs .js .jsx .ts
.tsx .mts .cts` files (`targetSources`; `node_modules/` left out). Parser rules are unchanged: the
mask lexer, V8's parse as the floor and the mask-consistency rewrite, no second tokenizer. The parse
goal is fixed by the extension (`.mjs`/`.mts` module, `.cjs`/`.cts` CommonJS) or, for `.js .jsx .ts
.tsx`, is the first V8 accepts, module then CommonJS. CommonJS is parsed as Node runs it, the module
wrapper under `vm.Script` (constructed, never run); V8 names no specifiers there, so the W2 test is
vacuous for it and `require('./x')` literals are taken as the imports.

TypeScript goes through `node:module` `stripTypeScriptTypes` in strip mode (added in Node 22.13.0,
so present on the 22.18 floor; experimental, Stability 1.1 on 22.x, warns once; needs no flag —
checked on 22.23.4 with and without `--no-experimental-strip-types`). Strip mode writes whitespace
of the same length, so offsets and lines are the source's. It refuses enum, namespace, parameter
properties and JSX: such a file is `unsupported-language` with the error as its reason. A `.jsx` or
`.tsx` V8 refuses is `unsupported-language`. Without the function, every TypeScript file is
`unsupported-language`, never clean. A file over 2 MiB is `too-large`, not read.

Target code is never executed. The launchd generator (`monitor/install-agents.mjs`) is imported to
read it, so it is read only when the target is this checkout (`isSelf`, by realpath); in any other
repository a file at that path is a site, "not read". Workflows, crontabs, timers and watches are
read statically as before. A relative import is resolved against the tracked set (`./x.js` naming
`x.ts`, extensionless, `index.*`).

What the pass could not read is the model's `source.unknown` (`unknownOf`): files by state and by
name (200 listed, the rest counted), tracked files in other languages by language, and call sites
whose target is computed. The page banner states each count, zero included; `--out` prints them.
A path assembled from variables at an fs call is still not a site (see Analysis limitations).

`--codeql <file>` takes a SARIF file (through `monitor/sarif-read.mjs`, each result through
`dataflowFromResult`) or dataflow records (a JSON array or `{ records }`). Alone it draws
`fromCodeFlows`, attributed to the SARIF's directory name. With `--repo` the two models merge
(`mergeModels`): **a CodeQL process and a static module are one element when their repository-
relative paths are equal** (`file://`, `./` dropped, an absolute path under the root made relative);
the static element is kept, CodeQL flows are redirected to it, everything else of both is kept, and
`source.options.merged` counts matched and unmatched CodeQL processes.

The panel takes `repo=<name>`: a name only, `^[A-Za-z0-9._-]{1,128}$` and not `.` or `..`, looked
up in the panel's fleet resolver (`admin/lib/core.mjs` `resolvedRepos`). Anything else, or a name
the registry does not know, is 400 with the reason, before any filesystem access. The pass runs in
a child (`--experimental-vm-modules flow/dfd-cli.mjs --repo <registered path> --emit model`, 180 s);
its model is filtered and collapsed in the panel through `prepare`. `codeql=` is not accepted.

### The model

```jsonc
{ "v": 1, "kind": "dfd", "title": "…",
  "source": { "producer": "authored|flow-graph|…", "omitted": {…}, "filter": {…} },
  "layers": ["bronze", "silver", "gold"],                       // maturity order, optional
  "groups": [{ "id": "internet", "label": "Internet", "boundary": "trust|system" }],
  "nodes": [{ "id": "api", "kind": "process|store|external", "label": "Order API",
              "subtype": "topic", "group": "internet", "layer": "bronze", "unknown": false, "note": "…" }],
  "flows": [{ "from": "api", "to": "events", "label": "OrderPlaced", "mode": "sync|async|event",
              "directed": true,
              "evidence": { "witness": "static|runtime|both|authored",
                            "existence": "confirmed|contradicted|unknown", "refs": ["file:line how"] } }] }
```

Three element kinds. A broker or queue is a **store** with subtype `broker`, `queue`, `topic` or
`stream`: data rests in it between producer and consumer, the notation has no fourth symbol, and
asynchrony already lives on the flow's `mode`. `mode` says whether the two ends are coupled in time:
`sync` the sender waits, `async` it does not, `event` the receiver is triggered by a message.
`evidence` keeps the flow graph's two axes apart, unchanged. A flow with no `evidence` is *declared*;
neither it nor an `unknown` one is ever drawn or tabulated as confirmed.

### What the analysis derives

Every flow takes exactly one class, in this order: **undirected** (`directed: false`),
**self-loop** (`from === to`, a retry), **bidirectional** (A→B and B→A both exist; one two-headed
flow), **feedback** (an arc that returns inside a strongly connected component, found by walking the
component from the node the outside flows into), **forward**. From the same pass: hop rank per node
(longest path once the returning arcs are set aside) and the rank of its component, branch and merge
points, source-to-sink paths (counted exactly, listed up to a cap, the cut declared), async hops (by
mode, or by a broker at either end) and producer → broker → consumer triples.

An undirected flow takes no part in ranks, cycles or paths: a cycle built on a guessed direction is
a fabricated feedback loop. A cycle through an element marked `unknown` is reported as uncertain.

### The flow-graph adapter

| flow graph | `dfd@1` |
|---|---|
| `module` | process; `group` is its first path segment; an unanalysable module is `unknown` |
| `artifact`, `store` | store, subtype `file`; a bare filename is `unknown` — a name, not a location |
| `env` | external, subtype `env` |
| `process` (spawn target) | external, subtype `binary`, when the target reads as one command name; the module's own process when it names a module; otherwise left out and counted |
| `reads` M←X | flow X→M · `writes` M→X: flow M→X · `touches`: flow with `directed: false` |
| `spawns` | flow M→P, `async` unless every witness is a `*Sync` call; left out when every witness is a bare `exec`, which a database handle also has |
| `reads` M←M′ (an import) | left out and counted: a code dependency, not a data flow (`--imports` keeps it) |

Test modules and fixtures are left out unless `--tests`. Everything left out is counted in
`source.omitted` and printed on the page.

Measured on this tree with the `dfd` files in it, 2026-11-11: the graph's 11,077 nodes and 21,770
edges become 2,489 elements (547 processes, 1,140 stores, 802 externals: 755 env keys and 47
binaries) and 2,973 flows, every one `static` / `unknown`, 1,445 of them undirected, 8 async. Left
out and counted: 3,613 test modules, 2,422 imports, 28 spawn targets that are not command names, 21
bare-`exec` edges, 4,947 nodes with no remaining flow. The analysis finds 23 two-way pairs, 1
feedback flow, no self-loop, 179 branch and 295 merge points, 5,281 source-to-sink paths, and 14
cyclic components: 13 are one two-way pair, the fourteenth has ten members. **All 14 pass through a
bare-filename store**, so all 14 are reported as uncertain. Nothing in the graph is a broker, a
network endpoint or a scheduled trigger, because C1 does not extract them.

### The page

Gane–Sarson notation: a process is a rounded box, a store is a box open at the right (`D`; `Q` for a
broker), an external entity is a square box with a shadow. A subtype carries a mark at the box's
right end: database cylinder, broker chevrons, log lines, file page; endpoint globe, scheduler clock,
actor figure, system screen, env braces, binary prompt. A collapsed group is a process with a double
outline. Solid is sync, dashed is async or event, two heads is bidirectional, dotted and headless is
a direction nobody determined. A feedback flow — any returning arc, and every flow whose `role` is
not `data` — is routed outside the body on its own track and keeps its own edge even when a data
flow runs the other way along the same pair; `error` is dash-dot in the severity colour with a ✕ on
its label, `retry` is dotted with a ↻. Existence: `confirmed` is heavier, *declared* (no evidence)
is plain, `unknown` is lighter and grey, `contradicted` is red. A retry on one process is a loop on
its corner. A boundary is a hull when it encloses only its members, and a caption under each member
when it cannot. The legend names every mark; the same elements and flows are tabulated under the
diagram with their full labels.

Layout: longest-path ranks, a source moved to one rank before its first consumer, one virtual point
per rank a long flow crosses, four barycentre sweeps, then adjacent transposition while it removes
crossings (never splitting a group within a rank), then coordinates. In LR maturity layers are
horizontal bands across the drawing; in TB each element is packed at its own width and a layer is a
band over the ranks it holds, so layers on disjoint ranks share the cross axis. Feedback risers sit
in gutters the retry-loop labels, which stand above their own box, never use. Labels wrap to two
lines, then shorten in the middle; each takes the first spot along its edge clear of elements,
boundary and band names, risers and placed labels, else a nudge, else it is counted in
`stats.collisions`. No clock and no randomness: one model is one sequence of bytes. The page carries
`houseCss()` and the theme follower, no other script, no `style` attribute, and a
`Content-Security-Policy` of hashes for exactly those; an endpoint's URL is text on the page, never
something it fetches. `renderHtml` returns `{ html, csp, stats }`; the panel route sends `csp` as
the header.

Measured on `lib/test/fixtures/dfd-synthetic.json` (22 elements, 26 flows), 2026-11-12: drawn top to
bottom, 1,328 × 1,776 units (left to right would be 3,407 wide), 0 crossings, 0 label collisions.

Not done: a diagram over 150 elements is refused unless `--max` raises the limit or collapsing
brings it under.

### dfd sources and mapping

Added 2026-11-12. The adapters moved out of `lib/dfd.mjs` into `flow/dfd-adapter.mjs`: `lib/` ships
and imports nothing from `flow/`. `lib/dfd.mjs` keeps the model, `validateDfd`, `analyse` and
`filterModel`.

**Additions to `dfd@1`**, all optional, `v` still 1:

| field | values | meaning |
|---|---|---|
| node `subtype` (store) | `broker` `queue` `topic` `stream` `log` · `database` `file` | the first five are brokers (`isBroker`) |
| node `subtype` (external) | `endpoint` `scheduler` `actor` `system` `env` `binary` | a process takes none; `validateDfd` checks which kind takes which |
| flow `role` | `data` (default) `feedback` `error` `retry` | a non-data flow is a **feedback** flow even when its pair is adjacent; only `data` collapses into a two-way pair |
| flow `existence` | `confirmed` `unknown` | the producer's verdict; `evidence.existence` stays the source edge's own value |
| flow `direction` | `reads` `writes` `both` | on a touch the runtime resolved: what it saw the module do; such a flow is directed |

The subtype set is closed: the fixture's `user`, `relational` and `lake` became `actor`, `database`
and `file`. `filterModel(model, { prefix, around, hops, direction })` walks `out` (forward), `in`
(backward) or `both` (the default and the old behaviour); an undirected flow is crossed either way.
`around` is the new name for `focus`, which is still read.

**`fromFlowGraph(graph, { reconcile, layers, include })`**, beyond the table above:

| flow graph | `dfd@1` |
|---|---|
| `endpoint` | external, subtype `endpoint`; `connects` M→E, and `listens` draws E→M: a listener is fed from outside |
| `database` | store, subtype `database`; an edge's `tables` go into the flow label |
| `scheduler` | external, subtype `scheduler`; `triggers` draws S→M with mode `event` |
| `spawns` with `script` | a flow to the script's own process, not to `node`; a script that is not a module stays on the binary, labelled with the script |
| `writes` `append: true` + `reads` `tail: true` | the store is subtype `log` (a broker) and both flows are `async` |
| an `artifact`/`store` whose path is a module | that module's process: one element, not a P and a D; a flow it would make to itself is dropped and counted |
| reconcile edge (same from, to, kind) | replaces witness and existence; flow `existence` is `confirmed` only when that existence is; a `touches` with `direction` becomes directed flows |
| reconcile `observedPaths[bareName]` | one path renames the bare-filename store; several split it, one store per path, every split flow `existence: unknown` |

`layers` is a layer map (`validateLayerMap`): `{ layers: [...], rules: [{ prefix | glob, layer }] }`,
first match wins, applied to the label of every process and store. `docs/dfd/commitwork-layers.json`
is commitwork's own (`raw`, `normalised`, `published`, from `monitor/README.md`'s sweep pipeline).
Counts of what was merged, renamed, split and resolved are in `source.options.merged`.

**`fromCodeFlows(records)`** draws a scanned repository from `cra/dataflow-evidence.mjs` records:
the untrusted source is an external actor, the source and sink files are processes, and the sink is
a store or external by what the rule id says it sinks into (`sinkKindOf`: SQL → database, path →
file, log injection → log, command → binary, request forgery → endpoint, XSS → actor, code
injection → system; anything else an unknown system). A record holds only its trace's two ends and
its step count, so a step in a third file is not drawn. Every flow is `existence: unknown`: a
CodeQL trace proves data can reach the sink, not that a run did.

`docs/dfd/threat-model.dfd.json` is `docs/THREAT-MODEL.md` drawn by hand: six boundaries, the
attackers as actors, every element citing its section and every flow `authored` / `unknown`.

## Requests made while building, and where they stand

The build owned `flow/**` only (spec §4) and recorded cross-cutting changes rather than making them.

1. **`package.json` test glob** — done; the suite globs `flow/**/*.test.mjs`.
2. **`README.md` `## Documentation` index** — done.
3. **Maintainer notes** — two of three recorded: the `--import` named-binding miss and
   `node --test <dir>` on Node 26. `NODE_TEST_CONTEXT` making a nested `--test` child exit 0 while
   running nothing is not recorded yet.
4. **Store default.** `CW_HARNESS_STORE` still defaults to `reports/harness/`, which is gitignored, so
   every artifact this produces by default is untracked. Where it should live durably is still undecided.

## Static extraction: endpoints, databases, triggers

C1 (`static.mjs`, `triggers.mjs`) adds three node kinds and three edge kinds to the graph. Every new
edge is `witness: 'static'`, `existence: 'unknown'`, with `evidence` as `file:line how`.

| node | key | from |
|---|---|---|
| `endpoint` | `<scheme>://<host>[:<port>]` | `fetch`, `http(s).request/get` (URL or `{host, port, protocol}`), named `request`/`get` imports of `node:http(s)`, `net`/`tls.connect`, `new WebSocket`, `new URL(…)` passed to any of them |
| `endpoint` | `listen:<port\|unknown>` | `.listen(…)` in a module that imports `node:http(s)/net/http2/tls` or calls `createServer`; an unresolved port is `listen:unknown` and the node carries `unknown: true` |
| `database` | the path literal (`:memory:` allowed) | `new DatabaseSync(p)` / `new Database(p)` |
| `scheduler` | `launchd:<label>` · `workflow:<file>#schedule` · `cron:<file>` · `timer:<module>` · `watch:<module>` | see below |

Edges: `connects` and `listens` module → endpoint; `triggers` scheduler → module; database access is
`reads`/`writes` module → database, with `tables: […]` and the verbs and tables in `evidence`
(`SELECT`/`WITH…SELECT` read; `INSERT/UPDATE/DELETE/REPLACE/CREATE/DROP/ALTER` write; `BEGIN`,
`COMMIT`, `PRAGMA` and the like are neither). A spawn of `node` or `process.execPath` carries
`script` (and `scripts` once merged) and, when the script is a tracked module, a second `spawns`
edge to that module; the script is the first argv element that is not a `-flag`. A write by
`appendFileSync`/`appendFile`/`createWriteStream(…, { flags: 'a' })` carries `append: true`; a read
by `createReadStream`, `fs.watch`/`watchFile`, or inside a `setInterval` callback or a
self-rescheduling `setTimeout` function carries `tail: true`. `mergeEdges` unions `tables`/`scripts`
and ORs `append`/`tail`, since those describe the edge, not one witness of it.

**Values.** An argument is resolved from the mask lexer's literal spans plus bracket matching over
the masked rewrite V8 already accepted (`lexer.mjs` `matchBracket`/`splitArgs`): string and
template literals, `const` bindings, `join`/`resolve` onto `import.meta.dirname`, `__dirname`,
`dirname(fileURLToPath(import.meta.url))`, `new URL(x, import.meta.url)`, `process.cwd()`. This
reads no character the lexer did not classify, so it is not a second tokenizer. A join onto a
directory variable it cannot see into tries the module directory, then the repo root, and keeps
the first tracked file.

**Unknown is never clean.** A call site whose host, port, URL, database path, database handle, SQL
or node script cannot be named is not an edge to a placeholder. It goes in the module record's
`sites`, and into `summary.unanalysableSites`, `summary.unanalysableSitesByKind` (reason with the
identifier taken out) and `summary.sites` (`file:line kind call: reason`), kept apart from the
module-level `unanalysable` count.

**`exec` as a method.** `db.exec('CREATE TABLE …')` and `RE.exec('…')` were read as spawn targets:
every SQL statement handed to `node:sqlite` became a `process` node. A member `.exec(`/`.execSync(`
is now a spawn only when its receiver is a `node:child_process` namespace import; a bare `exec(`
(an injected `execFileSync`) still is. Process nodes on this tree went from 105 to 77.

**Triggers.** `launchd`: `monitor/install-agents.mjs` is imported in a child process and its
`AGENTS` table read (label, argv, schedule fragment, service). The file's own `isMainModule` guard
keeps the install/`launchctl` half from running; the child keeps its registry reads out of the
graph build. Labels therefore follow the registry of the machine that builds the graph, as the
real plists do. The schedule is parsed into `{ type: 'KeepAlive' | 'StartInterval' |
'StartCalendarInterval', … }` on the node. `workflow`: `.github/workflows/*.yml` and
`workflows/*.yml` with `on.schedule` cron entries, line-based (no YAML dependency), triggering each
tracked module a `run:` step invokes as `node <path>`. `cron`: a tracked `crontab`, `*.cron` or
`*.crontab`. `timer`/`watch`: `setInterval`, a `setTimeout(f)` inside `f`'s own body (a bare
`setTimeout(r, ms)` is a delay, not a trigger), and `fs.watch`/`watchFile` through an `fs`
namespace or named import. A declared job that runs no tracked module is a site, not dropped.
`analyseRepo` accepts `triggers: { launchd, workflows, crontabs, lsFiles }` to inject any of these.

Measured on this tree, 2026-11-12, `node flow/static.mjs`, 9.3 s wall (baseline before these
changes 7.2 s): 4,469 modules, 11,137 nodes, 22,703 edges. New nodes: 9 endpoints (7 outbound,
`listen:0`, `listen:unknown`), 1 database (`:memory:`), 28 schedulers (16 launchd, 2 workflow, 10
timer, 0 watch, 0 cron). New edges: 7 `connects`, 89 `listens`, 26 `triggers` (16 launchd, 10
timer), 2 database edges, 390 `spawns` to a module, 351 node spawns carrying `script`, 8 `append`,
0 `tail`. 365 unanalysable sites (112 connects, 167 database, 86 spawns; 151 outside tests). Both
scheduled workflows (`codeql.yml`, `scorecard.yml`) run actions, not `node <path>`, so they
trigger nothing. Most endpoints and every file-backed database path in this tree are computed
(`dbPath()`, an env override with a default, a function parameter), which is why those counts are
small and the site counts are not.

## Runtime witness: network, observed paths, direction

Added 2026-11-12. C2 now observes the network and the way each file was opened; C3 uses both.

**Network.** `trace-hook.cjs` wraps `net.connect` / `net.createConnection` / `net.Socket#connect`,
`tls.connect`, `http(s).request` / `.get`, `globalThis.fetch` and `net.Server#listen`, by the same
`require`-then-patch route as fs, so named ESM imports (`import { request } from 'node:http'`) bind
the wrapper. Each wrapper keeps the original's `name` and `length`. Rows are `t: 'connect'` /
`'listen'` with `key` in C1's endpoint form: `<scheme>://<host>[:<port>]`, the scheme's default port
omitted, `tcp://` / `tls://` for raw sockets, `unix://<path>` for a pipe; `listen:<port>`, or
`listen:unix:<path>`. Only the outermost call of a nest is a row (`http.request` reaches
`net.createConnection` and `Socket#connect` synchronously). A port-0 listen is recorded on
`listening` at the bound port with `ephemeral: true`. fetch's own socket is opened asynchronously by
undici with no repo frame on the stack, so it is unattributed; the `fetch` call itself is the row.

**The network witnesses itself, per process.** At install the hook listens on a unix socket,
connects to it with `net.connect` and sends an `http.request` to it, all through the patched entry
points; a pipe binds synchronously, so this finishes before the traced program starts. Each call
must produce a row, and every other wrapper must be the function the program will call. The result
is `netWitness` / `netReason` on the `installed` row. `readTrace` returns `network: { state, reason,
pids }`; `summarise` drops (and counts as `network.refused`) every network row from a pid that did not
witness itself, because one trace collects every process `node --test` forks. Tested for real by a
preload that freezes `net.connect` ahead of the hook. Probe rows carry `probe: true` and are never
observations.

**Open access.** Every actual open carries `access`: `read`, `write`, `append` or `readwrite`, from
the call's own default and its `flag`/`flags` option or `open()` flags (string or `O_*`).
`copyFile` / `cp` record the source read and the destination written. A stat, `existsSync`,
`readdir` and the like carry no access: they open nothing and orient nothing. An fd or FileHandle
argument is not a path and is not recorded. `summarise` accumulates `access` per from|to|kind.

**Reconcile.**

- `connects` / `listens` edges match runtime observations on `endpointIdentity`: host and effective
  port (`https://h` = `tls://h:443`), or the listen key. The scheme is not the claim; the peer is.
- An unobserved static endpoint is `unconfirmed` only when `runtime.network.state === 'usable'`.
  Otherwise it is `unknown` with `unfalsifiable` and `networkUnwitnessed`. An observation still
  confirms, because `summarise` only emits network observations from witnessed processes.
- A runtime-only endpoint is a false negative when the module has a literal naming its host (not
  `localhost`) or, for a listen, its port; ephemeral listens and hosts from config are `dynamicPaths`.
- A `touches` edge takes `direction` (`reads` / `writes` / `both`) from the access of the module's
  opens of its target. An exact-path open also confirms it (`witness: 'both'`). An open matched only
  by name (bare or `./` / `../` literal) gives the direction with `directionBy: 'name'` and confirms
  nothing: the name is several files.
- `observedPaths` maps each bare or relative store key to the concrete paths the modules that name
  it actually touched. `coverage` is the visited-module list. Every edge carries `v`, `from`, `to`,
  `kind`, `witness`, `existence`, `runtimeCoverage`, measured or not.
- The headline is unchanged in kind: restricted to visited modules, false negatives and unconfirmed
  reported apart. Confirmed `touches` and endpoints now count toward `comparable`.
- `readReconcile(path)` validates `v`, every edge's fields, `observedPaths` and `coverage`, and
  throws (`CW_FLOW_RECONCILE_ABSENT` / `_INVALID`) instead of defaulting.

**Integration gap, flagged rather than fixed (outside this change's files).** `report.mjs` unions
several runs into `{ state, coverage, observations }` and drops each run's `network`. Reconcile then
treats the network as unwitnessed: observed endpoints still confirm, unobserved ones refute nothing.
Passing a `network` that is `usable` only when every run's is would restore unconfirmed endpoints.

**Measured 2026-11-12** on this tree (static graph from `node flow/static.mjs`: 4,463/4,464 modules,
11,120 nodes, 21,843 edges, no endpoint nodes yet), runtime over
`node --test --test-concurrency=2 'lib/test/*.test.mjs' 'flow/test/*.test.mjs'`, 47 s on 2 cores:
643 modules visited (210 non-test); divergence 471 over 547 comparable (false negatives 171,
unconfirmed 300), confirmed 76 (39 of them `touches`); 195 of 876 visited `touches` edges given a
direction (39 exact, all `reads`; 156 by name: 58 `reads`, 86 `writes`, 12 `both`); 226 bare
stores resolved to 851 observed paths; network witnessed in every process, 57 observations (28
connects, 29 listens, all loopback, all `dynamicPaths` because C1 emitted no endpoints), 0 refused.
