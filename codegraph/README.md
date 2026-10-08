<!-- verified-against: 2026-10-08 -->
# codegraph/ — a symbol graph of this repository

Answers the questions an agent asks before it edits: **what does this module export, who imports it,
what does a change here reach, and which exports does nothing use?** Over about 1,700 tracked `.mjs`
sources (330,870 lines on 2026-10-07), that was previously a matter of grep and hope.

Zero runtime dependencies; Node as `package.json` declares (measured on 26.7.0). Built after reviewing
[CodeGraph](https://github.com/codegraph-ai/CodeGraph) — a Rust binary that indexes 38 languages
with tree-sitter into RocksDB and ranks with ONNX embeddings. None of that fits here, and the parts
worth having did not need it: this repository is about 1,700 `.mjs` files of about 2,300 tracked, V8 already
ships a parser, and veld already holds embeddings behind an HTTP API this repo has a client for.

```sh
node codegraph/report.mjs                        # build, measure, write the store
node codegraph/report.mjs about flow/lexer.mjs   # exports, importers, symbols, witnesses
node codegraph/report.mjs importers flow/lexer.mjs   # static and dynamic importers, apart
node codegraph/report.mjs blast lib/secrets.mjs  # everything a change there can reach
node codegraph/report.mjs dead                   # exported symbols nothing binds
node codegraph/report.mjs entries                # modules nothing imports
node codegraph/report.mjs callers flow/lexer.mjs classify
node codegraph/report.mjs search "masks string interiors"   # veld ranks; the graph answers
node --test 'codegraph/test/*.test.mjs'
```

`--head` reads the committed tree instead of the working one. The store records which, because a
verdict about what a *clone* gets — a dead export above all — is a different question from a verdict
about the tree you are editing.

## The witness structure

The extraction is hand-rolled, and this repository has already paid for that twice: a comment
stripper that swallowed 1,375 lines of `admin/serve.mjs` and reported a clean tree it had never
read, and four rounds of specifier false positives before `bin/lib/tracked-imports.mjs` was right.
What repaired the first was not a better regex but V8 cross-checking the result in both directions.

So there are two witnesses, and the thing they disagree about is stated rather than summed.

- **W1 `lexical.mjs`** — declarations, call sites, import bindings and re-exports, read off
  `flow/lexer.mjs`'s per-character classification via `flow/verify.mjs`'s mask. Every regex here
  runs over the mask, where string, template, regex-literal and comment interiors are already filler
  of the same length, so `// export function ghost()` cannot mint a symbol and offsets still index
  the original file.
- **W2 `v8-surface.mjs`** — V8's own answer to what a module exports, what names it demands of
  each import and what each re-export resolves to, **obtained without running a line**.
  `new vm.SourceTextModule(src)` parses; `link()` instantiates, which resolves specifiers and binds
  names and is *not* evaluation; `evaluate()` is never called. That distinction is what makes this
  witness usable on this tree at all — `flow/report.mjs` records why several modules here publish
  or rewrite a directory when merely loaded.

**How W2 learns the import names, and why it is not circular.** Nothing tells a linker which names
the importer wants. So every specifier is stubbed with no exports, V8 refuses the link and names the
one binding it could not find, that name is added to the stub, and the link is retried. Every name
in the result came out of V8's parser; W1 is never consulted. If it were, this would be W1 with
extra steps and the two would share the failure mode that makes a second witness worth having.

**How W2 learns what a re-export resolves to, still without evaluating.** Once the link succeeds,
every stub binding is given a unique token with `setExport` — legal on a linked `SyntheticModule`,
and not `evaluate()` — and the module's namespace is read back. A name whose value is a token, or a
stub's namespace object, got there through V8's own export resolution; a local binding reads as a
hoisted function, `undefined` or a TDZ error, never as a token. That one read covers
`export { x as y } from`, `export * as ns from`, and `import { x } …; export { x }`, which the
language makes the same indirect export. `export *` is the separate star probe, which carries one
sentinel per specifier: a single shared one is ambiguous as soon as two specifiers star, V8 drops an
ambiguous name, and a module with two `export *` read back as having none.

**What each witness decides**, because getting this backwards is how a floored extractor becomes an
unfloored one with more ceremony:

| | decided by | floored by |
|---|---|---|
| export surface | W2 — V8 linked it, it is not guessing | — (W1's list is *checked* against it, never used for a finding) |
| local aliases (`formatReport as fmtOrphans`) | W1 — a namespace has no opinion about the alias | W2, on the exported half |
| declarations | W1 | W2 where they are also exports; an internal helper carries witness `lexical`, never `both` |
| call targets | W1, resolved through the two above | nothing — unresolved is its own bucket |
| re-exports | W2 — V8 resolved each one | W1, compared exactly in both directions; a W1-only reading mints no edge |

**Measured 2026-10-07:** zero divergence in both directions across all 1,591 analysed files. That
number is worth reading correctly. It does not say W1 is sound; it says W1 has a floor, and getting
there took closing **27 real holes W2 found** — anonymous `export default` in 22 files, and aliased
re-exports (`export { baseUrlFor as llmBaseUrl }`) in the rest. A single extractor would have called
every one of those a clean read.

Re-exports are compared the same way, as `exported <- spec#imported` per file: zero divergence
either way over the 111 re-export edges at a commit. The comparison sees what the surface one cannot.
In `export var v; export { v as w } from './b'; export * from './b'`, W1 misses `v`'s declaration and
so credits the star with a `v` that V8 knows is local. Both witnesses then report the same surface.
Only the re-export comparison disagrees.

**And it is a gate, not a measurement.** `codegraph/test/divergence.test.mjs` rebuilds the graph
over HEAD on every suite run and fails on either direction of divergence, on any unreadable file,
and on any `partial` file that `bin/lib/parse-gate.mjs` has not already declared a non-module. A
number measured once is a streak, and this repository's own import guard is the cautionary case: it "had been
right all along, and that was never the problem. It had no *floor* — no reason it HAD to be right,
and therefore no way to notice when it stopped being."

It reads HEAD rather than the working tree, because eight-plus sessions write this one at once and a
peer's in-flight edit is not a defect. That costs ~6s, which is why `report.mjs` reads every blob in
one `git cat-file --batch`: the obvious `git show` per file spawns 1,592 subprocesses and took
**29.3s against 5.3s** for the batch. A cost that shapes what you are willing to check is a cost
worth removing.

## Three states, and they sum to the input

| state | what it means | what it contributes |
|---|---|---|
| **analysed** | both witnesses answered | nodes, edges, an export surface |
| **partial** | W1 read it, W2 refused it | its outgoing references only — no surface, no symbols |
| **unreadable** | W1 failed | nothing, *and* it makes every reachability answer a lower bound |

`partial` is not a fudge, it is the state that stops a false positive. `workflows/adversarial-review.mjs`
is a Workflow script whose top-level `return` is legal there and illegal in a module, so V8 refuses
it — but it still contains import statements, and a symbol it imports is not a dead export.

## Every answer carries its own uncertainty, in a field

"Nothing imports this" and "nothing I could read imports this" are different claims. A query surface
that returns the same shape for both has already lost the argument, because the caller cannot tell
them apart and will present the second as the first. So:

- `importers`, `blastRadius` and `deadExports` carry `unknownFrom`, and `blastRadius` carries
  `lowerBound` (`entryPoints` and `callersOf` return bare lists);
- `deadExports` returns **`dead` and `undetermined` separately**, and `dead` is empty whenever any
  file in the population could not be read. A binding is followed through every re-export it
  passes — named, renamed, `export *`, transitively, cycles included — so a symbol imported by name
  through another module is used. A re-export nobody binds is not a use: it passes one on, and leaves
  its target as dead as it was. A symbol is `undetermined` — not dead — when its module is reached by
  a dynamic import (which names no bindings), bound as a namespace or default object (member access
  is not tracked), or re-exports with `export *`, or when a re-export hands it out from a module in
  one of those states (`export * as ns` included);
- unresolved calls are split into `external-import`, `global` and `unknown`, because a call to `Map`
  and a call to a name nothing introduces are both "no edge" and only the second is a gap.

Measured on this repository at a commit: 625 dead exports, 291 undetermined, 0 unreadable files,
against 650 and 289 on the same tree before re-exports were followed. Of the 25 that left `dead`,
22 are imported by name through a re-export (`lib/docsite-roots.mjs#withRoot` among them), and 3
are re-exported by `monitor/extractors.mjs`, which is dynamically imported, so they are undetermined.
An independent text scan agrees: 26 of the 650 were re-exported somewhere, and the 26th
(`bin/lib/scan-target.mjs#SYSTEM_PATHS`) is still dead because nothing binds its re-export.
Six of the 625 were spot-checked against an independent grep. Five held: no other file names the
symbol, or no importer of its module does. The sixth, `admin/integrations.mjs#getSourceKey`, is
called by its test through ``import(`${MOD}?t=…`)``; see the computed-specifier limit below.

## Stated limits, not buried in a coverage number

- Only module-level declarations and class members become symbols. A function declared inside a
  function is real and is not here; calls from it attribute to the enclosing top-level symbol.
  This is why **~30% of call sites resolve to nothing** — `send`, `run`, `fn`, `walk`, `mk` are
  local helpers, and they are listed by name and site rather than absorbed into a total.
- Scope analysis is not done. When a local declaration *and* an import both provide a name, the
  call is reported as ambiguous and no edge is emitted — a likelier guess is still a guess wearing
  a verdict's clothes. (Measured on this repository: 0.)
- Object-literal methods are not class members. `{ foo() {} }` and `class X { foo() {} }` are
  indistinguishable to a brace counter, and minting a symbol for the first invents a class.
- Member calls (`ns.thing()`) are not resolved, which is exactly why a namespace-imported module's
  whole surface is `undetermined` rather than dead.
- A dynamic import with a computed specifier (``import(`${MOD}?t=${Math.random()}`)``) resolves to
  nothing, so its target is neither reached nor protected, and what it destructures can be listed as
  dead. Found in the spot-check above. How many dead exports this affects has not been measured.
- A module that carries `export *` still has its own declared exports held as `undetermined`. That
  rule predates following stars and is conservative rather than wrong: it hides a dead export and
  never invents one. No module at a commit uses `export *`.

## Tier C — semantic search, delegated to veld

CodeGraph's semantic half is an embedding model, an HNSW index and a key-value store. None of that
can live in a zero-dependency repository, and none of it needs to: `veld.mjs` publishes one
**locator** per exported symbol through `lib/memory-layer-client.mjs` (the contract-bound client)
and resolves every hit back against the local graph. veld ranks; the graph answers.

The records are locators and not code on purpose — veld summarises a long record to its first ~50
words and discards the rest, which is the measured fact `lib/memory-layer-pointer.mjs` exists for.
Each record therefore puts symbol, kind, path, repo and commit inside the budget, and reports
`survives` rather than promising it.

```sh
node codegraph/report.mjs veld-publish            # a DRY RUN — what would be sent
node codegraph/report.mjs veld-publish --apply    # actually send it
```

Publishing sends this repository's structure to a service, so it is opt-in: describing is not
applying. `search` degrades to a substring scan when veld cannot answer and returns `via: 'local'`
with the reason — a degraded answer that does not announce the degradation is the grey-as-green
failure in miniature.

**Measured against a live veld 0.7.39+229 on 127.0.0.1:3030, 2026-09-04.** Four facts worth having
written down, three of which contradicted an assumption made while building this:

- **The record must identify itself.** `/api/recall/tags` returns rows carrying `external_id`;
  `/api/recall` — the semantic one — returns `{ id, experience, score, … }` with **no
  `external_id`, no `tags`, and no `content` field at all**. So a hit's only identity is what its
  own text says, which is why the external id sits in brackets one token into the locator.
  Recovering it by parsing the prose was tried first and broke on the `.` in `github.com`,
  attributing five real hits to a repo called `https://github` and marking every one stale. The
  tests passed throughout, because their fake fetch returned a friendlier shape than the server
  does — `codegraph/test/veld.test.mjs` now pins the measured one.
- **Records store FULL, not preview.** `storedForm: 'full'`, coverage 1.0, on this build — the
  ~410-byte truncation `lib/memory-layer-pointer.mjs` was written for is fixed here. The
  locator-first design stays anyway: it costs nothing and it is what makes the record survive a
  server that does truncate.
- **The identity is stable.** A second publish of the same five records reported
  `inserted: 0, updated: 5`. A moving `external_id` would turn every update into a fresh,
  perfectly-verifying insert, which is exactly what the client's tally splits those counts to catch.
- **It writes at about 2 records/second** — an upsert plus a verifying read-back each — so the full
  2,615-symbol publish takes roughly 20 minutes. The loop is sequential on purpose; a local service
  would tolerate concurrency, but ordered writes are what the client is written for.

### `veldScore` is a rank position, not a similarity

Measured over 1,143 indexed records: `zebra quantum umbrella nonsense` and `render an html table`
came back with **byte-identical score sequences** — 0.9496, 0.8329, 0.7163, 0.5996, 0.4829, 0.3663.
It is a linear decay from rank 1. A nonsense query scores 0.9496 at the top exactly like a good one,
so the number says nothing about how well anything matched.

So `search` returns `rank`, keeps the server's number under the honestly-named `veldScore`, and
every ranked answer carries a `scoreNote` saying what that number is not. Calling a position a
similarity would be this repository's own defect in miniature — a descriptive signal wearing a
verdict's clothes.

### What the ranking is actually worth, measured on the full 2,615-record index

Re-measured after the index was complete, because the first read of it — taken at 1,143 records —
was too flattering and would have shipped as a claim.

- **`hybrid` is not deterministic, and it is veld's default.** Four identical queries returned four
  different result sets with **zero names common to all four**. `semantic` returned the same five
  every time. `search` therefore passes `mode: 'semantic'` explicitly and a test pins it: same
  inputs, same outputs is a house invariant, and a search nobody can re-run to the same answer
  cannot be checked by anyone — including by whoever is deciding whether it works.
- **Rank 1 is responsive; the tail is not.** `redactSnippet` → `redactSnippet`, `braceIndex` →
  `braceIndex`, and — genuinely — `parse a github actions workflow` → `parseWorkflow`. But
  `redact credentials before sending` returns `schemaPath` at rank 1, so natural-language hit rate
  is mixed, and ranks 2+ decay into noise fast, with a few symbols (`writeJson`, `ISS_RE_LEGACY`)
  recurring across unrelated queries.
- **The 5s client default times out at this corpus size**, falling through to the substring scan —
  correctly announced as `via: 'local'`, which is the degradation path doing its job. `search`
  raises the default to 30s; an env var the caller set still wins.

**Use it as a locator hint, not a ranked list.** It is worth having — top-1 finds a symbol you can
half-remember the name or purpose of, across 2,615 of them — and it is not the semantic code search
CodeGraph advertises.

The same measurement caught a defect in the RECORD. Retrieval was returning four near-identical
neighbours from one module, because every record named its module's entire export list — all 35
records for `admin/auth.mjs` shared ~90% of their text, so the embedding described the module rather
than the symbol. The body now carries counts instead of the sibling names.

## Files

| file | what it is |
|---|---|
| `schema.mjs` | node/edge kinds, ids that exclude the line, `witness` held apart from `existence` |
| `lexical.mjs` | W1 — declarations, calls, import bindings, re-exports, over the mask |
| `v8-surface.mjs` | W2 — export surface, demanded import names and re-exports, without evaluating |
| `build.mjs` | joins them; three population states; divergence in both directions |
| `query.mjs` | the answers, each carrying its own uncertainty |
| `store.mjs` | `CW_CODEGRAPH_STORE` paths; fail-closed IO imported from `flow/store.mjs` |
| `veld.mjs` | Tier C — locators out, ranking in, the graph still the source of truth |
| `report.mjs` | the CLI; re-execs itself with `--experimental-vm-modules` |

Three MCP tools read the store (never build it): `code_about`, `code_blast_radius`,
`code_dead_exports`. An absent store is reported as absent with the command that makes one — never
as an empty graph, which would answer "nothing imports this" about a repository nobody had read.

## Relationship to `flow/`

`flow/` is dataflow oversight: which *artifacts* nothing reads, over nodes that are modules,
artifacts, stores, env keys and processes. `codegraph/` is module and symbol structure. They share
the lexer, the mask, the fail-closed store IO and `mergeEdges`, and they deliberately do not share a
schema — widening `flow/graph.mjs`'s closed kind sets would loosen a contract that exists to be
tight.
