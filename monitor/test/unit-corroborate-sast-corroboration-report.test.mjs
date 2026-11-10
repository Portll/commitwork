// SAST cross-tool corroboration summary (monitor/corroborate.mjs sastCorroborationReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sastCorroborationReport } from '../corroborate.mjs';

test('returns zeroed report when findingsByCategory is null', () => {
  assert.deepEqual(sastCorroborationReport(null), { enabled: true, total: 0, corroborated: 0, withCweMatch: 0, sameBasisOnly: 0, soleWitness: 0, note: "" });
});

test('returns zeroed report when findingsByCategory is undefined', () => {
  assert.deepEqual(sastCorroborationReport(undefined), { enabled: true, total: 0, corroborated: 0, withCweMatch: 0, sameBasisOnly: 0, soleWitness: 0, note: "" });
});

test('returns zeroed report when all SAST keys are absent', () => {
  assert.deepEqual(sastCorroborationReport({}), { enabled: true, total: 0, corroborated: 0, withCweMatch: 0, sameBasisOnly: 0, soleWitness: 0, note: "" });
});

test('counts corroborated rows with cwe and same-basis twins', () => {
  const fbc = {
    sastSemgrep: [
      { rule: 'a', file: 'x.js', corroboratedBy: 'sastCodeql:js/xss [cwe], sastGo:G101 [cwe]' },
      { rule: 'b', file: 'y.js', corroboratedBy: 'sastCodeql:js/xss [same-basis]' },
      { rule: 'c', file: 'z.js', corroboratedBy: '' },
    ],
    sastCodeql: [
      { rule: 'd', file: 'w.js', corroboratedBy: 'sastSemgrep:a [same-basis], sastGo:G101 [same-basis]' },
    ],
  };
  assert.deepEqual(sastCorroborationReport(fbc), { enabled: true, total: 4, corroborated: 3, withCweMatch: 1, sameBasisOnly: 2, soleWitness: 1, note: "3 of 4 SAST findings are flagged by more than one tool at the same file (1 of those additionally agree on a CWE). They remain SEPARATE rows on purpose, same as the SCA corroboration above \u2014 this is a view, never a merge. Set CW_CORROBORATE=off to disable." });
});

test('counts rows where corroboratedBy is a non-empty string without cwe', () => {
  const fbc = {
    sastGo: [
      { rule: 'g1', file: 'a.go', corroboratedBy: 'sastSemgrep:rule1' },
      { rule: 'g2', file: 'b.go', corroboratedBy: '' },
    ],
  };
  assert.deepEqual(sastCorroborationReport(fbc), { enabled: true, total: 2, corroborated: 1, withCweMatch: 0, sameBasisOnly: 0, soleWitness: 1, note: "1 of 2 SAST findings are flagged by more than one tool at the same file (0 of those additionally agree on a CWE). They remain SEPARATE rows on purpose, same as the SCA corroboration above \u2014 this is a view, never a merge. Set CW_CORROBORATE=off to disable." });
});

test('handles rows with null and empty-string corroboratedBy values', () => {
  const fbc = {
    sastCodeqlJava: [
      { rule: 'j1', file: 'a.java', corroboratedBy: null },
      { rule: 'j2', file: 'b.java', corroboratedBy: '' },
      { rule: 'j3', file: 'c.java', corroboratedBy: 'sastSemgrep:r [same-basis]' },
    ],
  };
  assert.deepEqual(sastCorroborationReport(fbc), { enabled: true, total: 3, corroborated: 1, withCweMatch: 0, sameBasisOnly: 1, soleWitness: 2, note: "1 of 3 SAST findings are flagged by more than one tool at the same file (0 of those additionally agree on a CWE). They remain SEPARATE rows on purpose, same as the SCA corroboration above \u2014 this is a view, never a merge. Set CW_CORROBORATE=off to disable." });
});

test('computes soleWitness as total minus corroborated', () => {
  const fbc = {
    sastJoern: [
      { rule: 'q1', file: 'a.q', corroboratedBy: 'sastBearer:b [cwe]' },
      { rule: 'q2', file: 'b.q', corroboratedBy: '' },
      { rule: 'q3', file: 'c.q', corroboratedBy: '' },
    ],
  };
  assert.deepEqual(sastCorroborationReport(fbc), { enabled: true, total: 3, corroborated: 1, withCweMatch: 1, sameBasisOnly: 0, soleWitness: 2, note: "1 of 3 SAST findings are flagged by more than one tool at the same file (1 of those additionally agree on a CWE). They remain SEPARATE rows on purpose, same as the SCA corroboration above \u2014 this is a view, never a merge. Set CW_CORROBORATE=off to disable." });
});

test('aggregates across multiple SAST tool keys', () => {
  const fbc = {
    sastSemgrep: [
      { rule: 's1', file: 'a.js', corroboratedBy: 'sastCodeql:js/x [cwe]' },
      { rule: 's2', file: 'b.js', corroboratedBy: '' },
    ],
    sastCodeql: [
      { rule: 'c1', file: 'a.js', corroboratedBy: 'sastSemgrep:s1 [cwe]' },
      { rule: 'c2', file: 'd.js', corroboratedBy: 'sastGo:G1 [same-basis]' },
    ],
    sastGo: [
      { rule: 'g1', file: 'd.js', corroboratedBy: 'sastCodeql:c2 [same-basis]' },
    ],
  };
  assert.deepEqual(sastCorroborationReport(fbc), { enabled: true, total: 5, corroborated: 4, withCweMatch: 2, sameBasisOnly: 2, soleWitness: 1, note: "4 of 5 SAST findings are flagged by more than one tool at the same file (2 of those additionally agree on a CWE). They remain SEPARATE rows on purpose, same as the SCA corroboration above \u2014 this is a view, never a merge. Set CW_CORROBORATE=off to disable." });
});
