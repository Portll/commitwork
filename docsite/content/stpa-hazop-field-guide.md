# STPA & HAZOP++ Field Guide

Two hazard-analysis lenses run together in commitwork: STPA judges control loops from the
controller's side, HAZOP++ walks data boundaries from the crossing's side. The STPA vocabulary below
is the one `monitor/failure-taxonomy.json` applies to every taxonomy class, and
`monitor/stpa-sweep.mjs` re-evaluates commitwork's own panel and remediation control loop against a
fixed UCA and HAZOP table. The HAZOP++ worked examples come from commitwork's analysis of its CWE →
CAPEC → ATT&CK enrichment, with the figures re-measured over the tracked MITRE data.

| stat | value |
|---|---|
| STPA loops | 6 |
| UCA values | 8 |
| causal factors | 16 |
| guide words | 10 standard + 2 ext. + 2 proposed |

## 01 — STPA — System-Theoretic Process Analysis

STPA judges a system by its control loops: a controller issues actions to a process it does not
directly see, and reads that process back through feedback. A hazard is a state the loop can
reach — not a component that breaks.

### The control loop being judged

```svg
<svg viewBox="0 0 640 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="STPA control loop: a controller with an internal process model issues a control action through an actuator to the controlled process, which reports back through a sensor as feedback, closing the loop.">
  <defs>
    <marker id="fg-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
    <marker id="fg-ar-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#c0392b"/>
    </marker>
    <marker id="fg-ar-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#2a6fa8"/>
    </marker>
  </defs>
  <rect x="330" y="18" width="150" height="46" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3"/>
  <text x="405" y="37" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">internal belief</text>
  <text x="405" y="52" text-anchor="middle" font-size="12" font-weight="650" fill="currentColor">process model</text>
  <line x1="330" y1="41" x2="300" y2="41" stroke="currentColor" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>
  <rect x="150" y="18" width="150" height="60" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="225" y="44" text-anchor="middle" font-size="12" font-weight="650" fill="currentColor">CONTROLLER</text>
  <text x="225" y="60" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">issues actions, holds a belief</text>
  <rect x="470" y="130" width="110" height="56" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="525" y="154" text-anchor="middle" font-size="12" font-weight="650" fill="currentColor">ACTUATOR</text>
  <text x="525" y="170" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">executes the action</text>
  <rect x="255" y="230" width="150" height="66" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="330" y="258" text-anchor="middle" font-size="12" font-weight="650" fill="currentColor">CONTROLLED PROCESS</text>
  <text x="330" y="274" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">the thing being governed</text>
  <rect x="60" y="130" width="110" height="56" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="115" y="154" text-anchor="middle" font-size="12" font-weight="650" fill="currentColor">SENSOR</text>
  <text x="115" y="170" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">observes real state</text>
  <path d="M296,70 C 420,95 470,105 495,128" fill="none" stroke="#c0392b" stroke-width="2" marker-end="url(#fg-ar-red)"/>
  <text x="400" y="98" font-size="10.5" font-weight="600" fill="#c0392b">control action</text>
  <path d="M497,188 C 460,215 420,225 385,233" fill="none" stroke="#c0392b" stroke-width="2" marker-end="url(#fg-ar-red)"/>
  <path d="M275,233 C 220,222 175,210 145,188" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.6" marker-end="url(#fg-ar)"/>
  <path d="M130,128 C 150,100 175,80 202,66" fill="none" stroke="#2a6fa8" stroke-width="2" marker-end="url(#fg-ar-blue)"/>
  <text x="40" y="105" font-size="10.5" font-weight="600" fill="#2a6fa8">feedback</text>
</svg>
```

Every STPA hazard traces to one of four faults in this loop: the controller's process model is
wrong, the action it issues is unsafe, the actuator mangles or delays it, or the feedback lies.
Control actions are drawn in red and feedback in blue throughout this page.

### The four stages, in order

