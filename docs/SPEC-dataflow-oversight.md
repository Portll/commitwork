<!-- verified-against: 2026-09-25 -->
# SPEC — dataflow oversight (`flow/`)

The question nobody can currently answer about this repository: **which artifacts does nothing
read, and which readers have a producer that never runs?** At drafting on 2026-09-02 the tree held
961 tracked `.mjs`, 349 of them under `bin/` (1,246 and 495 on 2026-09-25), and no mechanical
account of what produces what.

`lib/oversight.mjs` covers human attestation over determinations; `/layingpipe flow` is an LLM
reading. Neither is a graph. This is the graph.

**Provenance.** Drafted 2026-09-02 as one of three streams in a project-harness plan, evaluated with
Bifocal+, then split on an operator ruling: the other two streams (client-spec intake, requirement
chain) moved to overwatch-layer as harness/project-management work, and this one stayed, because dataflow
oversight is code analysis over a repo — commitwork's actual business, the same shape as its
scanners. The other half lives at `overwatch-layer/planning/SPEC-client-spec-chain-2026-09-02.md`.

House invariants in [CLAUDE.md](../CLAUDE.md) apply without restatement. The one that governs this
document is **a guard needs a second witness that cannot share its failure mode** — this module is
that invariant, applied to itself.

---

## 1. Record shapes

```jsonc
// node
{ "v": 1, "id": "node:<kind>:<path-or-key>", "kind": "module|artifact|store|env|process",
  "path": "bin/audit.mjs", "lastWriteAt": "..."|null }

// edge
{ "v": 1, "from": "node:...", "to": "node:...", "kind": "reads|writes|spawns|touches",
  "witness": "static|runtime|both",              // PROVENANCE — who saw it
  "existence": "confirmed|contradicted|unknown", // VERDICT — how sure we are it is real
  "runtimeCoverage": "visited|unvisited",
  "evidence": "bin/audit.mjs:214 literal" }   // an array once duplicate edges merge
```

**`witness` and `existence` are two axes and must not be collapsed into one.** Every other
three-state truth in this system separates what was found from how sure we are — and a provenance
value wearing a verdict's clothes is how `unknown` loses its home. The mapping:

| situation | witness | existence |
|---|---|---|
| both passes agree | `both` | `confirmed` |
| static only, in a module the runtime DID enter | `static` | `unknown` + `unconfirmed: true` |
| static only, in a module the runtime never entered | `static` | `unknown` |
| runtime only | — | no edge: the observation is reported as a false negative, a dynamic path, or a match by name |
| a `touches` edge, which no runtime observation can refute | `static` | `unknown` + `unfalsifiable: true` |

**`contradicted` is currently a value nothing can soundly assign, and the implementation is right to
refuse it.** An earlier draft of this table assigned it to static-only edges inside a visited module.
That is unsound at *module* coverage granularity: the bucket is the union of a wrong static claim and
a correct static claim about a branch the run never took, and the single measured case was the
second. Distinguishing them needs **branch** coverage from C2, which does not exist. Until it does,
the value is reserved and unused — a verdict no evidence can reach is worse than a missing verdict,
because it will be assigned anyway by whoever needs the bucket filled.

Every record carries `"v": 1` as its first field: an old-shape record is not a parse failure, it is
a silently different meaning, and fail-closed does not catch it.

---

## 2. Components

**C1. Static pass** — `flow/static.mjs`. Read/write/spawn edges from path literals, `CW_*` env keys,
and `spawn`/`spawnSync` targets.

**Do not hand-roll a parser.** This repo lost four rounds to exactly that: a comment stripper treated
the `/*` inside a glob string as a comment opener, swallowed 1,375 lines of `admin/serve.mjs`, and
reported a clean tree it had never read — after being announced as working. `bin/lib/tracked-imports.mjs`
is the repaired version and is the model.

But note what that model does and does not give you: V8 hands over `dependencySpecifiers` and
nothing else. **Path, env and spawn literals are a different extraction and V8 will not hand them to
you.** They therefore get four witnesses with separated directions:

