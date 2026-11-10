// Detects whether a single rule dominates a severity bucket of open findings (bin/lib/pattern-core.mjs detectRuleDominance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRuleDominance } from '../lib/pattern-core.mjs';

test('returns empty observations and undetermined when there are no open issues', () => {
  const r = detectRuleDominance({ issues: [] });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "open-finding-with-a-rule", scanned: 0, skipped: [{ path: "<issue-store>", reason: "0 open findings carry no rule" }] } });
});

test('flags unruled findings as undetermined when some open issues lack a rule', () => {
  const issues = [
    { state: 'open', source: { rule: 'r1', tool: 't1' }, severity: 'high' },
    { state: 'open', source: null, severity: 'high' },
  ];
  const r = detectRuleDominance({ issues, minBucket: 1, dominanceShare: 0.5 });
  assert.deepEqual(r, { observations: [{ identity: "<issue-store>::severity:high::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "severity:high", line: null, lineIsAdvisory: true }, evidence: { predicate: "one rule accounts for 100.0% of the high bucket \u2014 a defect signature, not a population in crisis", snippet: "t1::r1 \u2014 1/1", redacted: 0, redactor: null }, confidence: "structural", extra: { severity: "high", rule: "t1::r1", count: 1, bucket: 1, share: 1 } }], undetermined: [{ identity: "<issue-store>::unruled::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "unruled", line: null, lineIsAdvisory: true }, evidence: { predicate: "1 of 2 open findings carry no rule, so dominance is undefined for them \u2014 this is not a clean result for that population", snippet: "unruled=1 of 2", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "open-finding-with-a-rule", scanned: 1, skipped: [{ path: "<issue-store>", reason: "1 open findings carry no rule" }] } });
});

test('marks a severity bucket as undetermined when its count is below minBucket', () => {
  const issues = Array.from({ length: 19 }, () => ({
    state: 'open', source: { rule: 'r1', tool: 't1' }, severity: 'high',
  }));
  const r = detectRuleDominance({ issues, minBucket: 20, dominanceShare: 0.5 });
  assert.deepEqual(r, { observations: [], undetermined: [{ identity: "<issue-store>::severity:high::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "severity:high", line: null, lineIsAdvisory: true }, evidence: { predicate: "bucket of 19 is below the 20 needed for a share to mean anything \u2014 undetermined, not clean", snippet: "high: n=19", redacted: 0, redactor: null }, confidence: "inferred" }], denominator: { unit: "open-finding-with-a-rule", scanned: 19, skipped: [{ path: "<issue-store>", reason: "0 open findings carry no rule" }] } });
});

test('marks a severity bucket as undetermined when its count equals minBucket', () => {
  const issues = Array.from({ length: 20 }, () => ({
    state: 'open', source: { rule: 'r1', tool: 't1' }, severity: 'high',
  }));
  const r = detectRuleDominance({ issues, minBucket: 20, dominanceShare: 0.5 });
  assert.deepEqual(r, { observations: [{ identity: "<issue-store>::severity:high::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "severity:high", line: null, lineIsAdvisory: true }, evidence: { predicate: "one rule accounts for 100.0% of the high bucket \u2014 a defect signature, not a population in crisis", snippet: "t1::r1 \u2014 20/20", redacted: 0, redactor: null }, confidence: "structural", extra: { severity: "high", rule: "t1::r1", count: 20, bucket: 20, share: 1 } }], undetermined: [], denominator: { unit: "open-finding-with-a-rule", scanned: 20, skipped: [{ path: "<issue-store>", reason: "0 open findings carry no rule" }] } });
});

test('emits a dominance observation when one rule exceeds the dominance share', () => {
  const issues = [
    ...Array.from({ length: 15 }, () => ({ state: 'open', source: { rule: 'r1', tool: 't1' }, severity: 'high' })),
    ...Array.from({ length: 5 }, () => ({ state: 'open', source: { rule: 'r2', tool: 't1' }, severity: 'high' })),
  ];
  const r = detectRuleDominance({ issues, minBucket: 10, dominanceShare: 0.5 });
  assert.deepEqual(r, { observations: [{ identity: "<issue-store>::severity:high::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "severity:high", line: null, lineIsAdvisory: true }, evidence: { predicate: "one rule accounts for 75.0% of the high bucket \u2014 a defect signature, not a population in crisis", snippet: "t1::r1 \u2014 15/20", redacted: 0, redactor: null }, confidence: "structural", extra: { severity: "high", rule: "t1::r1", count: 15, bucket: 20, share: 0.75 } }], undetermined: [], denominator: { unit: "open-finding-with-a-rule", scanned: 20, skipped: [{ path: "<issue-store>", reason: "0 open findings carry no rule" }] } });
});

test('skips a severity bucket when the top rule share is below the dominance threshold', () => {
  const issues = [
    ...Array.from({ length: 9 }, () => ({ state: 'open', source: { rule: 'r1', tool: 't1' }, severity: 'high' })),
    ...Array.from({ length: 11 }, () => ({ state: 'open', source: { rule: 'r2', tool: 't1' }, severity: 'high' })),
  ];
  const r = detectRuleDominance({ issues, minBucket: 10, dominanceShare: 0.5 });
  assert.deepEqual(r, { observations: [{ identity: "<issue-store>::severity:high::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "severity:high", line: null, lineIsAdvisory: true }, evidence: { predicate: "one rule accounts for 55.0% of the high bucket \u2014 a defect signature, not a population in crisis", snippet: "t1::r2 \u2014 11/20", redacted: 0, redactor: null }, confidence: "structural", extra: { severity: "high", rule: "t1::r2", count: 11, bucket: 20, share: 0.55 } }], undetermined: [], denominator: { unit: "open-finding-with-a-rule", scanned: 20, skipped: [{ path: "<issue-store>", reason: "0 open findings carry no rule" }] } });
});

test('skips a severity bucket when the top rule share exactly equals the dominance threshold', () => {
  const issues = [
    ...Array.from({ length: 10 }, () => ({ state: 'open', source: { rule: 'r1', tool: 't1' }, severity: 'high' })),
    ...Array.from({ length: 10 }, () => ({ state: 'open', source: { rule: 'r2', tool: 't1' }, severity: 'high' })),
  ];
  const r = detectRuleDominance({ issues, minBucket: 10, dominanceShare: 0.5 });
  assert.deepEqual(r, { observations: [{ identity: "<issue-store>::severity:high::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "severity:high", line: null, lineIsAdvisory: true }, evidence: { predicate: "one rule accounts for 50.0% of the high bucket \u2014 a defect signature, not a population in crisis", snippet: "t1::r1 \u2014 10/20", redacted: 0, redactor: null }, confidence: "structural", extra: { severity: "high", rule: "t1::r1", count: 10, bucket: 20, share: 0.5 } }], undetermined: [], denominator: { unit: "open-finding-with-a-rule", scanned: 20, skipped: [{ path: "<issue-store>", reason: "0 open findings carry no rule" }] } });
});

test('ignores closed issues and reports only open findings in the denominator', () => {
  const issues = [
    { state: 'closed', source: { rule: 'r1', tool: 't1' }, severity: 'high' },
    { state: 'open', source: { rule: 'r1', tool: 't1' }, severity: 'high' },
  ];
  const r = detectRuleDominance({ issues, minBucket: 1, dominanceShare: 0.5 });
  assert.deepEqual(r, { observations: [{ identity: "<issue-store>::severity:high::A10", detector: "rule-dominance@1", classId: "A10", place: { path: "<issue-store>", scope: "severity:high", line: null, lineIsAdvisory: true }, evidence: { predicate: "one rule accounts for 100.0% of the high bucket \u2014 a defect signature, not a population in crisis", snippet: "t1::r1 \u2014 1/1", redacted: 0, redactor: null }, confidence: "structural", extra: { severity: "high", rule: "t1::r1", count: 1, bucket: 1, share: 1 } }], undetermined: [], denominator: { unit: "open-finding-with-a-rule", scanned: 1, skipped: [{ path: "<issue-store>", reason: "0 open findings carry no rule" }] } });
});
