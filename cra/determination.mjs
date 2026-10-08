// cra/determination.mjs — commitwork's NATIVE determination vocabulary.
//
// A determination is a POINT IN A SPACE, not a label. The three VEX standards each carry a
// different subset of that space, so a single shared label would have to be the intersection —
// which is how `accept` and `wont-fix` came to mean four different things at once.
//
//   A Presence          is the vulnerable thing in the product at all?
//   B Reachability      can the vulnerable code execute?
//   C Exploitability    even if reachable, can an adversary drive it?
//   D Remediation       what are we doing about it?
//   E Evidence          who determined this, how, and how confidently
//
// Two values here — `reachability_unknown` and `exploitability_unknown` — CANNOT BE EXPRESSED BY
// ANY of the three standards, and they are the two this repo cares most about. They exist so that
// "nobody has checked" is a determination in its own right rather than an absence that renders as
// a clean one. They never project to a justification; see cra/determination-projection.mjs.
//
// The legal values of the OUTPUT formats live in schema/vex-vocabulary.json, derived mechanically
// by bin/vex-vocabulary-sync.mjs. Nothing here restates them.
//
// Zero deps.

// ── A · Presence ────────────────────────────────────────────────────────────────────────────────
export const PRESENCE = Object.freeze({
  component_absent: 'The component is not in the product at all.',
  component_present_code_absent: 'The component ships, but the vulnerable code is not in what we ship (tree-shaken, trimmed, or a build flag excludes it).',
  component_present_code_present: 'The component ships and the vulnerable code is in it.',
});

// ── B · Reachability ────────────────────────────────────────────────────────────────────────────
export const REACHABILITY = Object.freeze({
  unreachable_static: 'No call path reaches the vulnerable symbol. A CLAIM ABOUT THE CALL GRAPH — only a call-graph tool may assert it.',
  unreachable_config: 'Reachable in principle, but not in the configuration we ship.',
  unreachable_dependency: 'Only reachable through an optional dependency we do not ship.',
  unreachable_environment: 'Only reachable in an environment (platform, runtime, feature flag) we do not run.',
  reachable: 'A call path reaches the vulnerable code.',
  // ADDED 2026-08-22 while wiring the first real call-graph producer, which exposed that the space
  // was missing its MOST COMMON state. govulncheck reports a vulnerable module as imported-but-with-
  // no-traced-path; that is neither `unreachable_static` (it does not assert a path cannot exist)
  // nor `reachability_unknown` (an analyser demonstrably ran). Collapsing it into the former is
  // precisely the dep-scan `in_triage` defect; collapsing it into the latter discards a real
  // analysis. It requires call_graph evidence — an analyser must have run — and it is NEVER a
  // not-affected reason, so it can never become a justification in any output format.
  reachability_unproven: 'A call-graph analyser RAN and showed no path to the vulnerable symbol. Absence of proof, not proof of absence.',
  reachability_unknown: 'NOBODY HAS CHECKED. The honest default, and expressible by no VEX standard.',
});

// ── C · Exploitability under deployment ─────────────────────────────────────────────────────────
export const EXPLOITABILITY = Object.freeze({
  adversary_cannot_control: 'The inputs that reach the vulnerable code are not attacker-controlled.',
  mitigated_inline: 'A protection built into the product prevents exploitation.',
  mitigated_compiler: 'A compiler-level protection (stack protector, FORTIFY, CFI) prevents exploitation.',
  mitigated_runtime: 'A runtime protection (sandbox, RASP, seccomp) prevents exploitation.',
  mitigated_perimeter: 'A perimeter control (WAF, gateway policy) prevents exploitation.',
  exploitable: 'An adversary can drive the vulnerable code.',
  exploitability_unknown: 'NOBODY HAS CHECKED. Expressible by no VEX standard.',
});

// ── D · Remediation ─────────────────────────────────────────────────────────────────────────────
// `no_fix_available_upstream` and `will_not_fix_by_choice` are DIFFERENT FACTS and every standard
// already distinguishes them. Collapsing them — as `accepted` did — tells a reader who is deciding
// whether we were negligent that "nobody has shipped a fix" and "we chose not to" are the same.
export const REMEDIATION = Object.freeze({
  fixed_verified: 'Fixed, and the fix is evidenced in the remediation ledger.',
  fix_available_not_applied: 'An upstream fix exists and we have not taken it yet.',
  fix_planned: 'We intend to fix it; no fix is shipped yet.',
  no_fix_available_upstream: 'No fix exists to take. NOT a choice.',
  will_not_fix_by_choice: 'A fix exists or could be made and we have decided not to. A CHOICE.',
  workaround_applied: 'A configuration change avoids exposure without resolving the vulnerability.',
  mitigation_applied: 'A control reduces the risk without avoiding exposure or resolving it.',
  rollback_applied: 'We reverted to a version without the vulnerability.',
  under_investigation: 'Not yet determined.',
});