```svg
<svg viewBox="0 0 940 130" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="STPA process flow: Losses and Hazards inform Safety Constraints, which the Control Structure model must enforce; Unsafe Control Actions are judged against every control action in that structure, then traced to Causal Factors that explain why each could occur.">
  <defs>
    <marker id="ar-n" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <rect x="10" y="30" width="150" height="60" rx="2" fill="none" stroke="#c0392b" stroke-width="1.8"/>
  <text x="85" y="56" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">Losses</text>
  <text x="85" y="72" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">what stakeholders lose</text>
  <path d="M160,60 L192,60" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-n)"/>
  <rect x="196" y="30" width="150" height="60" rx="2" fill="none" stroke="#c0392b" stroke-width="1.8"/>
  <text x="271" y="56" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">Hazards</text>
  <text x="271" y="72" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">states that lead there</text>
  <path d="M346,60 L378,60" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-n)"/>
  <rect x="382" y="30" width="150" height="60" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="457" y="56" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">Constraints</text>
  <text x="457" y="72" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">negation of each hazard</text>
  <path d="M532,60 L564,60" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-n)"/>
  <rect x="568" y="30" width="150" height="60" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="643" y="56" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">Control structure</text>
  <text x="643" y="72" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">controllers + actions</text>
  <path d="M718,60 L750,60" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-n)"/>
  <rect x="754" y="30" width="176" height="60" rx="2" fill="none" stroke="#c0392b" stroke-width="1.8"/>
  <text x="842" y="50" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">Unsafe Control</text>
  <text x="842" y="63" text-anchor="middle" font-size="11.5" font-weight="600" fill="currentColor">Actions → Causal Factors</text>
  <text x="842" y="78" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">judged, then explained</text>
  <path d="M85,90 C 85,112 843,112 843,92" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.6" stroke-dasharray="2 3" marker-end="url(#ar-n)"/>
  <text x="463" y="122" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">each UCA cites the hazard it feeds</text>
</svg>
```

Standard four-stage STPA (Leveson & Thomas), unchanged from the textbook form — commitwork's own
extension is in the vocabulary it judges with: named controller loops, UCA values and causal
factors, below.

### Commitwork's applied vocabulary

Every taxonomy class in `monitor/failure-taxonomy.json` carries an `stpa` judgment built from three
closed sets — a UCA is a triple: which loop, which of 8 failure shapes, which of 16 root causes.

**6 loops (who's the controller):** `operator` · `monitor` · `scanner` · `agent` · `oversight` · `attention`

**8 UCA values (how it failed):** `not-provided` · `unsafe` · `too-early` · `too-late` ·
`out-of-order` · `stopped-too-soon` · `applied-too-long` · `none`

**16 causes (why):** `controller-algorithm` · `controller-model` · `higher-input` ·
`actuator-delayed` · `actuator-missing` · `actuator-corrupt` · `process-failure` ·
`process-change` · `process-disturbance` · `feedback-missing` · `feedback-delayed` ·
`feedback-incorrect` · `sensor-inadequate` · `coordination-conflict` · `coordination-gap` ·
`coordination-duplicate`

:::note
**The main extension past the textbook:** the `attention` loop has no equivalent in Leveson's
original model. It treats a *published verdict* itself as a control action — the failure mode
isn't a broken pipe, it's a report that spends or withholds the operator's attention wrongly.
Built for a monitoring system, where the paper's control-structure model (built for
physical/organisational systems) has nothing to say. A second, smaller one is the UCA value
`none`, which records that a class describes a measurement or record rather than an action by that
loop's controller.
:::

### Worked example — real UCAs from the CWE → CAPEC → ATT&CK enrichment path

From commitwork's analysis of the enrichment before it was built (8 UCAs, 6 hazards; five UCAs
shown). H1 a finding carries a CAPEC or technique its evidence does not entail · H2 "no mapping" is
indistinguishable from "mapped and clean" · H3 the vendored mapping is stale against upstream · H4
a roll-up walks a non-transitive relationship as if transitive · H5 enrichment multiplies one
finding into N rows or counts.

| UCA | control action | unsafe because | hazard |
|---|---|---|---|
| UCA1 | attribution **provided** from an ancestor CWE | the ancestor is a generalisation — says nothing about *this* finding | H1 |
| UCA2 | attribution **not provided**, rendered blank | blank reads as "checked, nothing found" | H2 |
| UCA5 | attribution provided as **one row per technique** | one CWE reaches up to 59 CAPECs and 27 ATT&CK techniques (4.1 on average, for a CWE that reaches any), so per-technique rows silently inflate every count | H5 |
| UCA7 | attribution **applied too long** — snapshot never re-derived | mapping drifts from upstream with nothing measuring the drift | H3 |
| UCA8 | attribution provided by **inverting** ATT&CK→CAPEC | the published mapping is one-way; the inverse is unasserted | H1, H4 |

## 02 — HAZOP++ — extended guide-word deviation walk

