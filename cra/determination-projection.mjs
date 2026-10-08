// cra/determination-projection.mjs — the native determination, projected into the three standards.
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//   never project onto a neighbouring enum value that makes a DIFFERENT FACTUAL CLAIM.
//
// CycloneDX can say `requires_configuration`. OpenVEX cannot. Mapping it to
// `vulnerable_code_not_in_execute_path` — the nearest-looking value — would assert a call-graph
// analysis nobody ran, inside a document a consumer has no way to check. So it degrades to prose
// and SAYS THAT IT DID. Every near-miss below is resolved that way, and
// cra/test/determination-projection.test.mjs asserts the tempting substitutions never happen.
//
// fidelity:
//   exact           the format has this exact concept
//   narrowed        the format's value is strictly BROADER and still true of this determination
//   prose_only      the format cannot say it; carried as free text (detail / impact_statement / threat)
//   unrepresentable the format cannot say it at all, even as prose in a field that belongs to it
//
// Operator rulings 2026-08-22: asymmetric enrichment is kept (CSAF-only `exploit_status`);
// `resolved_with_pedigree` is legitimate for ledger-strong evidence; generate-and-declare.
//
// Every value referenced here must exist in schema/vex-vocabulary.json — asserted by the tests, so
// a typo cannot become a silently-invalid document.

import { notAffectedReason } from './determination.mjs';

const X = (value, carrier) => ({ value, fidelity: 'exact', carrier });
const N = (value, carrier, note) => ({ value, fidelity: 'narrowed', carrier, note });
const P = (carrier, note) => ({ value: null, fidelity: 'prose_only', carrier, note });

// ── the JUSTIFICATION square: why this is not affected ──────────────────────────────────────────
// The asymmetry is real and runs BOTH ways. CycloneDX is richer on *why unreachable*
// (requires_configuration/dependency/environment, protected_by_compiler/at_runtime/at_perimeter);
// CSAF and OpenVEX are richer on *adversary control*. Neither is a superset of the other, which is
// precisely why a native vocabulary has to exist above both.
export const JUSTIFICATION = Object.freeze({
  component_absent: {
    cyclonedx: N('code_not_present', 'justification', 'CycloneDX has no component-level absence; if the component is absent its vulnerable code is certainly not present, so this is broader and still true'),
    csaf: X('component_not_present', 'flag'),
    openvex: X('component_not_present', 'justification'),
  },
  component_present_code_absent: {
    cyclonedx: X('code_not_present', 'justification'),
    csaf: X('vulnerable_code_not_present', 'flag'),
    openvex: X('vulnerable_code_not_present', 'justification'),
  },
  unreachable_static: {
    cyclonedx: X('code_not_reachable', 'justification'),
    csaf: X('vulnerable_code_not_in_execute_path', 'flag'),
    openvex: X('vulnerable_code_not_in_execute_path', 'justification'),
  },
  unreachable_config: {
    cyclonedx: X('requires_configuration', 'justification'),
    csaf: P('threat', 'no flag for configuration-scoped unreachability; vulnerable_code_not_in_execute_path would assert call-graph analysis nobody ran'),
    openvex: P('impact_statement', 'no justification for configuration-scoped unreachability; the nearest value would assert static unreachability'),
  },
  unreachable_dependency: {
    cyclonedx: X('requires_dependency', 'justification'),
    csaf: P('threat', 'no flag for dependency-scoped unreachability'),
    openvex: P('impact_statement', 'no justification for dependency-scoped unreachability'),
  },
  unreachable_environment: {
    cyclonedx: X('requires_environment', 'justification'),
    csaf: P('threat', 'no flag for environment-scoped unreachability'),
    openvex: P('impact_statement', 'no justification for environment-scoped unreachability'),
  },
  adversary_cannot_control: {
    // The asymmetry the other way: CycloneDX has no value for this. protected_by_mitigating_control
    // would assert a CONTROL EXISTS, which is a different claim — the point here is that nothing
    // needs to protect it because the input is not attacker-reachable.
    cyclonedx: P('detail', 'no justification for adversary-uncontrollable input; protected_by_mitigating_control would assert a control that may not exist'),
    csaf: X('vulnerable_code_cannot_be_controlled_by_adversary', 'flag'),
    openvex: X('vulnerable_code_cannot_be_controlled_by_adversary', 'justification'),
  },
  mitigated_inline: {
    cyclonedx: N('protected_by_mitigating_control', 'justification', 'CycloneDX does not distinguish an inline protection from any other mitigating control'),
    csaf: X('inline_mitigations_already_exist', 'flag'),
    openvex: X('inline_mitigations_already_exist', 'justification'),
  },
  mitigated_compiler: {
    cyclonedx: X('protected_by_compiler', 'justification'),
    csaf: P('threat', 'no flag for compiler-level protection; inline_mitigations_already_exist means a protection in the product, not in the toolchain'),
    openvex: P('impact_statement', 'no justification for compiler-level protection'),
  },
  mitigated_runtime: {
    cyclonedx: X('protected_at_runtime', 'justification'),
    csaf: P('threat', 'no flag for runtime protection'),
    openvex: P('impact_statement', 'no justification for runtime protection'),
  },
  mitigated_perimeter: {
    cyclonedx: X('protected_at_perimeter', 'justification'),
    csaf: P('threat', 'no flag for perimeter protection'),
    openvex: P('impact_statement', 'no justification for perimeter protection'),
  },
});