// ── E · Evidence ────────────────────────────────────────────────────────────────────────────────
// `scanner_default` is deliberately weak: it means a tool emitted this with no analysis behind it
// (dep-scan's `in_triage`, a severity mapping). It must never satisfy a reachability claim.
export const METHOD = Object.freeze({
  call_graph: 'A reachability analyser walked the call graph (govulncheck, osv-scanner --call-analysis).',
  // DISTINCT FROM call_graph, deliberately. A call graph proves a function is invoked; a taint path
  // proves attacker-controlled data ARRIVES at a sink. Collapsing them would let a SAST path stand
  // in for a reachability analysis it never performed, and vice versa.
  dataflow: 'A taint-tracking query traced data from an untrusted source to a dangerous sink (CodeQL codeFlows).',
  config_read: 'A configuration or build file was read and cited.',
  manual_review: 'A human read the code or the deployment and recorded what they found.',
  vendor_statement: 'The upstream vendor asserted it.',
  dual_agent_adjudication: 'Two independent agents analysed and cross-reviewed (admin/routes/codeql-remediation.mjs).',
  scanner_default: 'A tool emitted this with no analysis behind it. Evidence of nothing.',
});
export const CONFIDENCE = Object.freeze(['low', 'medium', 'high']);

export const AXES = Object.freeze({
  presence: PRESENCE, reachability: REACHABILITY, exploitability: EXPLOITABILITY, remediation: REMEDIATION,
});

// ── legality between axes ───────────────────────────────────────────────────────────────────────
// Not every point in the product space is a coherent statement. An absent component has no
// reachability to speak of; claiming one is a category error that would project into a justification
// asserting analysis nobody could have run.
export function legality(d) {
  const errs = [];
  const has = (axis, val) => Object.prototype.hasOwnProperty.call(AXES[axis], val);
  for (const axis of Object.keys(AXES)) {
    if (d[axis] === undefined || d[axis] === null) continue;
    if (!has(axis, d[axis])) errs.push(`${axis}: '${d[axis]}' is not a declared value`);
  }
  if (d.presence === 'component_absent') {
    if (d.reachability && d.reachability !== 'reachability_unknown') {
      errs.push("presence=component_absent with a reachability claim: an absent component has no call graph — use reachability_unknown");
    }
    if (d.exploitability && d.exploitability !== 'exploitability_unknown') {
      errs.push("presence=component_absent with an exploitability claim: nothing is deployed to exploit");
    }
  }
  if (d.presence === 'component_present_code_absent' && d.reachability === 'reachable') {
    errs.push('code_absent with reachability=reachable: the vulnerable code is not shipped, so nothing reaches it');
  }
  if (d.reachability === 'unreachable_static' && d.exploitability === 'exploitable') {
    errs.push('unreachable_static with exploitability=exploitable: unreachable code cannot be driven');
  }
  if (d.remediation === 'fixed_verified' && d.presence === 'component_present_code_present'
      && d.reachability === 'reachable' && d.exploitability === 'exploitable') {
    errs.push('fixed_verified while still present, reachable and exploitable — one of these is stale');
  }
  return errs;
}

// ── the evidence gate ───────────────────────────────────────────────────────────────────────────
// THE LOAD-BEARING RULE. A determination on Axis B or C is a claim about work someone did. Without
// this, the matrix is only a larger vocabulary to guess in — and the failure mode is worse than the
// one it replaces, because a confidently wrong `not_affected` travels in a signed document that a
// downstream consumer has no way to check.
export const EVIDENCE_REQUIRED = Object.freeze({
  unreachable_static: ['call_graph'],
  // An analyser must actually have run. Without this, "we looked and found nothing" is
  // indistinguishable from "we did not look", which is the whole point of the value.
  reachability_unproven: ['call_graph'],
  unreachable_config: ['config_read', 'manual_review'],
  unreachable_dependency: ['config_read', 'manual_review'],
  unreachable_environment: ['config_read', 'manual_review'],
  adversary_cannot_control: ['manual_review', 'dual_agent_adjudication'],
  mitigated_inline: ['manual_review', 'vendor_statement', 'dual_agent_adjudication'],
  mitigated_compiler: ['config_read', 'manual_review'],
  mitigated_runtime: ['config_read', 'manual_review'],
  mitigated_perimeter: ['config_read', 'manual_review'],
});

/**
 * May this determination be asserted from this evidence?
 * Returns {ok, refusals[]} — never throws, so a caller can degrade rather than crash.
 */
export function assertable(d, evidence) {
  const refusals = [];
  const methods = new Set((Array.isArray(evidence) ? evidence : [evidence]).filter(Boolean).map((e) => e.method));
  for (const axis of ['reachability', 'exploitability']) {
    const val = d[axis];
    const need = EVIDENCE_REQUIRED[val];
    if (!need) continue;                                   // `reachable`/`*_unknown` need nothing
    if (!need.some((m) => methods.has(m))) {
      refusals.push(
        `${axis}='${val}' requires evidence with method ${need.map((m) => `'${m}'`).join(' or ')}; `
        + `got ${methods.size ? [...methods].map((m) => `'${m}'`).join(', ') : 'none'}. `
        + `Degrade to '${axis === 'reachability' ? 'reachability_unknown' : 'exploitability_unknown'}' — `
        + 'an unchecked claim is not a determination.',
      );
    }
  }
  return { ok: refusals.length === 0, refusals };
}

