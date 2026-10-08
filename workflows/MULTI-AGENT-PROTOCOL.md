<!-- verified-against: 2026-09-25 -->
# Multi-agent evaluation protocol

How to run a multi-agent evaluation on a task, and the rules that exist because a previous run broke
without them. Every rule below is here because it was paid for once — the citation is the incident,
not a principle.

Measured on the 2026-08-05 LM Studio cycle — sibling repo `commitwork-research`,
`runtime/lmstudio-provider-2026-08-05/`, which left this repo at a commit: three agent sets, ~3.2M
fresh tokens, followed by a best-of-breed round 2 that found in its first probe a live defect all
three earlier passes had missed.

---

## 0. The frame — comparative-adversarial, or: two eyes and a brain

**This is not a survey and it is not a vote.** It is binocular vision. Two eyes look at the same
scene from *offset positions*; the brain resolves the two images into something neither eye
contained on its own — depth.

Everything below follows from that one analogy, so it is worth taking literally:

- **The disparity between the views IS the information.** Depth comes from the offset, not from
  either image. Two models that disagree are not a problem to be averaged away — the disagreement is
  the measurement. Averaging two views is how you throw depth away and keep a blur.
- **Zero disparity means one eye.** Two identical models, at the same effort, on the same prompt,
  produce one view twice and a confident flat picture. This is why the axis in rule 8 is *local vs
  opus* or *opus vs fable*: without offset there is nothing to fuse.
- **Excessive disparity is double vision, not depth.** If two views cannot be reconciled at all, do
  not force a fusion — that is diplopia, and it means one eye is broken or the scene was ambiguously
  specified. Report it as unfusable and go fix the prompt or the eye.
- **The brain is a required organ.** Two eyes with no fusion step is just two pictures. The review
  is where depth is produced, and it is not a courtesy pass over the output.

**This cycle is the proof.** Each eye saw something the others could not: one found the silent
project-tag default, another found the fourth endpoint site. Neither found the defect that mattered
most. The round built *from the disparity between them* — the best-of-breed prompt — found on its
first probe that `response_format` empties `content`, which **no individual pass had seen**. That
finding was not in any eye. It was in the fusion.

The review has three jobs, in order:

1. **Validate** — check each model's conclusions against the source it cites. A claim is not a
   finding until someone who did not produce it has re-run or re-read it. On the 2026-08-05 cycle
   this took 13 claims to 11 confirmed, 1 confirmed-and-worse, 1 partially confirmed — and it caught
   a *refutation that was itself wrong*.
2. **Cross-validate** — where two models agree, ask *why*; where they disagree, **fuse rather than
   average**. Adjudicating is not picking a winner: the output should be something neither view
   contained. Disagreement is the signal, not the noise.
3. **Score on multiple dimensions**, per rules 3, 7 and 8.

### Convergence is evidence, and its strength depends on direction

The models share a prompt. So:

- **Convergence AGAINST the shared input is strong.** All three agents independently refuted two
  `[V]` claims in the prompt they were given. They had to work against their own briefing to get
  there, which is the hardest direction.
- **Convergence WITH the shared input is weak.** Three models agreeing on something the prompt told
  them is three copies of the prompt. It is not corroboration; it is an echo, and the correlation is
  structural rather than evidential.

Never report agreement without saying which kind it was.

### Dimensions evolve — so version them

The dimension set is **expected to change** as the work teaches you what to measure. That is healthy,
and it has one hard consequence: **a score is not comparable across cycles unless the dimension-set
version travels with it.** Stamp the version wherever scores are published. A rubric that changed
silently between cycles turns an instrument change into apparent improvement — which is the same
class of error as an unstamped doc asserting freshness it does not have.

---

## 1. The probe manifest — a gate, not a suggestion

**The rule.** The task prompt declares every live endpoint the task touches. The agent returns a
**measured result per entry**, or an explicit "could not measure, because —". A design claim about
an endpoint with no measured result in the manifest is not a finding; it is a guess with a citation
style.

```
probeManifest:
  - endpoint: http://127.0.0.1:1234/v1/chat/completions
    mustAnswer:
      - does response_format json_schema hold, or is it ignored?
      - which reasoning field is populated?
      - what comes back for a listed-but-unloaded model?
  - endpoint: http://127.0.0.1:3030/api/upsert
    mustAnswer:
      - are unknown fields preserved or dropped?
```

