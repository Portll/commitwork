<!-- verified-against: 2026-09-25 -->
# The failure taxonomy, v2 — the layer split and the shaded remainder

> **Edition note, re-read 2026-09-25.** This is the v2 prose edition, kept as a record. The authoritative
> classification is `monitor/failure-taxonomy.json` (version 17: 207 classes in eleven families, I to
> XI). Class counts, ranges, mitigation status and line citations below are not maintained against
> it; where they disagree, the registry is correct.

v1 ([`FAILURE-TAXONOMY.md`](FAILURE-TAXONOMY.md)) classifies 51 failure modes across six families,
plus the twelve false-clean classes it hands back to
[`FALSE-CLEAN-TAXONOMY.md`](FALSE-CLEAN-TAXONOMY.md). **63 classes in total; 51 outside Family I.**
That count is stated here because it was already contested — the request that produced this document
cited 49. Nothing in v1 makes its own cardinality checkable: the ids live in prose, in six tables,
with no registry. See `M7`.

**v2 does not re-author v1.** Re-typing 666 lines of incident record into a new file is `D4`, the
class v1 measured at 6× content loss, committed by the document that named it. v1 remains the
incident record and is cited by id throughout. v2 adds three things v1 does not have:

1. **The layer axis** — every class tagged controller / implementation / both, and the finding that
   falls out of it (§2).
2. **26 new classes** — found on a new pass, derived as possible here, or derived as possible in
   work this repository does not own (§4–§6).
3. **Shading** — an explicit warrant grade per class, with the *least*-evidenced shown first (§3).

---

## 1. What v1 gets right that v2 keeps

The organising question is unchanged: *which proposition did the oversight system believe that was
false?* The family level stays. v2 adds axes to it; it does not renumber, and it does not re-sort the
existing families, because code cites `C1`/`C3`/`C9`/`C11` by name and a tidier scheme would be a
`C10` committed by the taxonomy of claim drift — v1's own argument, still correct.

## 2. The layer axis — controller vs implementation

The distinction v1 lacks:

- **Implementation (IMPL)** — the layer that does the work. Scanners, parsers, extractors, comparators,
  writers, renderers. Its failures are *in the code that produced the wrong artifact*, and the fix is
  an edit to that code.
- **Controller (CTRL)** — the layer that decides what runs, on what, in what order, with what budget,
  and what the result means. Schedulers, gates, hooks, orchestrators, the advice a gate emits, the
  prompt, the agent session, the operator. Its failures are in *a policy, an ordering, a scope, or an
  authority*, and the fix is not an edit to the code that failed.

v1 mixes them inside every family, which is why several entries read as unresolvable. `A2` is filed as
alarm content and its fix is described as "one conditional" — but its cause is a policy (*advice keyed
on absence of evidence*), and the conditional is where the policy happens to be spelled. `R1`'s first
attempted fix hung a worktree prune inside `suiteAtHead()`: an implementation edit for a lifecycle
defect, which is why it ran, exited 0, and left all 18 directories. That is its own class (`P11`).

### 2.1 v1's classes, re-indexed by layer

| Family | CTRL | IMPL | Both |
|---|---|---|---|
| I — false clean | C2, C3, C6, C7, C8, C9, C10 | C1, C4, C5, C11, C12 | — |
| II — false alarm content | A1, A2, A3, A4, A6, A7, A8, A9, A11 | A10 | A5 |
| III — false repair | R3, R6, R7 | R1, R2, R4, R5, R8 | — |
| IV — false provenance | P1, P2, P3, P4, P7, P9 | P5, P6, P8 | — |
| V — false measurement | M1, M2, M4, M6 | M3, M5 | — |
| VI — model-generated | G5, G8, G9, G10, G11, G12 | G2, G3, G4, G6, G7 | G1 |
| VII — false durability | D1, D2, D4, D5 | D3 | — |

