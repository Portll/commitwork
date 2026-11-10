// evaluates security execution boundary and reports violations, unknowns and control outcomes (lib/security-execution-boundary.mjs evaluateBoundary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBoundary } from '../security-execution-boundary.mjs';
import { createHash } from 'node:crypto';

test('input is not an object (null) produces unknowns for input', () => {
  const input = null;
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: null, state: "unmeasured", reason: "evidence-incomplete", declarationRejected: false, declared: { executesRepoCode: null, network: null, readRoots: null, writeRoots: null, credentialsMounted: null }, measured: { ran: null, egressDenied: null, writeEscapeDenied: null, credentialReadDenied: null }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "unknown" }, { control: "egress", field: "measured.egressDenied", required: null, outcome: "unknown" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "unknown" }], violations: [], unknowns: [{ field: "command", reason: "missing" }, { field: "declared", reason: "missing" }, { field: "input", reason: "missing" }, { field: "measured", reason: "missing" }] });
});

test('input missing command field adds unknown for command and passes through declared defaults', () => {
  const input = { declared: { executesRepoCode: true, network: 'none', readRoots: [], writeRoots: [], credentialsMounted: [] } };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: null, state: "unmeasured", reason: "evidence-incomplete", declarationRejected: false, declared: { executesRepoCode: true, network: "none", readRoots: [], writeRoots: [], credentialsMounted: [] }, measured: { ran: null, egressDenied: null, writeEscapeDenied: null, credentialReadDenied: null }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "unknown" }, { control: "egress", field: "measured.egressDenied", required: true, outcome: "unknown" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "unknown" }], violations: [], unknowns: [{ field: "command", reason: "missing" }, { field: "measured", reason: "missing" }] });
});

test('command as empty string is malformed and results in unknowns for command', () => {
  const input = { command: '', declared: {}, measured: {} };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: null, state: "unmeasured", reason: "evidence-incomplete", declarationRejected: false, declared: { executesRepoCode: null, network: null, readRoots: null, writeRoots: null, credentialsMounted: null }, measured: { ran: null, egressDenied: null, writeEscapeDenied: null, credentialReadDenied: null }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "unknown" }, { control: "egress", field: "measured.egressDenied", required: null, outcome: "unknown" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "unknown" }], violations: [], unknowns: [{ field: "command", reason: "malformed" }, { field: "declared.credentialsMounted", reason: "missing" }, { field: "declared.executesRepoCode", reason: "missing" }, { field: "declared.network", reason: "missing" }, { field: "declared.readRoots", reason: "missing" }, { field: "declared.writeRoots", reason: "missing" }, { field: "measured.credentialReadDenied", reason: "missing" }, { field: "measured.egressDenied", reason: "missing" }, { field: "measured.ran", reason: "missing" }, { field: "measured.writeEscapeDenied", reason: "missing" }] });
});

test('command as array with scanner label sets label and correct digest', () => {
  const cmd = ['trivy', '--quiet'];
  const input = { command: cmd, declared: {}, measured: {} };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: "trivy", digest: "sha256:624c03efe4bc0531287d6739ca131d282e5eeba5e0d243dfc56e0eebec5e7ad4" }, state: "unmeasured", reason: "evidence-incomplete", declarationRejected: false, declared: { executesRepoCode: null, network: null, readRoots: null, writeRoots: null, credentialsMounted: null }, measured: { ran: null, egressDenied: null, writeEscapeDenied: null, credentialReadDenied: null }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "unknown" }, { control: "egress", field: "measured.egressDenied", required: null, outcome: "unknown" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "unknown" }], violations: [], unknowns: [{ field: "declared.credentialsMounted", reason: "missing" }, { field: "declared.executesRepoCode", reason: "missing" }, { field: "declared.network", reason: "missing" }, { field: "declared.readRoots", reason: "missing" }, { field: "declared.writeRoots", reason: "missing" }, { field: "measured.credentialReadDenied", reason: "missing" }, { field: "measured.egressDenied", reason: "missing" }, { field: "measured.ran", reason: "missing" }, { field: "measured.writeEscapeDenied", reason: "missing" }] });
});

test('declared.network open with executesRepoCode true adds a forbidden repo-code violation', () => {
  const input = {
    command: 'echo ok',
    declared: { executesRepoCode: true, network: 'open', readRoots: [], writeRoots: [], credentialsMounted: [] },
    measured: { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: true }
  };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: null, digest: "sha256:7d10fced96b38c84f90db07708f266e83da48ca763189eaed7fe1a00348385eb" }, state: "finding", reason: "violations-found", declarationRejected: false, declared: { executesRepoCode: true, network: "open", readRoots: [], writeRoots: [], credentialsMounted: [] }, measured: { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: true }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "denied" }, { control: "egress", field: "measured.egressDenied", required: false, outcome: "denied" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "denied" }], violations: [{ kind: "repo-code-with-open-egress", source: "declared", field: "declared.network" }], unknowns: [] });
});