// ── the RESPONSE square: what we are doing ──────────────────────────────────────────────────────
export const RESPONSE = Object.freeze({
  fixed_verified: { cyclonedx: X('update', 'response'), csaf: X('vendor_fix', 'remediation'), openvex: P('action_statement', 'OpenVEX carries the response as free text only') },
  fix_available_not_applied: { cyclonedx: X('update', 'response'), csaf: X('vendor_fix', 'remediation'), openvex: P('action_statement', 'free text only') },
  fix_planned: {
    cyclonedx: X('update', 'response'),
    csaf: N('none_available', 'remediation', 'CSAF none_available covers both "in progress" and "deferred"; it does not distinguish an intention to fix'),
    openvex: P('action_statement', 'free text only'),
  },
  no_fix_available_upstream: { cyclonedx: X('can_not_fix', 'response'), csaf: X('none_available', 'remediation'), openvex: P('action_statement', 'free text only') },
  will_not_fix_by_choice: { cyclonedx: X('will_not_fix', 'response'), csaf: X('no_fix_planned', 'remediation'), openvex: P('action_statement', 'free text only') },
  workaround_applied: { cyclonedx: X('workaround_available', 'response'), csaf: X('workaround', 'remediation'), openvex: P('action_statement', 'free text only') },
  mitigation_applied: {
    // CycloneDX has no `mitigation`: workaround_available means avoiding exposure, which a
    // risk-reducing control does not do. Different claim — prose.
    cyclonedx: P('detail', 'no response for a risk-reducing control; workaround_available asserts exposure is avoided, which a mitigation does not do'),
    csaf: X('mitigation', 'remediation'),
    openvex: P('action_statement', 'free text only'),
  },
  rollback_applied: {
    cyclonedx: X('rollback', 'response'),
    csaf: P('remediation', 'CSAF has no rollback category; vendor_fix would assert a patch was taken rather than a version reverted'),
    openvex: P('action_statement', 'free text only'),
  },
  under_investigation: { cyclonedx: { value: null, fidelity: 'exact', carrier: 'response', note: 'no response is the correct response while triaging' }, csaf: { value: null, fidelity: 'exact', carrier: 'remediation' }, openvex: { value: null, fidelity: 'exact', carrier: 'action_statement' } },
});