**35 controller, 26 implementation, 2 both.** The oversight system's own defects are, by a clear
margin, defects of deciding rather than of doing.

### 2.2 The finding the split produces

Enumerate v1's open items by layer:

| Open item | Layer | Why it is still open |
|---|---|---|
| `A2` launder-advice guard suppressed | CTRL | the fix is a policy about what advice may key on |
| `A3` stale-baseline advice | CTRL | requires a freshness contract between gate and reader |
| `A6` advisory with no subscriber | CTRL | requires editing hook config — operator only |
| `R7` efficacy lens scheduled tenth | CTRL | a process rule, not a patch |
| `P2` shared-index capture | CTRL | a procedure; placing it in CLAUDE.md is the operator's call |
| `D1` 847 stranded lines | CTRL | a merge decision across unrelated histories |
| `M6` contaminated benchmark rows | CTRL | requires a re-run under changed conditions |
| `R5` `remediation: "available"` | IMPL | a formatter and an extractor |
| `R2` residual stdout scrape | IMPL | one reader swap |
| `G2`–`G5` empty-content cluster | IMPL | branch on `finish_reason`, raise a budget |
| `G6` small-local format fidelity | IMPL | prompt content |
| `M5` no ledger seam | IMPL | add the env override |
| touch-ledger TOCTOU / prefix width | IMPL | two small patches |
| SSRF guard with no call sites | IMPL | one import, different repo |

The implementation column is a to-do list — every item is bounded, and several are one line. The
controller column is not: **not one of those seven can be closed by editing the code where the defect
was observed.** Each needs an actor, an authority, or an agreement that the code cannot supply. That
is why the controller items are the ones still open after a year of the implementation items being
closed one by one, and why v1's mitigation table — sorted by effort — systematically underestimates
them. "One conditional" is the true cost of the edit and not the true cost of the fix.

**Corollary for anyone extending this taxonomy:** grading a mitigation by diff size measures the
implementation half and calls it the whole. Grade controller items by *who must agree*, not by lines.

## 3. Shading — warrant, and why the palest classes come first

v1 states its warrants in a Provenance section at the end, which means every row travels without its
tier (`P10`). v2 grades each class inline and **orders the new classes weakest-warrant-first**. The
ordering is deliberate: the classes with an incident attached will be believed anyway; the ones
without are the ones a reader must decide about, and burying them under evidenced rows is how a
catalogue converts an unknown into an absence — the first thing this repository teaches.

| shade | meaning | how to read it |
|---|---|---|
| ░ **shade 3** | derived, no instance | the mechanism is available in this system; nothing has been observed. Not evidence of absence; not evidence of anything. |
| ▒ **shade 2** | partial evidence | an adjacent incident, a measurement that implies it, or an instance in a neighbouring system |
| ▓ **shade 1** | verified this pass | re-derived from the tree at a commit on 2026-08-12, command and output in-session |
| █ unshaded | v1's classes | measured, adjudicated, or tree-verified per v1's Provenance section |

**explicit uncertainty applies to taxonomies too.** A shade-3 row is not a weak finding. It is an unmeasured
one, and the difference is the whole house invariant.

---

## 4. ░ Shade 3 — derived, no instance observed

Nine classes. Every one is a mechanism available in this system today, with nothing observed. They
lead because they are the rows most likely to be dismissed.