test('credentialsMounted true adds unspecified-credentials violation and sets credentialsMounted to true', () => {
  const input = {
    command: 'ls',
    declared: { executesRepoCode: false, network: 'none', readRoots: [], writeRoots: [], credentialsMounted: true },
    measured: { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: true }
  };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: null, digest: "sha256:c7b68ac37f364473e922936708e7f43c293dd07b295171566c07ff5fe024fab9" }, state: "finding", reason: "violations-found", declarationRejected: true, declared: { executesRepoCode: false, network: "none", readRoots: [], writeRoots: [], credentialsMounted: true }, measured: { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: true }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "denied" }, { control: "egress", field: "measured.egressDenied", required: true, outcome: "denied" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "denied" }], violations: [{ kind: "forbidden-credential-mount", source: "declared", field: "declared.credentialsMounted", reason: "unspecified-credentials" }], unknowns: [] });
});

test('measured missing required egressDenied when egress is required adds unknown for control.egress', () => {
  const input = {
    command: 'true',
    declared: { executesRepoCode: false, network: 'restricted', readRoots: [], writeRoots: [], credentialsMounted: [] },
    measured: { ran: true, writeEscapeDenied: true, credentialReadDenied: true }
  };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: null, digest: "sha256:b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b" }, state: "unmeasured", reason: "evidence-incomplete", declarationRejected: false, declared: { executesRepoCode: false, network: "restricted", readRoots: [], writeRoots: [], credentialsMounted: [] }, measured: { ran: true, egressDenied: null, writeEscapeDenied: true, credentialReadDenied: true }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "denied" }, { control: "egress", field: "measured.egressDenied", required: true, outcome: "unknown" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "denied" }], violations: [], unknowns: [{ field: "measured.egressDenied", reason: "missing" }] });
});

test('measured false for egressDenied when egress is required creates a violation', () => {
  const input = {
    command: 'true',
    declared: { executesRepoCode: false, network: 'restricted', readRoots: [], writeRoots: [], credentialsMounted: [] },
    measured: { ran: true, egressDenied: false, writeEscapeDenied: true, credentialReadDenied: true }
  };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: null, digest: "sha256:b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b" }, state: "finding", reason: "violations-found", declarationRejected: false, declared: { executesRepoCode: false, network: "restricted", readRoots: [], writeRoots: [], credentialsMounted: [] }, measured: { ran: true, egressDenied: false, writeEscapeDenied: true, credentialReadDenied: true }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "denied" }, { control: "egress", field: "measured.egressDenied", required: true, outcome: "not-denied" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "denied" }], violations: [{ kind: "egress-not-denied", source: "measured", field: "measured.egressDenied" }], unknowns: [] });
});

test('measured false for writeEscapeDenied creates a violation', () => {
  const input = {
    command: 'true',
    declared: { executesRepoCode: false, network: 'none', readRoots: [], writeRoots: [], credentialsMounted: [] },
    measured: { ran: true, egressDenied: true, writeEscapeDenied: false, credentialReadDenied: true }
  };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: null, digest: "sha256:b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b" }, state: "finding", reason: "violations-found", declarationRejected: false, declared: { executesRepoCode: false, network: "none", readRoots: [], writeRoots: [], credentialsMounted: [] }, measured: { ran: true, egressDenied: true, writeEscapeDenied: false, credentialReadDenied: true }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "denied" }, { control: "egress", field: "measured.egressDenied", required: true, outcome: "denied" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "not-denied" }], violations: [{ kind: "write-escape", source: "measured", field: "measured.writeEscapeDenied" }], unknowns: [] });
});

test('measured false for credentialReadDenied creates a violation', () => {
  const input = {
    command: 'true',
    declared: { executesRepoCode: false, network: 'none', readRoots: [], writeRoots: [], credentialsMounted: [] },
    measured: { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: false }
  };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: null, digest: "sha256:b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b" }, state: "finding", reason: "violations-found", declarationRejected: false, declared: { executesRepoCode: false, network: "none", readRoots: [], writeRoots: [], credentialsMounted: [] }, measured: { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: false }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "not-denied" }, { control: "egress", field: "measured.egressDenied", required: true, outcome: "denied" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "denied" }], violations: [{ kind: "credential-read", source: "measured", field: "measured.credentialReadDenied" }], unknowns: [] });
});

test('missing measured.ran adds unknowns for measured.ran and required controls become unknown', () => {
  const input = {
    command: 'true',
    declared: { executesRepoCode: false, network: 'none', readRoots: [], writeRoots: [], credentialsMounted: [] },
    measured: { egressDenied: true, writeEscapeDenied: true, credentialReadDenied: true }
  };
  const result = evaluateBoundary(input);
  assert.deepEqual(result, { schemaVersion: 1, command: { label: null, digest: "sha256:b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b" }, state: "unmeasured", reason: "evidence-incomplete", declarationRejected: false, declared: { executesRepoCode: false, network: "none", readRoots: [], writeRoots: [], credentialsMounted: [] }, measured: { ran: null, egressDenied: null, writeEscapeDenied: null, credentialReadDenied: null }, controls: [{ control: "credential-read", field: "measured.credentialReadDenied", required: true, outcome: "unknown" }, { control: "egress", field: "measured.egressDenied", required: true, outcome: "unknown" }, { control: "write-escape", field: "measured.writeEscapeDenied", required: true, outcome: "unknown" }], violations: [], unknowns: [{ field: "measured.credentialReadDenied", reason: "run-unevidenced", claimed: true }, { field: "measured.egressDenied", reason: "run-unevidenced", claimed: true }, { field: "measured.ran", reason: "missing" }, { field: "measured.writeEscapeDenied", reason: "run-unevidenced", claimed: true }] });
});
