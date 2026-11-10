// Computes severity, KEV, exploitation, and CWEs from a vulnerability record (bin/wp-advisories.mjs impactOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactOf } from '../wp-advisories.mjs';

test('returns defaults for null input', () => {
  assert.deepEqual(impactOf(null), { score: null, sev: "", kev: false, exploited: false, cwes: [] });
});

test('returns defaults for non-object input', () => {
  assert.deepEqual(impactOf(42), { score: null, sev: "", kev: false, exploited: false, cwes: [] });
});

test('returns defaults for array input', () => {
  assert.deepEqual(impactOf([]), { score: null, sev: "", kev: false, exploited: false, cwes: [] });
});

test('returns defaults for empty object', () => {
  assert.deepEqual(impactOf({}), { score: null, sev: "", kev: false, exploited: false, cwes: [] });
});

test('maps score 9.8 to critical severity', () => {
  assert.deepEqual(impactOf({ cvss: { score: 9.8 } }), { score: 9.8, sev: "crit", kev: false, exploited: false, cwes: [] });
});

test('maps score 9.0 to critical severity', () => {
  assert.deepEqual(impactOf({ cvss: { score: 9.0 } }), { score: 9, sev: "crit", kev: false, exploited: false, cwes: [] });
});

test('maps score 8.9 to high severity', () => {
  assert.deepEqual(impactOf({ cvss: { score: 8.9 } }), { score: 8.9, sev: "high", kev: false, exploited: false, cwes: [] });
});

test('maps score 7.0 to high severity', () => {
  assert.deepEqual(impactOf({ cvss: { score: 7.0 } }), { score: 7, sev: "high", kev: false, exploited: false, cwes: [] });
});

test('maps score 6.9 to medium severity', () => {
  assert.deepEqual(impactOf({ cvss: { score: 6.9 } }), { score: 6.9, sev: "med", kev: false, exploited: false, cwes: [] });
});

test('maps score 4.0 to medium severity', () => {
  assert.deepEqual(impactOf({ cvss: { score: 4.0 } }), { score: 4, sev: "med", kev: false, exploited: false, cwes: [] });
});

test('maps score 3.9 to low severity', () => {
  assert.deepEqual(impactOf({ cvss: { score: 3.9 } }), { score: 3.9, sev: "low", kev: false, exploited: false, cwes: [] });
});

test('sets kev and exploited from ssvc fields', () => {
  assert.deepEqual(impactOf({ ssvc: { kev: true, exploitation: 'active' } }), { score: null, sev: "", kev: true, exploited: true, cwes: [] });
});

test('sets exploited from active exploitation without kev', () => {
  assert.deepEqual(impactOf({ ssvc: { exploitation: 'active' } }), { score: null, sev: "", kev: false, exploited: true, cwes: [] });
});

test('filters valid CWE identifiers from cwe array', () => {
  assert.deepEqual(impactOf({ cwe: [{ cwe: 'CWE-79' }, { cwe: 'invalid' }, null, { cwe: 'CWE-89' }] }), { score: null, sev: "", kev: false, exploited: false, cwes: ["CWE-79", "CWE-89"] });
});

test('prefers cvss4 over cvss3 when both present', () => {
  assert.deepEqual(impactOf({ cvss4: { score: 9.5 }, cvss3: { score: 5.0 } }), { score: 9.5, sev: "crit", kev: false, exploited: false, cwes: [] });
});

test('ignores zero score and falls through to next key', () => {
  assert.deepEqual(impactOf({ cvss4: { score: 0 }, cvss3: { score: 8.0 } }), { score: 8, sev: "high", kev: false, exploited: false, cwes: [] });
});

test('handles non-object ssvc value', () => {
  assert.deepEqual(impactOf({ ssvc: 'not-an-object' }), { score: null, sev: "", kev: false, exploited: false, cwes: [] });
});

test('handles string ssvc value', () => {
  assert.deepEqual(impactOf({ ssvc: 'string' }), { score: null, sev: "", kev: false, exploited: false, cwes: [] });
});
