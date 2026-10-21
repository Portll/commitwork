// Computes anchor collision, similarity, and severity conflict summaries (bin/reconcile-findings.mjs analyse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../reconcile-findings.mjs';

test('returns zero counts and empty arrays for empty inputs', () => {
  const result = analyse([], []);
  assert.equal(result.multiRecordAnchors, 0);
  assert.deepEqual(result.multiEntryAnchors, []);
  assert.deepEqual(result.coLocatedAnchors, []);
  assert.deepEqual(result.crossEntryDisagreements, []);
  assert.deepEqual(result.withinEntryConflicts, []);
  assert.equal(result.unreviewedEntries, 0);
  assert.equal(result.unreviewedRecords, 0);
  assert.equal(result.unreviewedWithEmptyNote, 0);
  assert.deepEqual(result.bySeverity, {});
  assert.deepEqual(result.byDisposition, {});
  assert.deepEqual(result.recordsBySeverity, {});
  assert.deepEqual(result.recordsBySource, {});
});

test('tallies severity and disposition for single entry and record', () => {
  const entries = [{ id: 'e1', anchor: 'a:1', severity: 'high', disposition: 'verified', conflicts: [] }];
  const records = [{ id: 'r1', file: 'a', line: 1, severity: 'high', source: 's1', verdict: 'verified', note: 'ok' }];
  const result = analyse(entries, records);
  assert.equal(result.multiRecordAnchors, 0);
  assert.deepEqual(result.bySeverity, { high: 1 });
  assert.deepEqual(result.byDisposition, { verified: 1 });
  assert.deepEqual(result.recordsBySeverity, { high: 1 });
  assert.deepEqual(result.recordsBySource, { s1: 1 });
  assert.equal(result.unreviewedEntries, 0);
  assert.equal(result.unreviewedRecords, 0);
});

test('counts multiRecordAnchors when multiple records share same file and line', () => {
  const entries = [
    { id: 'e1', anchor: 'a:1', severity: 'low', disposition: 'verified', conflicts: [] },
    { id: 'e2', anchor: 'a:1', severity: 'low', disposition: 'verified', conflicts: [] }
  ];
  const records = [
    { id: 'r1', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'verified', note: 'n1' },
    { id: 'r2', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'verified', note: 'n2' }
  ];
  const result = analyse(entries, records);
  assert.equal(result.multiRecordAnchors, 1);
  assert.equal(result.multiEntryAnchors.length, 1);
  assert.equal(result.multiEntryAnchors[0].anchor, 'a:1');
  assert.equal(result.multiEntryAnchors[0].entries, 2);
  assert.equal(result.multiEntryAnchors[0].records, 2);
});

test('classifies low similarity multi-entry anchors as coLocatedAnchors', () => {
  const entries = [
    { id: 'e1', anchor: 'a:1', severity: 'low', disposition: 'verified', conflicts: [], summary: 'alpha beta' },
    { id: 'e2', anchor: 'a:1', severity: 'low', disposition: 'verified', conflicts: [], summary: 'gamma delta' }
  ];
  const records = [
    { id: 'r1', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'verified', note: 'n1' },
    { id: 'r2', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'verified', note: 'n2' }
  ];
  const result = analyse(entries, records);
  assert.equal(result.multiEntryAnchors.length, 1);
  assert.equal(result.multiEntryAnchors[0].similarity, 0);
  assert.equal(result.coLocatedAnchors.length, 1);
  assert.equal(result.crossEntryDisagreements.length, 0);
});

test('classifies high similarity with differing severities as crossEntryDisagreements', () => {
  const entries = [
    { id: 'e1', anchor: 'a:1', severity: 'low', disposition: 'verified', conflicts: [], summary: 'alpha beta' },
    { id: 'e2', anchor: 'a:1', severity: 'high', disposition: 'verified', conflicts: [], summary: 'alpha beta' }
  ];
  const records = [
    { id: 'r1', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'verified', note: 'n1' },
    { id: 'r2', file: 'a', line: 1, severity: 'high', source: 's1', verdict: 'verified', note: 'n2' }
  ];
  const result = analyse(entries, records);
  assert.equal(result.multiEntryAnchors.length, 1);
  assert.equal(result.multiEntryAnchors[0].similarity, 1);
  assert.equal(result.coLocatedAnchors.length, 0);
  assert.equal(result.crossEntryDisagreements.length, 1);
  assert.deepEqual(result.crossEntryDisagreements[0].severities, ['high', 'low']);
});

test('classifies high similarity with same severity as neither coLocated nor disagreement', () => {
  const entries = [
    { id: 'e1', anchor: 'a:1', severity: 'low', disposition: 'verified', conflicts: [], summary: 'alpha beta' },
    { id: 'e2', anchor: 'a:1', severity: 'low', disposition: 'verified', conflicts: [], summary: 'alpha beta' }
  ];
  const records = [
    { id: 'r1', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'verified', note: 'n1' },
    { id: 'r2', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'verified', note: 'n2' }
  ];
  const result = analyse(entries, records);
  assert.equal(result.multiEntryAnchors.length, 1);
  assert.equal(result.multiEntryAnchors[0].similarity, 1);
  assert.equal(result.coLocatedAnchors.length, 0);
  assert.equal(result.crossEntryDisagreements.length, 0);
});

test('extracts withinEntryConflicts for entries with unresolved conflicts', () => {
  const entries = [
    { id: 'e1', anchor: 'a:1', severity: 'medium', disposition: 'verified', conflicts: [{ unresolved: true }, { unresolved: false }] },
    { id: 'e2', anchor: 'b:2', severity: 'low', disposition: 'verified', conflicts: [{ unresolved: false }] }
  ];
  const records = [
    { id: 'r1', file: 'a', line: 1, severity: 'medium', source: 's1', verdict: 'verified', note: 'n1' },
    { id: 'r2', file: 'b', line: 2, severity: 'low', source: 's1', verdict: 'verified', note: 'n2' }
  ];
  const result = analyse(entries, records);
  assert.equal(result.withinEntryConflicts.length, 1);
  assert.equal(result.withinEntryConflicts[0].id, 'e1');
  assert.equal(result.withinEntryConflicts[0].conflicts.length, 1);
  assert.equal(result.withinEntryConflicts[0].conflicts[0].unresolved, true);
});

test('counts unreviewed entries and records with empty notes', () => {
  const entries = [
    { id: 'e1', anchor: 'a:1', severity: 'low', disposition: 'unreviewed', conflicts: [] },
    { id: 'e2', anchor: 'b:2', severity: 'low', disposition: 'verified', conflicts: [] }
  ];
  const records = [
    { id: 'r1', file: 'a', line: 1, severity: 'low', source: 's1', verdict: 'unreviewed', note: '' },
    { id: 'r2', file: 'b', line: 2, severity: 'low', source: 's1', verdict: 'unreviewed', note: '  ' },
    { id: 'r3', file: 'c', line: 3, severity: 'low', source: 's1', verdict: 'unreviewed', note: 'note' }
  ];
  const result = analyse(entries, records);
  assert.equal(result.unreviewedEntries, 1);
  assert.equal(result.unreviewedRecords, 3);
  assert.equal(result.unreviewedWithEmptyNote, 2);
});