| id | Class | Layer | Mechanism |
|---|---|---|---|
| K4 | Retry amplification on a shared overwatch-layer | CTRL | a controller retries a side-effecting pass; on a tree ~20 sessions write, the retry's writes race the original's, and the second result is scored as the first's |
| K5 | Quorum without independence | CTRL | N verifiers sharing a model family, a prompt lineage or a context window are counted as N votes; correlated priors make agreement cheap |
| E2 | Suppression portability | IMPL | an annotation identity tuple (repo/file/rule/package) survives a fork, rename or vendored copy and matches a *different* finding — a suppression that travels further than the judgement behind it |
| E4 | Taxonomy import without population | CTRL | these classes are adopted where the conditions that produced them are absent; a single-writer repo inherits a Family IV that cannot fire and reads the list as universal |
| A12 | Self-critique as credential | CTRL | a document that records its own errors is trusted *more*, so the un-confessed remainder receives less scrutiny than an unconfessed document would have got |
| R10 | Invariant held by convention, not construction | IMPL | the code satisfies a house invariant only because of how every current caller happens to invoke it; nothing pins the calling convention |
| P10 | Warrant decay on citation | CTRL | a tiered warrant stated once, at the end, is stripped the moment a row is quoted; a transcript-warranted claim is relayed as tree-verified |
| G14 | Class proliferation | CTRL | a taxonomy grows a class per incident until neighbouring classes cannot be separated by any observation; discriminating power falls as coverage rises |
| K3 | Oversight starvation | CTRL | the oversight layer consumes the budget the work needs — usage window, CPU, tree locks — so the system is safest exactly when it is doing least |

**K4 — retry amplification.** Nothing in the sweep or gate layer distinguishes "this pass has not run"
from "this pass ran, died mid-write, and is being re-run while its first invocation still holds a
descriptor". The post-commit detached sweep already rewrites shared rollups mid-suite for concurrent
sessions (v1, Cross-cutting amplifiers); a retry doubles that writer set. Derived only — no incident.

**K5 — quorum without independence.** v1's `G12` names self-adjudication: an agent judging gates that
judge agent work. `K5` is the failure one level out — the *panel*. Three verifiers instantiated from
one prompt template, on one model, in one session's context are not three independent observations,
and majority-of-three is the shape this repository's own review workflows use. No measurement of
inter-rater independence exists here. `G10` measured rater *pathology*; nobody has measured rater
*correlation*.