Judges each place data crosses — a field, a call, a pipeline stage — asking one deviation
question per guide word. Two `++` extensions widen the standard IEC 61882 set (the seven basic
words plus the timing and order words); two more are proposed for boundaries where a model
generated what crosses.

### The walk, per boundary

```svg
<svg viewBox="0 0 620 342" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="HAZOP walk: for each guide word at a boundary, ask if the deviation is plausible; if not, mark not applicable with rationale; if plausible, ask if it is real given evidence; if not, note it without escalating; if real, a design response is required.">
  <defs>
    <marker id="ar-h" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" opacity="0.6"/>
    </marker>
  </defs>
  <rect x="215" y="8" width="190" height="42" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="310" y="34" text-anchor="middle" font-size="11" fill="currentColor">boundary + guide word</text>
  <path d="M310,50 L310,72" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-h)"/>
  <polygon points="310,72 400,112 310,152 220,112" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.8"/>
  <text x="310" y="108" text-anchor="middle" font-size="10.5" fill="currentColor">deviation</text>
  <text x="310" y="121" text-anchor="middle" font-size="10.5" fill="currentColor">plausible?</text>
  <path d="M220,112 L60,112" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-h)"/>
  <text x="140" y="104" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">no</text>
  <rect x="10" y="120" width="140" height="46" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="80" y="140" text-anchor="middle" font-size="10" fill="currentColor">n/a — listed</text>
  <text x="80" y="153" text-anchor="middle" font-size="10" fill="currentColor">with rationale</text>
  <path d="M310,152 L310,180" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-h)"/>
  <text x="330" y="170" font-size="9" fill="currentColor" opacity="0.7">yes</text>
  <polygon points="310,180 410,222 310,264 210,222" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.8"/>
  <text x="310" y="217" text-anchor="middle" font-size="10.5" fill="currentColor">real, given</text>
  <text x="310" y="230" text-anchor="middle" font-size="10.5" fill="currentColor">evidence?</text>
  <path d="M410,222 L560,222" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-h)"/>
  <text x="485" y="214" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">no</text>
  <rect x="470" y="230" width="140" height="40" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="540" y="254" text-anchor="middle" font-size="10" fill="currentColor">noted, not escalated</text>
  <path d="M310,264 L310,290" stroke="currentColor" stroke-width="1.6" opacity="0.6" marker-end="url(#ar-h)"/>
  <text x="330" y="280" font-size="9" fill="currentColor" opacity="0.7">yes</text>
  <rect x="200" y="290" width="220" height="44" rx="2" fill="none" stroke="#c0392b" stroke-width="1.8"/>
  <text x="310" y="316" text-anchor="middle" font-size="10.5" fill="currentColor">design response required</text>
</svg>
```

A guide word with no plausible deviation should still be listed, marked n/a with its rationale — an
omission reads as "not considered," which is its own false-clean.

### The lexicon — ten standard, two extensions, two proposed

| | word | deviation question | worked example |
|---|---|---|---|
| core | `NO / NONE` | the thing never arrives | no CAPEC for this CWE — 633 of the 969 CWEs in the shipped view (65.3%) |
| core | `MORE` | more than expected — volume, size, frequency | one CWE → 59 CAPECs, the maximum over the catalogue |
| core | `LESS` | fewer, partial, truncated | CAPEC exists, no ATT&CK — 381 of the 558 live patterns (68%) |
| core | `REVERSE` | flows the other way, or arrives inverted | using ATT&CK→CAPEC — forbidden (UCA8) |
| core | `PART OF` | only a subset of the expected content is present | only part of each abstraction level maps — 449 of 558 live patterns carry a CWE (Meta 50/61, Standard 152/181, Detailed 247/316) |
| core | `OTHER THAN` | right shape, wrong semantics | deprecated ids — 57 of 615 patterns |
| core | `EARLY` | arrives before its precondition holds | enrich at scan time (frozen) vs. read time |
| core | `LATE` | arrives after the point it could still act | a vendored mapping read after upstream has moved — the snapshot is dated and nothing re-derives it on a schedule (UCA7) |
| core | `AS WELL AS` | two relations carry different semantics, conflated | `Related_Weaknesses` vs. `Taxonomy_Mappings` |
| core | `BEFORE / AFTER` | a pipeline step runs in the wrong order | enrich before cross-lane dedup — commitwork enriches only inside the vendored-code lane (`bin/vendor-scan.mjs`), so no second lane carries the same attribution |
| extension | `++ RECURSIVE` | a deviation compounds if the same hop repeats | CWE ancestor walk — depth-1 only, and labelled |
| extension | `++ ADVERSARIAL` | the deviation an attacker would deliberately induce | attribution never lowers a severity |
| proposed | `++ CONFABULATED` | content crosses the boundary with the right shape but no underlying source — synthesised, not derived | a citation, file path, or API that was never real |
| proposed | `++ HIJACKED` | content in the data channel is read as an instruction — the boundary has no separate control channel | text inside a fetched document redirects the agent's next action |