**Why.** Three round-1 agents wrote reports about integrating LM Studio and **not one named a single
model it served**, while the endpoint sat on loopback with six loaded. Round 2 probed it and found in
one A/B that `response_format: json_schema` *causes* `message.content` to come back empty — the
payload arrives in `reasoning_content`. The panel's only schema-sending path had been running on its
salvage fallback on 100% of calls. Cost of not probing: an entire round.

**The failure this creates, deliberately.** An agent that cannot reach a declared endpoint must now
say so loudly rather than quietly theorise. Environment problems will start surfacing as evaluation
failures. That is the intent.

## 2. `[V]` requires a citation or a runnable command

**The rule.** Every claim marked `[V]` (verified) carries either `file:line` or the literal command
that produced it. `[D]` means documented-in-repo but not re-measured. `[I]` is inference. A prompt
that marks its own assumptions `[V]` launders them into evidence for every agent downstream.

**And the shape-of-probe clause.** A claim about stored data comes from the **canonical single-record
read**. A listing is evidence of what it returned, never of what is absent.

**Why.** The 2026-08-05 task prompt carried two `[V]` claims that were false — a documented CLI flag
that was never parsed, and "no provider registry" where two already existed. All three agents refuted
them independently, which is the system working, but only after ~1.3M tokens of duplicated
refutation. A third figure (`6→50`) was asserted as measured with no in-repo source.

The shape clause is separately paid for, twice. The store's LIST endpoint omits `external_id`, which
GET-by-id carries: trusting the listing reported all 477 records as identity-less and would have
minted 477 duplicate identities in a migration. Round 2 — whose own prompt carried this warning —
then refuted a true claim by checking a listing instead of fetching by id.

## 3. Declare the rubric per remit, before the agents run

**The rule.** Each agent receives, in its own prompt, the dimensions it will be scored on. A planner
is not scored on hazard-analysis coverage. A breaker is not scored on executability.

**Why.** Two of the four largest gaps in the 2026-08-05 scoring surface were **the scorer's error,
not the agents'**: a plan agent scored 4.2/10 on HAZOP coverage it was never asked to perform, and an
adversarial agent scored 6.9/10 on actionability that was explicitly not its remit. Those two gaps
(5.8 and 3.1) were the largest in the set and measured nothing about the work.

**Consequence to stamp.** Changing the rubric makes scores non-comparable across cycles. Say so where
the scores are published, or the next cycle reads an instrument change as improvement.

## 4. Decisions are a schema, not a hope

**The rule.** Every open decision returns:

```json
{ "decision": "...", "reasoning": "...", "whatWouldChangeMyMind": "...", "machineCheckable": true }
```

A conditional ("X is right but the mechanism isn't safe enough") fails the shape and must be
resolved or explicitly deferred with a named blocker. Prefer decisions a **field can enforce** over
decisions a document asserts.

**Why.** Two of three agents "answered" the open decisions with conditionals (D4 gaps of 3.2 and
2.6). The best answer in the cycle was the one made machine-checkable: an inference provider would carry
`kind`, and the dispatch path would *refuse* anything that is not a session provider — so the
confusion becomes representable and refused rather than inexpressible and re-made next session. It
is proposed, not built: `manifests/llm-hosts.json` carries no `kind` field.

## 5. Re-run your own headline number

**The rule.** Any figure cited as *measured* is re-run once, and both values are reported. If they
disagree, say so and give the range.

**Why.** An adversarial pass reported a measured ReDoS at 2k/8k/32k → 10.7/92.6/1340 ms. Re-running
it gave 1.9/30.6/458 ms. The quadratic *shape* reproduced exactly — the finding was sound and the
regex genuinely vulnerable — but the magnitude was ~3× overstated and it was the number that carried
the argument.

## 6. The agent writes its own artefact. The orchestrator transcribes nothing.

**The rule.** Each agent writes directly to a declared path: a machine-readable artefact (`.json` —
demonstrably permitted) plus a prose file. The orchestrator may add a provenance header and may
verify; it may **not** re-author. Declare the path under `evaluations/<cycle>/`, which is gitignored here and versioned in the
private sidecar repository that `evaluations/` links to. `/reports/` is gitignored with no such
home, so an artefact written there is not in any tree the next session reads.

