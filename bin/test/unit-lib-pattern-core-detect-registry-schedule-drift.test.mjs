// Detects targets declared in a registry but missing from evidence, and vice versa (bin/lib/pattern-core.mjs detectRegistryScheduleDrift).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRegistryScheduleDrift } from '../lib/pattern-core.mjs';

test('returns empty observations when declared and withEvidence are identical', () => {
  const r = detectRegistryScheduleDrift({ declared: ['a', 'b'], withEvidence: ['a', 'b'] });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "target", scanned: 4, skipped: [] } });
});

test('flags a declared target absent from evidence with declared scope', () => {
  const r = detectRegistryScheduleDrift({ declared: ['x', 'y'], withEvidence: ['y'] });
  assert.deepEqual(r, { observations: [{ identity: "<registry>::declared:x::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "declared:x", line: null, lineIsAdvisory: true }, evidence: { predicate: "the registry declares this target and no artifact store shows evidence it was ever scheduled \u2014 the difference is invisible to both sides", snippet: "x", redacted: 0, redactor: null }, confidence: "structural" }], undetermined: [], denominator: { unit: "target", scanned: 3, skipped: [] } });
});

test('flags an evidence target absent from declared with undeclared scope', () => {
  const r = detectRegistryScheduleDrift({ declared: ['x'], withEvidence: ['x', 'z'] });
  assert.deepEqual(r, { observations: [{ identity: "<registry>::undeclared:z::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "undeclared:z", line: null, lineIsAdvisory: true }, evidence: { predicate: "an artifact store holds evidence for a target the registry does not declare \u2014 scheduled without a declaration", snippet: "z", redacted: 0, redactor: null }, confidence: "structural" }], undetermined: [], denominator: { unit: "target", scanned: 3, skipped: [] } });
});

test('flags both a missing declared target and an extra evidence target', () => {
  const r = detectRegistryScheduleDrift({ declared: ['a', 'b'], withEvidence: ['b', 'c'] });
  assert.deepEqual(r, { observations: [{ identity: "<registry>::declared:a::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "declared:a", line: null, lineIsAdvisory: true }, evidence: { predicate: "the registry declares this target and no artifact store shows evidence it was ever scheduled \u2014 the difference is invisible to both sides", snippet: "a", redacted: 0, redactor: null }, confidence: "structural" }, { identity: "<registry>::undeclared:c::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "undeclared:c", line: null, lineIsAdvisory: true }, evidence: { predicate: "an artifact store holds evidence for a target the registry does not declare \u2014 scheduled without a declaration", snippet: "c", redacted: 0, redactor: null }, confidence: "structural" }], undetermined: [], denominator: { unit: "target", scanned: 4, skipped: [] } });
});

test('returns empty observations when both inputs are empty', () => {
  const r = detectRegistryScheduleDrift({ declared: [], withEvidence: [] });
  assert.deepEqual(r, { observations: [], undetermined: [], denominator: { unit: "target", scanned: 0, skipped: [] } });
});

test('computes denominator as union size when sets are disjoint', () => {
  const r = detectRegistryScheduleDrift({ declared: ['p', 'q'], withEvidence: ['r', 's'] });
  assert.deepEqual(r, { observations: [{ identity: "<registry>::declared:p::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "declared:p", line: null, lineIsAdvisory: true }, evidence: { predicate: "the registry declares this target and no artifact store shows evidence it was ever scheduled \u2014 the difference is invisible to both sides", snippet: "p", redacted: 0, redactor: null }, confidence: "structural" }, { identity: "<registry>::declared:q::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "declared:q", line: null, lineIsAdvisory: true }, evidence: { predicate: "the registry declares this target and no artifact store shows evidence it was ever scheduled \u2014 the difference is invisible to both sides", snippet: "q", redacted: 0, redactor: null }, confidence: "structural" }, { identity: "<registry>::undeclared:r::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "undeclared:r", line: null, lineIsAdvisory: true }, evidence: { predicate: "an artifact store holds evidence for a target the registry does not declare \u2014 scheduled without a declaration", snippet: "r", redacted: 0, redactor: null }, confidence: "structural" }, { identity: "<registry>::undeclared:s::K8", detector: "registry-schedule-drift@1", classId: "K8", place: { path: "<registry>", scope: "undeclared:s", line: null, lineIsAdvisory: true }, evidence: { predicate: "an artifact store holds evidence for a target the registry does not declare \u2014 scheduled without a declaration", snippet: "s", redacted: 0, redactor: null }, confidence: "structural" }], undetermined: [], denominator: { unit: "target", scanned: 4, skipped: [] } });
});
