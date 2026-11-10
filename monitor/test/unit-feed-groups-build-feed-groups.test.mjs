// Groups scanner findings into ranked feed groups with state and severity aggregates (monitor/feed-groups.mjs buildFeedGroups).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedGroups } from '../feed-groups.mjs';

test('throws when scannerFindings is an array', () => {
  assert.throws(() => buildFeedGroups([]), { name: 'Error', message: 'buildFeedGroups: scannerFindings must be an object keyed by lane' });
});

test('returns empty groups and zero totals for empty input', () => {
  const r = buildFeedGroups({});
  assert.deepEqual(r, { groups: [], totals: { rows: 0, groups: 0, focus: 0, suppressed: 0, undetermined: 0, graded: 0, kev: 0, counts: { crit: 0, high: 0, med: 0, low: 0, unknown: 0 }, states: {} }, undeclaredLanes: [] });
});

test('counts one open row with high severity and no issue', () => {
  const r = buildFeedGroups({ lane1: [{ repo: 'r1', rule: 'R1', sev: 'high' }] });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000R1", repo: "r1", lane: "lane1", subject: "R1", subjectFields: ["rule"], identityDeclared: false, worst: "high", rank: 3, kev: false, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { open: 1 }, distinct: 1, inFocus: true }], totals: { rows: 1, groups: 1, focus: 1, suppressed: 0, undetermined: 0, graded: 1, kev: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { open: 1 } }, undeclaredLanes: ["lane1"] });
});

test('counts one suppressed row with medium severity', () => {
  const r = buildFeedGroups({ lane1: [{ repo: 'r1', rule: 'R1', sev: 'medium', annotation: { action: 'accept' } }] });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000R1", repo: "r1", lane: "lane1", subject: "R1", subjectFields: ["rule"], identityDeclared: false, worst: "med", rank: 2, kev: false, members: 1, suppressed: 1, undetermined: 0, counts: { crit: 0, high: 0, med: 1, low: 0, unknown: 0 }, states: { suppressed: 1 }, distinct: 1, inFocus: false }], totals: { rows: 1, groups: 1, focus: 0, suppressed: 1, undetermined: 0, graded: 1, kev: 0, counts: { crit: 0, high: 0, med: 1, low: 0, unknown: 0 }, states: { suppressed: 1 } }, undeclaredLanes: ["lane1"] });
});

test('marks group as inFocus when worst is high and state is open', () => {
  const r = buildFeedGroups({ lane1: [{ repo: 'r1', rule: 'R1', sev: 'high' }] });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000R1", repo: "r1", lane: "lane1", subject: "R1", subjectFields: ["rule"], identityDeclared: false, worst: "high", rank: 3, kev: false, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { open: 1 }, distinct: 1, inFocus: true }], totals: { rows: 1, groups: 1, focus: 1, suppressed: 0, undetermined: 0, graded: 1, kev: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { open: 1 } }, undeclaredLanes: ["lane1"] });
});

test('marks group as not inFocus when worst is unknown', () => {
  const r = buildFeedGroups({ lane1: [{ repo: 'r1', rule: 'R1', sev: 'bogus' }] });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000R1", repo: "r1", lane: "lane1", subject: "R1", subjectFields: ["rule"], identityDeclared: false, worst: "unknown", rank: 1.5, kev: false, members: 1, suppressed: 0, undetermined: 1, counts: { crit: 0, high: 0, med: 0, low: 0, unknown: 1 }, states: { open: 1 }, distinct: 1, inFocus: false }], totals: { rows: 1, groups: 1, focus: 0, suppressed: 0, undetermined: 1, graded: 0, kev: 0, counts: { crit: 0, high: 0, med: 0, low: 0, unknown: 1 }, states: { open: 1 } }, undeclaredLanes: ["lane1"] });
});