**R10 — the specific live instance, verified, with no failure attached.**
[`monitor/rollup.mjs:669`](rollup.mjs#L669) reads `process.env.CW_ANNOTATIONS` at module load, which
the house invariant forbids ("read the env at CALL time, never at module load"). It is nonetheless
correct today: `rollup.mjs` has **zero importers** — every consumer, including
`monitor/test/scanner-annotations.test.mjs`, spawns it as a child process and passes env at spawn, so
the capture happens after the override is set. Verified this pass: no `from '…rollup.mjs'` anywhere in
the tree. 29 module-load env captures exist across `bin/`, `monitor/`, `admin/`, `cra/`; the ones
checked are all in spawn-only or CLI-entry position. The defect is that **nothing states or tests the
spawn-only property**. The day someone adds an `import` for a helper, every test that sets
`CW_ANNOTATIONS` keeps passing and stops proving anything — v1's `M5` with the seam present and inert,
which is a worse state than `M5`'s absent seam because the seam is visible in review.

**A12 / G14 / P10 apply to this document.** v2 adds 26 classes to a catalogue of 51 and must therefore
answer `G14` for itself: for each new class, is there an observation that separates it from its nearest
neighbour? The separations are stated inline (`K1` vs `A10`, `K7` vs `R1`, `P11` vs `R1`, `M9` vs `C5`,
`E1` vs `M2`). Two are weak and are marked as such: `A12` and `P10` are both about how a reader treats
a record, and the observation separating them is thin — `P10` predicts a *specific* false quotation,
`A12` predicts *reduced scrutiny overall*. If no such quotation is ever found while trust demonstrably
rises, `A12` absorbs `P10`.

---

## 5. ▒ Shade 2 — partial evidence

Eight classes. An adjacent incident exists, or a measurement implies the mechanism, but the class
itself has not been observed firing.

| id | Class | Layer | Mechanism |
|---|---|---|---|
| K2 | No controller for the controller | CTRL | nothing adjudicates the scheduler; the only candidate lane has n=1 and has caught nothing |
| K6 | Escalation with no terminal authority | CTRL | every path for a class ends at "the operator's call", and the operator is not pageable by the system that needs them |
| K8 | Declaration/schedule drift | CTRL | the set the controller schedules diverges from the set the registry declares; the difference is invisible to both |
| E1 | Instrument version drift | IMPL | an upstream rule set, feed shape or severity mapping changes; a longitudinal metric compares two instruments and reports a trend |
| E3 | Third-party clean is unverifiable | IMPL | a vendor's "0 findings" carries the same weight as a local zero, with no husk detector for the vendor's pipeline |
| E5 | Canary disclosure | CTRL | the plant set is documented where the tested agents read it, so the harness measures recognition rather than detection |
| R9 | Unratcheted fix | CTRL | a fix lands with nothing pinning it; its regression is invisible by construction |
| G13 | Catalogue substitutes for repair | CTRL | writing the row discharges the obligation the row describes; documentation output is counted as remediation |

**K2 — the evidence.** v1's own measured table: `liveness` — catch **0.0%**, false-clean **100.0%**,
n=1. The one lane whose job is to notice that a scheduled thing did not happen has caught nothing, once.
v1 records this honestly as an alarm rather than a rate. `K2` is the class behind it: the sweep decides
what runs, and the only check on that decision is a lane with no demonstrated sensitivity. Not
shade 1, because n=1 supports the class no better than it supports its negation.

**K6 — the evidence.** Of v1's 18 ranked mitigations, three are explicitly operator-gated (#12, #16,
and #1's deletion half), and `A6` — the class *about* advice nothing subscribes to — is itself parked
on the operator, open since a commit. The recursion is the finding: the mitigation for "advisory
output is actioned zero times" is an advisory to the operator. ~55 advisory firings, 0 actions, is the
measured base rate for that channel.

**E5 — the evidence.** v1 §"What a harness can plant" enumerates precisely which classes are plantable,
which are manual, and which are not plantable at all; `bin/canary-harness.mjs` plants C1/C3/C9/C11 by
name. Both documents sit in a repository whose agents read its docs as standing context. No leakage has
been demonstrated — an agent has not been observed recognising a plant — but the disclosure is
structural and the harness has no unpublished reserve. The mitigation is cheap and unglamorous: keep a
held-back scenario set out of the durable docs.

**G13 — the evidence.** v1 carries **11 "still open" markers** and 18 ranked mitigations, of which the
sequencing note names #1 as "the only irreversible item on the list". `D1` — 847 lines reachable from
no branch anyone tracks — was documented as Band 1 / High impact / Low effort and is still open in the
document that ranked it. The class is not "nothing was fixed"; a great deal was. It is that a catalogue
gives its author the *felt* completion of a repair, and the only defence is counting open markers over
time, which nothing does.

**R9 — the separation from `R3`.** `R3` is a guard that runs on a stated subset. `R9` is a fix with no
guard at all. v1 supplies the exception that shows the rule: a commit shipped "a test whose only job
is to keep the flag there" — named as remarkable, which it should not be.

---

## 6. ▓ Shade 1 — verified on this pass

Nine classes, re-derived from the tree today (eight at a commit; `P12` at a commit). Five are new
observations; four are retrofits — a defect v1 recorded, whose *class* it filed under the wrong layer.

| id | Class | Layer | Mechanism |
|---|---|---|---|
| D6 | Untracked durable record | CTRL | the record exists in exactly one working tree, on a shared checkout, where `git clean` and `git checkout <path>` are named hazards |
| A13 | Index drift at the pointer | CTRL | the index entry describing a document contradicts the document; the pointer decays independently of the target |
| M7 | Cardinality drift | CTRL | the catalogue's own class count is not checkable from the catalogue; ids exist only in prose |
| M9 | Ambient-environment dependence | IMPL | behaviour depends on locale, timezone, `HOME` or `PATH`, which no artifact records, so a result is unreproducible without a variable nobody captured |
| K1 | Ordering contract unstated | CTRL | a pass is correct only if it runs after another; nothing declares it and nothing checks it |
| K7 | Aggregate exit code hides per-item failure | CTRL | a controller over N items returns one status; per-item failure is representable only in text nobody parses |
| P11 | Layer misattribution | CTRL | a controller defect is repaired in the implementation, or the reverse; the fix lands in code that was already correct |
| M8 | Instrument non-termination | IMPL | the instrument does not finish; no findings and no failure are produced, and the absence is scored as a clean run |
| P12 | **Untracked-path co-authorship** | IMPL | one untracked file is multi-author; committing it whole banks every session's content, and the index-safe pathspec form (`P2`'s mitigation) is no defence — it commits the full content of each named path |

