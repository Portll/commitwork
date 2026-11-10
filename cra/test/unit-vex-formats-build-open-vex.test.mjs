// Builds an OpenVEX document from commitwork findings (cra/vex-formats.mjs buildOpenVex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenVex } from '../vex-formats.mjs';

test('author includes contact when manufacturer has name and contact', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme', contact: 'ops@acme.io' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'in_triage', reason: '', detail: '' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r.author, "Acme <ops@acme.io>");
});

test('author omits contact when manufacturer has name but no contact', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'in_triage', reason: '', detail: '' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r.author, "Acme");
});

test('action_statement uses reason when state is accepted', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'accepted', reason: 'risk low', detail: '' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r.statements[0].action_statement, "No fix planned. risk low");
});

test('action_statement uses fallback when state is accepted and reason is empty', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'accepted', reason: '', detail: '' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r.statements[0].action_statement, "No fix planned. Accepted by the operator; no reason recorded.");
});

test('action_statement uses detail when state is exploitable', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'exploitable', reason: '', detail: 'patch now' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r.statements[0].action_statement, "Remediate. patch now");
});

test('impact_statement uses reason when state is false_positive', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'false_positive', reason: 'not used', detail: 'x' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r.statements[0].impact_statement, "not used");
});

test('impact_statement uses detail when state is false_positive and reason is empty', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'false_positive', reason: '', detail: 'x' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r.statements[0].impact_statement, "x");
});

test('document has correct context and version', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'in_triage', reason: '', detail: '' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z');
  assert.equal(r['@context'], "https://openvex.dev/ns/v0.2.0");
  assert.equal(r.version, 1);
});

test('fidelity key is present when fidelity is provided', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'in_triage', reason: '', detail: '' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z', { loss: 'none' });
  assert.deepEqual(r['commitwork:fidelity'], { loss: "none" });
});

test('fidelity key is absent when fidelity is null', () => {
  const product = { id: 'p1' };
  const manufacturer = { name: 'Acme' };
  const statements = [{ vulnId: 'CVE-1', lastUpdated: 't1', affects: [{ ref: 'r1' }], state: 'in_triage', reason: '', detail: '' }];
  const r = buildOpenVex(product, manufacturer, statements, '2025-01-01T00:00:00Z', null);
  assert.equal(r['commitwork:fidelity'], undefined);
});