:::note
**Why only two proposed, not adopted:** HAZOP's guide words ask about a deviation *at a
boundary* — something crossing in an unexpected form. `++ CONFABULATED` and `++ HIJACKED` fit
that frame cleanly: both describe a boundary property normal software doesn't have — a generator
that can synthesise plausible content with no source, and a channel that carries data and
instruction over the same wire. Two other LLM failure modes were considered and rejected for this
slot: non-determinism (same input, different output) and sycophancy (a correct answer abandoned
under social pressure) aren't boundary deviations — they're a controller's behaviour varying,
which is exactly what STPA's UCA values and causal factors already exist to capture. Forcing them
into HAZOP's guide-word list would blur that split.
:::

## 03 — Guide word → UCA cross-reference

HAZOP++ names a deviation at the boundary; STPA names the same defect from the control loop's
side.

| guide word | → UCA value | why they align |
|---|---|---|
| `NO / NONE` | `not-provided` | the action never issues, in either vocabulary |
| `MORE` | `unsafe` | the duplicate/excess instance is itself what makes it hazardous |
| `LESS` | `stopped-too-soon` | a process that halts mid-way, read as complete |
| `REVERSE` | `out-of-order` | sequence-dependence violated in both readings |
| `PART OF` | `stopped-too-soon` | a partial payload is a partial completion, judged the same way |
| `OTHER THAN` | `unsafe` | right shape, wrong content — the action itself is the defect |
| `EARLY` | `too-early` | literal match — a precondition race |
| `LATE` | `too-late` | literal match — past the point of use |
| `AS WELL AS` | `coordination-duplicate` *(cause, not UCA)* | two controllers/relations converge unexpectedly on one thing |
| `BEFORE / AFTER` | `too-early` / `too-late` | the pipeline-order variant of the same two values |
| `++ RECURSIVE` | *no clean analogue* | compounding-through-repetition has no single-action UCA shape — it's a property of a *chain* of actions, which per-action UCA judgment doesn't capture |
| `++ ADVERSARIAL` | *no clean analogue* | attacker intent is orthogonal to both taxonomies — HAZOP asks "what if", STPA asks "which action"; neither has an axis for "on purpose" |
| `++ CONFABULATED` *(proposed)* | `unsafe` | the closest fit — a fabricated action is still an action the controller issued, just one built on nothing |
| `++ HIJACKED` *(proposed)* | *no clean analogue* | the existing UCA values assume the controller chose the action; here the choice was smuggled in through data — none of the 8 values name an origin this far outside the controller |

:::hazard
**The same defect, found twice, named from two sides.** UCA1 — "attribution provided from an
ancestor CWE" — and HAZOP's `++ RECURSIVE` — "a CWE's ancestors each reach different CAPECs,
compounding" — are the identical finding in the CAPEC/ATT&CK design. STPA reached it by asking
which control action was unsafe; HAZOP++ reached it by walking the boundary's guide words.
commitwork runs both because a single hazard can be invisible to one lens and obvious to the
other.
:::

---

The STPA vocabulary and every measured figure on this page come from tracked files in this
repository. The UCA and guide-word worked examples come from commitwork's own analysis of the
CAPEC/ATT&CK enrichment, kept with its private evaluation records; the figures it quoted are
re-measured here over the tracked data. The vocabulary counts come from
`monitor/failure-taxonomy.json`'s `stpaVocabulary`. The CWE and CAPEC figures are measured over
`monitor/data/cwe-graph.json` and `monitor/data/capec-graph.json` as fetched from MITRE on
2026-08-23 (ATT&CK ids are the ones CAPEC itself records): 969 CWEs, 558 live CAPEC patterns plus 57
deprecated ones the graph records as dropped. The guide-word ↔ UCA
cross-reference is this page's own synthesis, stated as a reading rather than a repo-declared
mapping. The two `proposed` guide words, `++ CONFABULATED` and `++ HIJACKED`, are this page's own
proposal for LLM-development boundaries — not sourced from any repo document, and not yet adopted
anywhere the standard words or the two extensions are.
