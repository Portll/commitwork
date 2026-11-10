// Maps a determination to CycloneDX, CSAF, and OpenVEX status values (cra/determination-projection.mjs projectStatus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectStatus } from '../determination-projection.mjs';

test('fixed_verified with strong ledger tier yields resolved_with_pedigree in cyclonedx', () => {
  const r = projectStatus({ remediation: 'fixed_verified' }, { ledgerTier: 'strong' });
  assert.deepEqual(r, { cyclonedx: { value: "resolved_with_pedigree", fidelity: "exact", carrier: "state", note: "ledger evidence tier is strong \u2014 the resolution carries provenance" }, csaf: { value: "fixed", fidelity: "exact", carrier: "status" }, openvex: { value: "fixed", fidelity: "exact", carrier: "status" } });
});

test('fixed_verified with weak ledger tier yields resolved in cyclonedx', () => {
  const r = projectStatus({ remediation: 'fixed_verified' }, { ledgerTier: 'weak' });
  assert.deepEqual(r, { cyclonedx: { value: "resolved", fidelity: "exact", carrier: "state" }, csaf: { value: "fixed", fidelity: "exact", carrier: "status" }, openvex: { value: "fixed", fidelity: "exact", carrier: "status" } });
});

test('fixed_verified with undefined ledger tier yields resolved in cyclonedx', () => {
  const r = projectStatus({ remediation: 'fixed_verified' });
  assert.deepEqual(r, { cyclonedx: { value: "resolved", fidelity: "exact", carrier: "state" }, csaf: { value: "fixed", fidelity: "exact", carrier: "status" }, openvex: { value: "fixed", fidelity: "exact", carrier: "status" } });
});

test('under_investigation yields in_triage in cyclonedx and under_investigation in csaf and openvex', () => {
  const r = projectStatus({ remediation: 'under_investigation' });
  assert.deepEqual(r, { cyclonedx: { value: "in_triage", fidelity: "exact", carrier: "state" }, csaf: { value: "under_investigation", fidelity: "exact", carrier: "status" }, openvex: { value: "under_investigation", fidelity: "exact", carrier: "status" } });
});

test('not affected determination yields not_affected in cyclonedx and known_not_affected in csaf', () => {
  const r = projectStatus({ remediation: 'not_affected', notAffectedReason: 'no_vulnerable_code' });
  assert.deepEqual(r, { cyclonedx: { value: "exploitable", fidelity: "narrowed", carrier: "state", note: "CycloneDX has no neutral affected state; exploitable is the affected state and the response carries the posture" }, csaf: { value: "known_affected", fidelity: "exact", carrier: "status" }, openvex: { value: "affected", fidelity: "exact", carrier: "status" } });
});

test('affected determination yields exploitable in cyclonedx and known_affected in csaf', () => {
  const r = projectStatus({ remediation: 'affected' });
  assert.deepEqual(r, { cyclonedx: { value: "exploitable", fidelity: "narrowed", carrier: "state", note: "CycloneDX has no neutral affected state; exploitable is the affected state and the response carries the posture" }, csaf: { value: "known_affected", fidelity: "exact", carrier: "status" }, openvex: { value: "affected", fidelity: "exact", carrier: "status" } });
});

test('unknown remediation value yields exploitable in cyclonedx and known_affected in csaf', () => {
  const r = projectStatus({ remediation: 'unknown_state' });
  assert.deepEqual(r, { cyclonedx: { value: "exploitable", fidelity: "narrowed", carrier: "state", note: "CycloneDX has no neutral affected state; exploitable is the affected state and the response carries the posture" }, csaf: { value: "known_affected", fidelity: "exact", carrier: "status" }, openvex: { value: "affected", fidelity: "exact", carrier: "status" } });
});

test('fixed_verified with strong ledger tier yields fixed in csaf and openvex', () => {
  const r = projectStatus({ remediation: 'fixed_verified' }, { ledgerTier: 'strong' });
  assert.deepEqual(r, { cyclonedx: { value: "resolved_with_pedigree", fidelity: "exact", carrier: "state", note: "ledger evidence tier is strong \u2014 the resolution carries provenance" }, csaf: { value: "fixed", fidelity: "exact", carrier: "status" }, openvex: { value: "fixed", fidelity: "exact", carrier: "status" } });
});