**D6 — this taxonomy is not in git.** Verified: `git status --porcelain -- monitor/FAILURE-TAXONOMY.md`
returns `?? monitor/FAILURE-TAXONOMY.md`. It is a durable-tier document, carrying a
`verified-against` stamp, linked from README's Documentation index, and it exists **only in this
working tree** — a checkout that CLAUDE.md describes as having roughly twenty concurrent writers, on
which `git checkout <path>` is a named hazard and `git clean` would remove it without a prompt worth
noticing. `evaluations/` holds **16 further untracked files**, including five `HANDOFF-*` documents
dated within the last four days; tier 3 requires cycle artifacts to be tracked in git *deliberately*,
because "parking an audit's own evidence somewhere untracked is a named failure mode" — CLAUDE.md's
own words, currently describing the state of the tree.

This is `D1`/`D2` one step earlier. `D1` is content reachable from a ref nobody tracks; `D2` is a SHA
in no branch; `D6` is content in **no object at all**. It is also the cheapest fix in either document —
`git add` — and it has the highest ratio of loss to effort of anything either catalogue lists.

**P12 — the orphaned canary fixture, adopted whole.** `P2`'s mitigation is the pathspec commit
(`git commit -F - -- <paths>`), which never touches the shared index; this is the class it does not
close. `bin/test/scanner-canary.test.mjs` sat untracked for a whole session, accumulating completeness
canaries for six formats (`sarif`, `gitleaks`, `trufflehog`, `actionlint`, `shellcheck`, `minify`)
from several sessions — untracked because nobody had taken responsibility for landing it, not because
it was anyone's alone. Landing the minified-code lane's activation needed the `minify` canary, and the
completeness gate takes the file whole, so `git commit -- <that path>` carried three
sessions' canaries under a message that named only `minify`. The pre-commit guard fired on the
*tracked* files (`commitwork.mjs`, `security-baseline.json`) and found them clean; it treated the
untracked file as axiomatically its own, and the grep it used — `minify|actionlint|shellcheck` — did
not list `trufflehog`, so the one uncovered line was the one that mattered. Caught in the post-commit
worktree verification, not before. It is a provenance failure and not a false clean because the content
was correct and *needed* — an orphaned fixture the completeness gate requires — and the only defect is
that the message under-stated what it carried; it could not be corrected, because HEAD had advanced
past a commit before the scope error was seen. The tell that generalises: *untracked ≠ solely-yours
on a shared tree*; the guard is a full-contents diff of any untracked path before committing it whole,
not a keyword grep for your own tokens.