1. a mask lexer, assumed unsound;
2. V8 re-parsing a **mask-consistency rewrite** — masked interiors replaced with neutral filler,
   delimiters preserved, so a desynced mask garbles real code and V8 refuses it. This is the
   **false-positive floor**;
3. `dependencySpecifiers` ⊆ the lexer's literals — a V8-sourced **false-negative test**, bounded to
   the import subset, and blind to every dynamic `import()`, with a literal specifier or a computed one. State that blindness
   as a limitation rather than letting it sit inside a coverage claim;
4. a line-local quote scan with no state machine, whose failure mode (odd quote count on one line,
   `don't`) differs from the mask's (regex/comment desync across lines).

Two tempting shortcuts are rejected: whole-file block-comment stripping, and a second hand-rolled
tokenizer as the "second witness" — two hand-rolled lexers is one witness wearing two hats.

`vm.SourceTextModule` requires `--experimental-vm-modules` and parses without executing.

**C2. Runtime pass** — `flow/runtime.mjs`. Record actual opens and spawns during a run. It shares no
extraction code with C1; if it imports from `static.mjs` it is not a second witness.

**Probe the interception mechanism before building on it.** Whether a `-r` CJS preload intercepts a
*named* ESM import (`import { readFileSync } from 'node:fs'`) or whether the ESM facade snapshots the
binding first was unverified and on the critical path. Measured on 2026-09-02 (`flow/README.md`):
an `--import` hook misses named and namespace imports, so `flow/runtime.mjs` preloads with `-r` and
refuses to report unless the hook witnesses its own read. If it snapshots, C2 observes nothing, an empty
trace reads as a clean run, and this module manufactures the exact false-clean it exists to catch.
Probe `-r hook.cjs` against `--import hook.mjs` on a target using both named and default imports.
**A second witness that silently observes nothing is worse than none, because it manufactures
agreement.**

**C3. Reconcile** — `flow/reconcile.mjs`. Compare the two, **asserting false negatives separately
from false positives** — only one of those directions lies to you, and a merged confidence number
destroys the distinction.

Most `bin/` scripts never execute during a test run, so a naive comparison reports almost every edge
as a divergence. That is over-reporting: unsupported finding, which this repo treats as exactly as
costly as green. **C2 emits a coverage set** — which modules the runtime actually entered — and the
headline divergence count is restricted to edges inside visited modules. `unvisited` is reported
separately and is never a finding. A zero divergence must be a measured zero, never a defaulted one.

**C4. Orphans, both directions** — `flow/orphans.mjs`. Artifacts written and never read; readers
whose producer never runs. The second is the dangerous one: a default makes a dead dependency look
alive, because the fallback never fails. Where a reader has a fallback, `reads X, falls back to Y` is
a distinct finding from `reads X`.

**C5. Store liveness** — `flow/liveness.mjs`. Last write per store against the freshness each
consumer assumes. A consumer that assumes nothing is itself the finding.

---

## 3. Deliverable

The code is how you get the measurement; the measurement is the point. Over commitwork:

- modules analysed / modules unanalysable (unanalysable is `unknown`, neither clean nor a finding)
- orphaned artifacts
- readers with absent producers
- static-vs-runtime divergence, **restricted to visited modules**, with `unvisited` reported apart

Denominators for scale at drafting: 961 tracked `.mjs`, 349 under `bin/`.

---

## 4. Contention

Owns `flow/**` only. Reads anything; writes nothing else.

`package.json`'s test script now globs `flow/**/*.test.mjs`, and README's `## Documentation` index
lists this document. Both were deferred to a serial wiring phase when this was drafted, because both
are contended files that other sessions edit.

---

## 5. Not settled

1. **Whether C2 can observe anything at all** — see the preload probe above. Everything downstream of
   C2 is conditional on it.
2. **What counts as "a run"** for coverage purposes. The test suite is one answer and a biased one:
   it visits what is tested, which is not what is shipped.
3. **Dynamic path construction.** A path assembled from variables is invisible to every static
   witness here. It is a known false negative, bounded and disclosed, not solved.