**Why.** On the 2026-08-05 cycle no round-1 agent's prose reached the tree except through my hands:
the plan agent had no Write tool, the adversarial agent's `.md` write was blocked by the harness,
and only the Bifocal+ agent's `.json` (**36.7 KB**) landed by its own hand — which is what makes
`.json` demonstrably permitted. Measured result: the round-2 agent, which wrote directly, produced a
**40.7 KB** findings file. My transcriptions of the Bifocal+ and adversarial prose are **6.9 KB and
6.3 KB** — a ~6× fidelity loss. (Both files cite 6.6 and 5.8 in their own warning banners: that was
their size as transcribed, before the banner was appended.) The highest-scoring agent of the three
has the thinnest surviving artefact, and its full HAZOP matrix, five rings of detail and nineteen
findings exist nowhere.

**Blast radius, accepted deliberately.** The orchestrator loses editorial control over framing. That
is the point: transcription is where the content died and where my framing silently replaced theirs.

## 7. Scoring, and its honest limitation

Score against **anchors fixed before comparison**, and against **independent source verification** —
never against whether another report agreed. If the scorer has already read every report, a blind
score is not available; **say so** rather than claiming one.

Do **not** add a scorer agent to solve this. It was proposed and cut: adding an agent to a process
whose central finding is that agent count buys nothing refutes itself. Declaring the contamination
achieves the same thing at zero cost.

## 8. A/B across the axis you are trying to learn about, at fixed effort

**The rule.** A quality A/B varies **one** axis and holds effort constant. For evaluation work the
useful axes are **local vs opus** and **opus vs fable** — because the decision they inform is *what
should this run on*. Vary the model, fix the effort, fix the prompt.

**Distinguish two things that both get called "A/B":**

| | Purpose | Varies | Example from this cycle |
|---|---|---|---|
| **Capability probe** | Does this endpoint/model do X? | the target | `response_format` with vs without, on one model |
| **Quality A/B** | Which model should do this work? | the model, at fixed effort | not yet run |

A capability probe is not evidence about quality, and a quality A/B is not evidence about capability.
The cycle below ran the first and drew a conclusion shaped like the second.

**Offset is the whole point** (rule 0). Two models chosen for similarity give you one eye twice. Pick
the pair for *disparity you can still fuse* — different enough to see different things, close enough
that the disagreement is resolvable rather than diplopic.

**Why this matters, measured.** The `response_format` finding was isolated on `qwen3.6-27b` and
inferred to "LM Studio thinking models" generally. Running the *same probe on a second model*
refuted the inference in one call: `gemma-4-12b-qat` populates `content` correctly under an identical
schema. One model is not a fleet. **A single-target measurement generalised to a class is the same
error as a listing generalised to absence** — both assert something about what was never looked at.

## 9. Method diversity beats agent count — but this is one observation, and it is confounded

Measured across the three round-1 sets:

| set | fresh tokens | score /90 | points per M |
|---|---:|---:|---:|
| adversarial (Overloop ×2 + Breakers) | 400,564 | 76.7 | **191.5** |
| Bifocal+ | 1,500,168 | 76.3 | 50.9 |
| plan | 1,274,286 | 71.7 | 56.3 |

Every novel finding came from **method diversity, never from agent count**. The two constructive sets
largely duplicated each other's findings at ~1.3M tokens of overlap.

**This is not yet a rule, and per rule 8 it is the wrong A/B.** All three sets ran on the same model
(`claude-opus-5`), so the only axis varied was method. That measures methods against each other and
**cannot distinguish "the adversarial method is efficient" from "adversarial-shaped work is simply
cheaper"** — the second explanation fits the numbers equally well and has nothing to do with method
quality.

The comparison that would actually inform the spend is the one rule 8 names: **the same method, same
effort, local vs opus** — or opus vs fable. Until that runs, this table is a curiosity, not a budget
argument.

One task shape, one measurement, one confounded axis. Retiring a set would also delete exactly the
redundancy that caught the two false `[V]` claims — so rule 2 is its compensating control, and until
rule 2 has proven itself over a full cycle, **run three and pay for it**.

---

## Order of application

Rules 1–5 are prompt-shape and land together — they share the same prompt section, and applying them
piecemeal rebases each onto a stale copy of the others. Rule 6 is orchestration and is independent.
Rule 8 governs how any comparison is set up. Rule 9 changes nothing until it has a second, unconfounded
observation.

