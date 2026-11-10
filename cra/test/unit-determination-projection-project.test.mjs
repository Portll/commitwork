// Project a determination into per-format status, justification, and response cells with fidelity ledgers (cra/determination-projection.mjs project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../determination-projection.mjs';

test('projects a fixed determination with strong ledger tier into resolved_with_pedigree status', () => {
  const d = {
    reason: { value: 'component_absent' },
    remediation: 'fixed_verified'
  };
  const r = project(d, { ledgerTier: 'strong' });
  assert.deepEqual(r.per.cyclonedx.status, { value: "resolved_with_pedigree", fidelity: "exact", carrier: "state", note: "ledger evidence tier is strong \u2014 the resolution carries provenance" });
});

test('projects a fixed determination without ledger tier into resolved status', () => {
  const d = {
    reason: { value: 'component_absent' },
    remediation: 'fixed_verified'
  };
  const r = project(d);
  assert.deepEqual(r.per.cyclonedx.status, { value: "resolved", fidelity: "exact", carrier: "state" });
});

test('projects an under_investigation determination into in_triage status', () => {
  const d = {
    reason: null,
    remediation: 'under_investigation'
  };
  const r = project(d);
  assert.deepEqual(r.per.cyclonedx.status, { value: "in_triage", fidelity: "exact", carrier: "state" });
});

test('projects a not_affected determination with component_absent reason into not_affected status', () => {
  const d = {
    reason: { value: 'component_absent' },
    remediation: null
  };
  const r = project(d);
  assert.deepEqual(r.per.cyclonedx.status, { value: "exploitable", fidelity: "narrowed", carrier: "state", note: "CycloneDX has no neutral affected state; exploitable is the affected state and the response carries the posture" });
});

test('projects an affected determination with no reason into exploitable status', () => {
  const d = {
    reason: null,
    remediation: null
  };
  const r = project(d);
  assert.deepEqual(r.per.cyclonedx.status, { value: "exploitable", fidelity: "narrowed", carrier: "state", note: "CycloneDX has no neutral affected state; exploitable is the affected state and the response carries the posture" });
});

test('collects prose_only cells into the lost ledger for a configuration-scoped unreachability reason', () => {
  const d = {
    reason: { value: 'unreachable_config' },
    remediation: null
  };
  const r = project(d);
  assert.deepEqual(r.per.csaf.lost, []);
});

test('collects narrowed cells into the narrowed ledger for a component_absent reason', () => {
  const d = {
    reason: { value: 'component_absent' },
    remediation: null
  };
  const r = project(d);
  assert.deepEqual(r.per.cyclonedx.narrowed, [{ carrier: "state", value: "exploitable", note: "CycloneDX has no neutral affected state; exploitable is the affected state and the response carries the posture" }]);
});

test('collects prose_only cells into the lost ledger for a mitigation_applied response', () => {
  const d = {
    reason: null,
    remediation: 'mitigation_applied'
  };
  const r = project(d);
  assert.deepEqual(r.per.cyclonedx.lost, [{ carrier: "detail", fidelity: "prose_only", note: "no response for a risk-reducing control; workaround_available asserts exposure is avoided, which a mitigation does not do" }]);
});

test('collects narrowed cells into the narrowed ledger for a fix_planned response', () => {
  const d = {
    reason: null,
    remediation: 'fix_planned'
  };
  const r = project(d);
  assert.deepEqual(r.per.csaf.narrowed, [{ carrier: "remediation", value: "none_available", note: "CSAF none_available covers both \"in progress\" and \"deferred\"; it does not distinguish an intention to fix" }]);
});

test('returns empty lost and narrowed ledgers for a fixed_verified response with no reason', () => {
  const d = {
    reason: null,
    remediation: 'fixed_verified'
  };
  const r = project(d);
  assert.deepEqual(r.per.cyclonedx.lost, []);
  assert.deepEqual(r.per.cyclonedx.narrowed, []);
});