test('tracks kev flag and display rank for critical row', () => {
  const r = buildFeedGroups({ lane1: [{ repo: 'r1', rule: 'R1', sev: 'critical', kev: true }] });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000R1", repo: "r1", lane: "lane1", subject: "R1", subjectFields: ["rule"], identityDeclared: false, worst: "crit", rank: 4, kev: true, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 1, high: 0, med: 0, low: 0, unknown: 0 }, states: { open: 1 }, distinct: 1, inFocus: true }], totals: { rows: 1, groups: 1, focus: 1, suppressed: 0, undetermined: 0, graded: 1, kev: 1, counts: { crit: 1, high: 0, med: 0, low: 0, unknown: 0 }, states: { open: 1 } }, undeclaredLanes: ["lane1"] });
});

test('sorts groups by rank descending then members descending then key ascending', () => {
  const r = buildFeedGroups({
    lane1: [
      { repo: 'r1', rule: 'A', sev: 'low' },
      { repo: 'r1', rule: 'B', sev: 'high' },
      { repo: 'r1', rule: 'C', sev: 'high' },
      { repo: 'r1', rule: 'D', sev: 'medium' }
    ]
  });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000B", repo: "r1", lane: "lane1", subject: "B", subjectFields: ["rule"], identityDeclared: false, worst: "high", rank: 3, kev: false, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { open: 1 }, distinct: 1, inFocus: true }, { key: "r1\u0000lane1\u0000C", repo: "r1", lane: "lane1", subject: "C", subjectFields: ["rule"], identityDeclared: false, worst: "high", rank: 3, kev: false, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { open: 1 }, distinct: 1, inFocus: true }, { key: "r1\u0000lane1\u0000D", repo: "r1", lane: "lane1", subject: "D", subjectFields: ["rule"], identityDeclared: false, worst: "med", rank: 2, kev: false, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 0, med: 1, low: 0, unknown: 0 }, states: { open: 1 }, distinct: 1, inFocus: true }, { key: "r1\u0000lane1\u0000A", repo: "r1", lane: "lane1", subject: "A", subjectFields: ["rule"], identityDeclared: false, worst: "low", rank: 1, kev: false, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 0, med: 0, low: 1, unknown: 0 }, states: { open: 1 }, distinct: 1, inFocus: true }], totals: { rows: 4, groups: 4, focus: 4, suppressed: 0, undetermined: 0, graded: 4, kev: 0, counts: { crit: 0, high: 2, med: 1, low: 1, unknown: 0 }, states: { open: 4 } }, undeclaredLanes: ["lane1"] });
});

test('aggregates multiple rows into one group with distinct subRows', () => {
  const r = buildFeedGroups({ lane1: [{ repo: 'r1', rule: 'R1', sev: 'high' }, { repo: 'r1', rule: 'R1', sev: 'medium' }] });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000R1", repo: "r1", lane: "lane1", subject: "R1", subjectFields: ["rule"], identityDeclared: false, worst: "high", rank: 3, kev: false, members: 2, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 1, med: 1, low: 0, unknown: 0 }, states: { open: 2 }, distinct: 1, inFocus: true }], totals: { rows: 2, groups: 1, focus: 1, suppressed: 0, undetermined: 0, graded: 2, kev: 0, counts: { crit: 0, high: 1, med: 1, low: 0, unknown: 0 }, states: { open: 2 } }, undeclaredLanes: ["lane1"] });
});

test('handles closed issue with fixed closedAs and present row as claimed-fixed', () => {
  const r = buildFeedGroups({ lane1: [{ repo: 'r1', rule: 'R1', sev: 'high' }] }, { issueFor: () => ({ state: 'closed', closedAs: 'fixed' }) });
  assert.deepEqual(r, { groups: [{ key: "r1\u0000lane1\u0000R1", repo: "r1", lane: "lane1", subject: "R1", subjectFields: ["rule"], identityDeclared: false, worst: "high", rank: 3, kev: false, members: 1, suppressed: 0, undetermined: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { "claimed-fixed": 1 }, distinct: 1, inFocus: true }], totals: { rows: 1, groups: 1, focus: 1, suppressed: 0, undetermined: 0, graded: 1, kev: 0, counts: { crit: 0, high: 1, med: 0, low: 0, unknown: 0 }, states: { "claimed-fixed": 1 } }, undeclaredLanes: ["lane1"] });
});