// ── the STATUS square ───────────────────────────────────────────────────────────────────────────
// Derived from the WHOLE determination, not one axis. `resolved_with_pedigree` is used when the
// remediation ledger carries strong evidence — operator ruling 2026-08-22 — because that is exactly
// what the value means: a resolution with provenance attached.
export function projectStatus(d, { ledgerTier } = {}) {
  if (d.remediation === 'fixed_verified') {
    const pedigree = ledgerTier === 'strong';
    return {
      cyclonedx: pedigree
        ? { value: 'resolved_with_pedigree', fidelity: 'exact', carrier: 'state', note: 'ledger evidence tier is strong — the resolution carries provenance' }
        : X('resolved', 'state'),
      csaf: X('fixed', 'status'),
      openvex: X('fixed', 'status'),
    };
  }
  if (d.remediation === 'under_investigation') {
    return { cyclonedx: X('in_triage', 'state'), csaf: X('under_investigation', 'status'), openvex: X('under_investigation', 'status') };
  }
  if (notAffectedReason(d)) {
    return { cyclonedx: X('not_affected', 'state'), csaf: X('known_not_affected', 'status'), openvex: X('not_affected', 'status') };
  }
  // Affected. CycloneDX has no plain "affected" — `exploitable` IS the affected state, and the
  // decision not to act rides in analysis.response.
  return {
    cyclonedx: N('exploitable', 'state', 'CycloneDX has no neutral affected state; exploitable is the affected state and the response carries the posture'),
    csaf: X('known_affected', 'status'),
    openvex: X('affected', 'status'),
  };
}

// ── asymmetric enrichment (operator ruling: keep it) ────────────────────────────────────────────
// CSAF alone can characterise the THREAT as distinct from the product's status. KEV membership is
// exactly `exploit_status`, and dropping it for symmetry with the other two would discard a true
// statement the format was built to carry. Absent from CycloneDX/OpenVEX is not a fidelity loss —
// nothing native is going unsaid — so it is reported separately from `lost`.
export function enrichments(d, { kev, epss, epssThreshold = 0.5 } = {}) {
  const out = [];
  if (kev === true) {
    out.push({ format: 'csaf', carrier: 'threat', category: 'exploit_status',
      details: 'Listed in the CISA Known Exploited Vulnerabilities catalogue: exploitation is observed, not predicted.' });
  } else if (typeof epss === 'number' && epss >= epssThreshold) {
    out.push({ format: 'csaf', carrier: 'threat', category: 'exploit_status',
      details: `EPSS ${epss} is at or above the ${epssThreshold} trigger: exploitation is PREDICTED, not observed.` });
  }
  return out;
}

// ── the whole projection, with its fidelity ledger ──────────────────────────────────────────────
export const FORMATS = Object.freeze(['cyclonedx', 'csaf', 'openvex']);

export function project(d, opts = {}) {
  const status = projectStatus(d, opts);
  const reason = notAffectedReason(d);
  const just = reason ? JUSTIFICATION[reason.value] : null;
  const resp = d.remediation ? RESPONSE[d.remediation] : null;

  const per = {};
  for (const f of FORMATS) {
    const cells = [status[f], just?.[f], resp?.[f]].filter(Boolean);
    per[f] = {
      status: status[f],
      justification: just ? just[f] : null,
      response: resp ? resp[f] : null,
      // Generate-and-declare (operator ruling): the document is produced, and what it could not
      // say travels with it. Silence about a downgrade is the only unacceptable outcome.
      lost: cells.filter((c) => c.fidelity === 'prose_only' || c.fidelity === 'unrepresentable')
        .map((c) => ({ carrier: c.carrier, fidelity: c.fidelity, note: c.note })),
      narrowed: cells.filter((c) => c.fidelity === 'narrowed').map((c) => ({ carrier: c.carrier, value: c.value, note: c.note })),
    };
  }
  return { per, enrichments: enrichments(d, opts), reason };
}

/** Roll a set of projections into the per-document fidelity block Phase 5 embeds. */
export function fidelitySummary(projections, format) {
  const tally = { exact: 0, narrowed: 0, prose_only: 0, unrepresentable: 0 };
  const lost = [];
  for (const { vulnId, projection } of projections) {
    const p = projection.per[format];
    for (const cell of [p.status, p.justification, p.response].filter(Boolean)) tally[cell.fidelity]++;
    for (const l of p.lost) lost.push({ vulnId, ...l });
  }
  return { ...tally, lost };
}