**A13 — the pointer to the taxonomy of claim drift carries claim drift.**
[`README.md:228`](../README.md#L228) describes `FAILURE-TAXONOMY.md` as "**six families** by which
proposition the oversight system got wrong". The document declares **seven** (I–VII); `grep -c` over
its family table returns 7. Family VII (false durability) was added after the index entry was written
and the entry was not re-read. Nobody checked, because the index entry is not what a reader of the
taxonomy reads — and it is exactly what a reader who has *not* opened the taxonomy reads. Separation
from `C10`: `C10` is documentation asserting a property the *system* lacks; `A13` is one document
asserting a property of *another document*, which no test of the system can catch and which
`docs-doctor` does not check, since it verifies that the link resolves and the stamp is fresh, not that
the description is true.

**M7 — the count.** v1 states no total. Counted here: 11 A, 8 R, 9 P, 6 M, 12 G, 5 D = **51**, plus 12
C = 63. The request that prompted this document cited 49. Neither number is retrievable from the
document without a regex over its tables, which is why two readers hold two counts and neither is
wrong on the evidence available to them. This is `M1` (wrong population) applied to a catalogue, and it
is the reason v1's mitigation #11 — make the taxonomy machine-readable — outranks its stated
"Med–High" impact: with a JSON registry, `M7`, `A13` and the plantability claims all become computed
rather than asserted, and v1 already got the guard-wiring claim wrong precisely by asserting it.

**M9 — ambient dependence, the class behind two v1 incidents.** `C5`'s grep-suppresses-matches is a
**locale** dependency: under a C/POSIX locale, `file(1)` calls `bin/bola-run.mjs` binary and grep
withholds matching lines while `grep -c` still counts them. `P5`'s comparator inversion is a
**timezone** dependency: git's `%cI` emits local offset, the ledger emits `Z`, and a string compare
across the two inverted for most of a working day. v1 files these in different families, under
different mechanisms, in different layers. They are one class: *behaviour determined by an ambient
variable that no artifact records*, which makes every result unreproducible in a way that looks like
disagreement between people rather than a missing capture. The generalisation is worth its own row
because the remaining members are unexamined here: `HOME` (the off-tree anchor store lives under it),
`PATH` (which `semgrep`/`gitleaks` binary ran), `TZ` in every timestamp the panel renders.

**K1 — the controller half of `A10`.** v1 files the `noMatch:23` incident under Family II: the carry
block installs a skipped category's rows *after* the annotation overlay runs, so every record matched
zero rows. Correct as an account of the alarm. But the defect is an **ordering contract**: the overlay
must run after the carry, nothing declares that, and nothing would fail if the order changed again.
Fixing the alarm text — or even the order — leaves the class open, because the next pass added to that
pipeline inherits the same unstated requirement. Separation from `A10`: `A10` predicts a false
alarm; `K1` predicts *any* wrong result from a reordering, including a silent one.

**K7 — the controller half of the verdict-journal writer.** v1 records it under `R1`: a shorthand
property `sweptAll,` named a variable that does not exist, so 29 area sweeps threw inside their own
try/catch — **29 sweeps, 29 errors, 0 journals, exit 0 each**. The typo is implementation. The reason
it survived 29 runs is controller: a pass over N items reduced to one exit status has no way to say
"item 7 failed", so the failure had to be noticed by someone reading text. Every fan-out controller in
this repo has that shape. Separation from `C2` (exit code with no subscriber): there, the failure
*reached* an exit code nobody read. Here the exit code is read and is 0, correctly, because the
aggregate genuinely succeeded at aggregating.

**P11 — the fix that landed in correct code.** `R1`'s first repair hoisted nothing: the worktree prune
was placed inside `suiteAtHead()`, which runs only on `regression-pending`. Run it and you get exit 0,
no output, and all 18 stale directories still there — as the commit put it, *"the worktrees accumulate
on the runs that DIE, and a run that dies never reaches any later branch either."* The code edited was
not the code at fault; the fault was in the *lifecycle* — who owns cleanup when a process dies —
which is a controller property. a commit fixed it by moving the prune to top level, i.e. by relocating
the decision, not by correcting a line. `P11` is the class: a defect diagnosed one layer away from
where it lives, producing a fix that is testable, passes, and protects nothing. It is `R1`'s cause,
`R1` is its symptom, and reading them as one class is why the first fix was written.

---

## 7. Bucket index

The four questions this pass was asked, answered by id.

| bucket | classes |
|---|---|
| **(a) found on a new pass** | `D6`, `A13`, `M7`, `P12`, `R10` (fact verified, failure derived), plus `M9`, `K1`, `K7`, `P11` as retrofits of v1 incidents whose class was mis-filed |
| **(b) derivable in this work** | `K1`–`K8`, `M8`, `R9`, `R10`, `G13`, `G14`, `A12`, `P10` |
| **(c) derivable in someone else's work** | `E1`–`E5`, `K5`, `E4` for downstream adopters; `E2`/`E3` for any consumer of vendored suppressions or vendor scanners; `M9` and `K7` are generic to any fan-out controller |
| **(d) controller / implementation** | §2, and the `Layer` column on every table above |

**New totals.** 51 → **77** classes outside Family I; 63 → **89** including it. Of the 26 new: 17
controller, 9 implementation — a sharper ratio than v1's 35:26, which is expected and is not evidence.
The new classes were sought *after* the layer axis existed, and an axis you are looking along finds
things along it. Recorded as a bias in the pass, not as a finding about the system.

## 8. What v2 does not do

- **No incidents are moved.** v1's rows keep their families. Where v2 says a class was mis-filed
  (`K1`, `K7`, `P11`, `M9`), the v1 row is still correct about the *alarm*; v2 adds the layer the row
  did not name. Both readings are needed: `A10` tells you what the operator saw, `K1` tells you what
  to fix.
- **No new measurement.** Every rate quoted here is v1's, taken 2026-08-12, on the adjudicated
  minority (17/185, 23/183, 14/77). They were not re-run for this pass and are subject to `M2` — the
  standing condition, not an anomaly.
- **Nothing here is plantable.** Of the 26 new classes, the canary harness can plant **zero**. `K1`
  and `K7` are the nearest — "does this pipeline still produce a correct result when two passes are
  reordered?" and "does this fan-out report a per-item failure?" are both mechanically checkable, and
  both are better tests than anything currently in the manual set. That is the most useful thing in
  this document and it is stated, not built.
- **This document is untracked and unindexed at the moment it is written**, which is `D6` committed by
  the entry that names `D6`. Unlike v1's callout, this one is stated *before* the failure rather than
  after: `git add monitor/FAILURE-TAXONOMY-v2.md` and a README index line are required for it to be a
  tier-1 document rather than a file in one session's working tree. Until then `docs-doctor` reads it
  as explicit uncertainty, which is the correct rendering and the only reason this is a note and not an
  incident.

## 9. Provenance

- **Verified this pass (tree, a commit, 2026-08-12)** — `D6` (`git status --porcelain`, 16 untracked
  files under `evaluations/`), `A13` (`README.md:228` vs `grep -c` over v1's family table), `M7` (per-
  family class counts), `R10` (`monitor/rollup.mjs:669`; zero importers of `rollup.mjs`; 29 module-load
  env captures across six directories).
- **Derived from v1's tree-verified rows** — `K1` (from `A10`), `K7` (from `R1`), `P11` (from `R1`),
  `M9` (from `C5` + `P5`), `K2`/`K6`/`G13` (from v1's measured table and open-marker count).
- **Doc-cited** — `M8` rests on CLAUDE.md's catastrophic-backtracking trap and `sitemap/README`; the
  14-minute figure was not re-measured here.
- **Derived, unwitnessed** — everything in §4, and `E1`–`E5`. No instance exists in any artifact
  searched. They are recorded because a catalogue that admits only what has already happened is a
  catalogue of the past, and this one is used to decide what to guard.

Two absences deliberately not upgraded: no instance of `K4`, `K5` or `E2` was found in any evaluation
artifact, and their absence from the record is **not** evidence they have not occurred — none of the
three would leave a trace in any artifact this repository writes. That is the difference between a
class that is closed and a class that is unobservable, and only the second one needs an instrument
built before it can ever be scored.