/** The safe degradation: strip claims the evidence cannot carry, keeping everything it can. */
export function degrade(d, evidence) {
  const out = { ...d };
  const { refusals } = assertable(d, evidence);
  if (!refusals.length) return { determination: out, degraded: [] };
  const degraded = [];
  for (const axis of ['reachability', 'exploitability']) {
    if (EVIDENCE_REQUIRED[d[axis]] && !assertable({ [axis]: d[axis] }, evidence).ok) {
      degraded.push({ axis, from: d[axis], to: axis === 'reachability' ? 'reachability_unknown' : 'exploitability_unknown' });
      out[axis] = axis === 'reachability' ? 'reachability_unknown' : 'exploitability_unknown';
    }
  }
  return { determination: out, degraded };
}

// ── the reason a thing is not affected ──────────────────────────────────────────────────────────
// Exactly ONE axis explains a not-affected verdict, and the order is the order of strength: an
// absent component outranks an unreachable one, which outranks a mitigated one. Whichever wins is
// the axis whose value becomes the format's justification.
export function notAffectedReason(d) {
  if (d.presence === 'component_absent') return { axis: 'presence', value: 'component_absent' };
  if (d.presence === 'component_present_code_absent') return { axis: 'presence', value: 'component_present_code_absent' };
  if (d.reachability && d.reachability.startsWith('unreachable_')) return { axis: 'reachability', value: d.reachability };
  const c = d.exploitability;
  if (c && (c === 'adversary_cannot_control' || c.startsWith('mitigated_'))) return { axis: 'exploitability', value: c };
  return null;
}

/** Is this determination a NOT-AFFECTED verdict? An unknown on any axis is never one. */
export const isNotAffected = (d) => notAffectedReason(d) !== null;

// ── annotations → determinations (Phase 3) ──────────────────────────────────────────────────────
// An annotation's `action` is a LIFECYCLE VERDICT; a determination is the structured reason behind
// it. The extension does not replace the verdict, and the legacy expansion below claims only what
// the action itself establishes — never more.
//
// `false-positive` deliberately expands to NO determination. It is a claim that the SCANNER was
// wrong, not that the product is unaffected; those are different statements and conflating them
// would let a disputed finding masquerade as an analysed one.
export const LEGACY_ACTION_DETERMINATION = Object.freeze({
  accept: { remediation: 'will_not_fix_by_choice' },
  'wont-fix': { remediation: 'will_not_fix_by_choice' },
  resolved: { remediation: 'fixed_verified' },
  'false-positive': null,
  note: null,
});

/**
 * The determination an annotation carries, explicit if present and inferred from `action` if not.
 * Returns {determination, source, errors} — `source` is 'explicit' | 'legacy-action' | 'none' so a
 * reader can tell a stated determination from one this function derived.
 */
export function determinationFromAnnotation(ann) {
  if (!ann || typeof ann !== 'object') return { determination: null, source: 'none', errors: ['not an annotation'] };
  if (ann.determination) {
    const errors = legality(ann.determination);
    return { determination: ann.determination, source: 'explicit', errors };
  }
  const legacy = LEGACY_ACTION_DETERMINATION[ann.action];
  if (!legacy) return { determination: null, source: 'none', errors: [] };
  // A legacy expansion carries the operator's prose as its evidence, at manual_review — enough for
  // a remediation (a decision), and deliberately NOT enough for a reachability claim.
  return {
    determination: { ...legacy },
    source: 'legacy-action',
    errors: [],
    evidence: [{ source: ann.who || 'unknown', method: 'manual_review', confidence: 'medium', at: ann.at, detail: ann.reason || '' }],
  };
}

/** Validate one annotation against the shape schema/annotation.schema.json declares. */
export function validateAnnotation(ann) {
  const errs = [];
  const ACTIONS = new Set(['accept', 'wont-fix', 'false-positive', 'resolved', 'note']);
  if (!ann || typeof ann !== 'object') return ['not an object'];
  if (!ACTIONS.has(ann.action)) errs.push(`action '${ann.action}' is not a declared action`);
  for (const f of ['reason', 'who', 'at']) if (typeof ann[f] !== 'string' || !ann[f]) errs.push(`${f} is required`);
  if (ann.determination) {
    errs.push(...legality(ann.determination));
    for (const e of (ann.determination.evidence || [])) {
      if (!METHOD[e.method]) errs.push(`evidence method '${e.method}' is not a declared method`);
      if (e.confidence && !CONFIDENCE.includes(e.confidence)) errs.push(`confidence '${e.confidence}' is not low|medium|high`);
    }
  }
  return errs;
}
