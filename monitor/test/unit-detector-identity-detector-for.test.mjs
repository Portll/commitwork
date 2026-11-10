// Maps a tool name and a finding row to a detector identity (monitor/detector-identity.mjs detectorFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectorFor } from '../detector-identity.mjs';

test('returns null identity and a why message when no extractor is declared for the tool', () => {
  assert.deepEqual(detectorFor('unknown-tool', { DetectorName: 'MongoDB' }), { id: null, address: null, why: "no extractor declared for tool 'unknown-tool'" });
});

test('returns null identity and a why message when the row is not an object', () => {
  assert.deepEqual(detectorFor('trufflehog', 'not-an-object'), { id: null, address: null, why: "row is not an object" });
});

test('extracts the detector name from a trufflehog row', () => {
  assert.deepEqual(detectorFor('trufflehog', { DetectorName: 'MongoDB' }), { id: "MongoDB", address: "trufflehog/MongoDB", why: null });
});

test('extracts the check name from a scorecard row', () => {
  assert.deepEqual(detectorFor('scorecard', { name: 'Branch-Protection' }), { id: "Branch-Protection", address: "scorecard/Branch-Protection", why: null });
});

test('extracts the analytic uid from a prowler row', () => {
  assert.deepEqual(detectorFor('prowler', { finding_info: { analytic: { uid: 'githubactions_workflow_security_scan' } } }), { id: "githubactions_workflow_security_scan", address: "prowler/githubactions_workflow_security_scan", why: null });
});

test('falls back to the event code when the analytic uid is missing in a prowler row', () => {
  assert.deepEqual(detectorFor('prowler', { metadata: { event_code: 'githubactions_workflow_security_scan' } }), { id: "githubactions_workflow_security_scan", address: "prowler/githubactions_workflow_security_scan", why: null });
});

test('extracts the rule id from a semgrep row', () => {
  assert.deepEqual(detectorFor('semgrep', { ruleId: 'javascript.express.security.audit.xss' }), { id: "javascript.express.security.audit.xss", address: "semgrep/javascript.express.security.audit.xss", why: null });
});

test('falls back to the rule field when the rule id is missing in a semgrep row', () => {
  assert.deepEqual(detectorFor('semgrep', { rule: 'javascript.express.security.audit.xss' }), { id: "javascript.express.security.audit.xss", address: "semgrep/javascript.express.security.audit.xss", why: null });
});

test('returns null identity and a why message when the row carries no declared field', () => {
  assert.deepEqual(detectorFor('trufflehog', { DetectorName: '' }), { id: null, address: null, why: "tool 'trufflehog' declared, but this row carries no DetectorName" });
});
