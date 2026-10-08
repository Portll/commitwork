// cra/test/vex-units.test.mjs — case tests for fidelityFor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fidelityFor } from '../vex.mjs';

test('fidelityFor: empty statements returns zero counts and lossless true', () => {
  const result = fidelityFor([]);
  assert.equal(result.cyclonedx.statements, 0);
  assert.equal(result.cyclonedx.lossless, true);
  assert.equal(result.csaf.statements, 0);
  assert.equal(result.openvex.statements, 0);
});

test('fidelityFor: false_positive statement is excluded from projections', () => {
  const statements = [{ vulnId: 'CVE-2024-0001', state: 'false_positive' }];
  const result = fidelityFor(statements);
  assert.equal(result.cyclonedx.statements, 0);
  assert.equal(result.cyclonedx.lossless, true);
});

test('fidelityFor: resolved statement is included in projections', () => {
  const statements = [{ vulnId: 'CVE-2024-0002', state: 'resolved' }];
  const result = fidelityFor(statements);
  assert.equal(result.cyclonedx.statements, 1);
  assert.equal(result.csaf.statements, 1);
  assert.equal(result.openvex.statements, 1);
});

test('fidelityFor: accepted statement is included in projections', () => {
  const statements = [{ vulnId: 'CVE-2024-0003', state: 'accepted' }];
  const result = fidelityFor(statements);
  assert.equal(result.cyclonedx.statements, 1);
  assert.equal(result.csaf.statements, 1);
  assert.equal(result.openvex.statements, 1);
});

test('fidelityFor: in_triage statement is included in projections', () => {
  const statements = [{ vulnId: 'CVE-2024-0004', state: 'in_triage' }];
  const result = fidelityFor(statements);
  assert.equal(result.cyclonedx.statements, 1);
  assert.equal(result.csaf.statements, 1);
  assert.equal(result.openvex.statements, 1);
});

test('fidelityFor: exploitable statement is included in projections', () => {
  const statements = [{ vulnId: 'CVE-2024-0005', state: 'exploitable' }];
  const result = fidelityFor(statements);
  assert.equal(result.cyclonedx.statements, 1);
  assert.equal(result.csaf.statements, 1);
  assert.equal(result.openvex.statements, 1);
});

test('fidelityFor: mixed statements count only non-false_positive', () => {
  const statements = [
    { vulnId: 'CVE-2024-0001', state: 'false_positive' },
    { vulnId: 'CVE-2024-0002', state: 'resolved' },
    { vulnId: 'CVE-2024-0003', state: 'accepted' },
  ];
  const result = fidelityFor(statements);
  assert.equal(result.cyclonedx.statements, 2);
  assert.equal(result.csaf.statements, 2);
  assert.equal(result.openvex.statements, 2);
});
