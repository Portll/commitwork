<!-- verified-against: 2026-10-13 5e582892 -->
# Multi-agent evaluation protocol

How to run a multi-agent evaluation on a task, and the rules that keep one from breaking. Each rule
states the failure it prevents.

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

Each eye sees something the others cannot, and the defect that matters most may be in neither. A
round built *from the disparity between them* can find what **no individual pass saw**, and only
the fusion step produces that finding.

The review has three jobs, in order:

1. **Validate** — check each model's conclusions against the source it cites. A claim is not a
   finding until someone who did not produce it has re-run or re-read it. Validation also catches a
   *refutation that is itself wrong*.
2. **Cross-validate** — where two models agree, ask *why*; where they disagree, **fuse rather than
   average**. Adjudicating is not picking a winner: the output should be something neither view
   contained. Disagreement is the signal, not the noise.
3. **Score on multiple dimensions**, per rules 3, 7 and 8.

### Convergence is evidence, and its strength depends on direction

The models share a prompt. So:

- **Convergence AGAINST the shared input is strong.** Agents that independently refute a `[V]` claim
  in the prompt they were given have to work against their own briefing to get there, which is the
  hardest direction.
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

**Why.** An agent can write a full report about a live service without once querying it, and one
probe of the endpoint can overturn what the whole report inferred from reading code.

**The failure this creates, deliberately.** An agent that cannot reach a declared endpoint must say
so loudly rather than quietly theorise, so environment problems surface as evaluation failures.
That is the intent.

## 2. `[V]` requires a citation or a runnable command

**The rule.** Every claim marked `[V]` (verified) carries either `file:line` or the literal command
that produced it. `[D]` means documented-in-repo but not re-measured. `[I]` is inference. A prompt
that marks its own assumptions `[V]` launders them into evidence for every agent downstream.

**And the shape-of-probe clause.** A claim about stored data comes from the **canonical single-record
read**. A listing is evidence of what it returned, never of what is absent.

**Why.** A false `[V]` claim in a task prompt (a documented flag that is never parsed, "no registry"
where one exists) reaches every agent. Each then either builds on it or spends its own budget
refuting it, and the refutations duplicate each other.

The shape clause exists because a listing can omit a field that the single-record read carries.
Trusting such a listing reports every record as lacking the field, and a migration built on it
mints duplicates. A warning in the prompt is not enough on its own: an agent can still refute a true
claim by checking a listing instead of fetching by id.

## 3. Declare the rubric per remit, before the agents run

**The rule.** Each agent receives, in its own prompt, the dimensions it will be scored on. A planner
is not scored on hazard-analysis coverage. A breaker is not scored on executability.

**Why.** Scoring an agent on a dimension outside its remit produces a gap that is **the scorer's
error, not the agent's**: a plan agent marked down on hazard-analysis coverage it was never asked to
perform, or an adversarial agent on actionability. Such gaps can be the largest in a set and measure
nothing about the work.

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

**Why.** A conditional reads as an answer and leaves the decision open. A machine-checkable decision
closes it: a provider record that carries `kind`, with a dispatch path that *refuses* the wrong kind,
makes the confusion representable and refused rather than inexpressible and re-made later.

## 5. Re-run your own headline number

**The rule.** Any figure cited as *measured* is re-run once, and both values are reported. If they
disagree, say so and give the range.

**Why.** One timing run can reproduce the right *shape* and the wrong magnitude. A genuinely
quadratic ReDoS can still be reported several times slower than a re-run measures, and the number is
what carries the argument.

## 6. The agent writes its own artefact. The orchestrator transcribes nothing.

**The rule.** Each agent writes directly to a declared path: a machine-readable artefact (`.json` —
demonstrably permitted) plus a prose file. The orchestrator may add a provenance header and may
verify; it may **not** re-author. Declare the path under `evaluations/<cycle>/`, which is gitignored
here and versioned in the private sidecar repository that `evaluations/` links to. `/reports/` is
gitignored with no such home, so an artefact written there is not in any tree a later run reads.

**Why.** Transcription is lossy and silent. An orchestrator that re-authors an agent's report keeps a
fraction of it, and the agent with the most detail can end up with the thinnest surviving artefact.
An agent writing its own file keeps all of it.

**Blast radius, accepted deliberately.** The orchestrator loses editorial control over framing. That
is intended: transcription is where content is lost and where the orchestrator's framing silently
replaces the agent's.

## 7. Scoring, and its honest limitation

Score against **anchors fixed before comparison**, and against **independent source verification** —
never against whether another report agreed. If the scorer has already read every report, a blind
score is not available; **say so** rather than claiming one.

Do **not** add a scorer agent to solve this: adding an agent to a process whose central finding is
that agent count buys nothing refutes itself. Declaring the contamination
achieves the same thing at zero cost.

## 8. A/B across the axis you are trying to learn about, at fixed effort

**The rule.** A quality A/B varies **one** axis and holds effort constant. For evaluation work the
useful axes are **local vs opus** and **opus vs fable** — because the decision they inform is *what
should this run on*. Vary the model, fix the effort, fix the prompt.

**Distinguish two things that both get called "A/B":**

| | Purpose | Varies | Example |
|---|---|---|---|
| **Capability probe** | Does this endpoint/model do X? | the target | `response_format` with vs without, on one model |
| **Quality A/B** | Which model should do this work? | the model, at fixed effort | the same prompt and effort on two models |

A capability probe is not evidence about quality, and a quality A/B is not evidence about capability.
The common error is to run the first and draw a conclusion shaped like the second.

**Offset is the whole point** (rule 0). Two models chosen for similarity give you one eye twice. Pick
the pair for *disparity you can still fuse* — different enough to see different things, close enough
that the disagreement is resolvable rather than diplopic.

**Why.** A capability finding isolated on one model and inferred to a class (say, every LM Studio
thinking model) can be refuted in one call by running the *same probe on a second model*. One model
is not a fleet. **A single-target measurement generalised to a class is the same
error as a listing generalised to absence** — both assert something about what was never looked at.

## 9. Method diversity beats agent count — an observation, and a confounded one

As of 2026-08-05, in one three-set run on one model, the adversarial set scored 3.4 to 3.8 times
the points per million tokens of the other two. Every novel finding in that run came from **method
diversity rather than agent count**: the two constructive sets largely duplicated each other's
findings, at the cost of both.

**This is not yet a rule, and per rule 8 it is the wrong A/B.** When every set runs on the same
model, the only axis varied is method. That measures methods against each other and **cannot
distinguish "the adversarial method is efficient" from "adversarial-shaped work is simply
cheaper"**; the second explanation fits as well and has nothing to do with method quality.

The comparison that would actually inform the spend is the one rule 8 names: **the same method, same
effort, local vs opus**, or opus vs fable. Until that runs, retiring a set would also delete the
redundancy that catches false `[V]` claims, so rule 2 is its compensating control, and until rule 2
has proven itself over a full cycle, **run three and pay for it**.

---

## Order of application

Rules 1–5 are prompt-shape and land together — they share the same prompt section, and applying them
piecemeal rebases each onto a stale copy of the others. Rule 6 is orchestration and is independent.
Rule 8 governs how any comparison is set up. Rule 9 changes nothing until it has a second, unconfounded
observation.

