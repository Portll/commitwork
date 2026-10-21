// Renders the reconciled audit queue as a markdown document (bin/reconcile-findings.mjs renderMarkdown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../reconcile-findings.mjs';

test('renders the header and inputs table with truncated sha256', () => {
  const doc = {
    inputs: [
      { pass: 'a', file: 'f1', sha256: 'abcdef1234567890abcdef1234567890', records: 10 },
      { pass: 'b', file: 'f2', sha256: '11111111111111111111111111111111', records: 5 },
    ],
    totals: {
      records: 15,
      recordsBySource: { findings: 10, missed: 5 },
      entries: 12,
      byDisposition: { open: 5, fixed: 2, unreviewed: 3, refuted: 2 },
      bySeverity: { critical: 2, high: 3, medium: 4, low: 3 },
      recordsBySeverity: { critical: 3, high: 4, medium: 5, low: 3 },
    },
    conflicts: {
      multiRecordAnchors: 2,
      multiEntryAnchors: [
        { anchor: 'src/a.js:10', entries: 2, records: 3, severities: ['critical', 'high'], ids: ['id1', 'id2'] },
      ],
      coLocatedAnchors: [1, 2],
      crossEntryDisagreements: [3],
      unreviewedRecords: 4,
      unreviewedWithEmptyNote: 2,
      unreviewedEntries: 3,
    },
    queue: [
      { id: 'id1', severity: 'critical', anchor: 'src/a.js:10', disposition: 'open', provenance: { passes: ['a'], sources: ['findings'], verdicts: ['verified'] }, summary: 'A critical issue' },
      { id: 'id2', severity: 'high', anchor: 'src/b.js:20', disposition: 'fixed', provenance: { passes: ['b'], sources: ['missed'], verdicts: ['verified'] }, summary: 'A high issue', dispositionReason: 'E.1 \u2014 changed X' },
      { id: 'id3', severity: 'medium', anchor: 'src/c.js:30', disposition: 'unreviewed', provenance: { passes: ['a'], sources: ['findings'], verdicts: ['unreviewed'] }, summary: 'A medium issue' },
      { id: 'id4', severity: 'low', anchor: 'src/d.js:40', disposition: 'refuted', provenance: { passes: ['b'], sources: ['missed'], verdicts: ['refuted'] }, summary: 'A low issue', dispositionReason: 'Not a bug' },
    ],
  };
  const out = renderMarkdown(doc);
  assert.ok(out.startsWith('# Reconciled audit queue \u2014 2026-07-29'));
  assert.ok(out.includes('| pass | file | sha256 | records |'));
  assert.ok(out.includes('| a | `f1` | `abcdef1234567890\u2026` | 10 |'));
  assert.ok(out.includes('| b | `f2` | `1111111111111111\u2026` | 5 |'));
});

test('renders cardinality section with correct counts', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 20,
      recordsBySource: { findings: 15, missed: 5 },
      entries: 18,
      byDisposition: { open: 10, fixed: 3, unreviewed: 4, refuted: 1 },
      bySeverity: { critical: 2, high: 5, medium: 6, low: 5 },
      recordsBySeverity: { critical: 3, high: 6, medium: 7, low: 4 },
    },
    conflicts: {
      multiRecordAnchors: 3,
      multiEntryAnchors: [],
      coLocatedAnchors: [1],
      crossEntryDisagreements: [2, 3],
      unreviewedRecords: 5,
      unreviewedWithEmptyNote: 2,
      unreviewedEntries: 4,
    },
    queue: [],
  };
  const out = renderMarkdown(doc);
  assert.ok(out.includes('- **20 raw records** in (15 `findings[]` + 5 `missed[]`).'));
  assert.ok(out.includes('- **18 distinct defects** out \u2014 the queue\'s true cardinality.'));
  assert.ok(out.includes('3 file:line anchors carry more than one record; 0 still carry more than one *distinct defect* after merging.'));
  assert.ok(out.includes('1 of those are simply two defects on one line (max pairwise similarity below 0.30) and are NOT conflicts; 2 are near-misses where the split itself is questionable.'));
  assert.ok(out.includes('5 records carry `verdict: "unreviewed"` (2 of them with an empty note), producing **4 entries no second reader ever ruled on**.'));
});

test('renders disposition table in order open, unreviewed, fixed, refuted', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 10,
      recordsBySource: { findings: 10, missed: 0 },
      entries: 8,
      byDisposition: { refuted: 1, fixed: 2, unreviewed: 3, open: 2 },
      bySeverity: { high: 8 },
      recordsBySeverity: { high: 10 },
    },
    conflicts: {
      multiRecordAnchors: 0,
      multiEntryAnchors: [],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 3,
      unreviewedWithEmptyNote: 1,
      unreviewedEntries: 3,
    },
    queue: [],
  };
  const out = renderMarkdown(doc);
  const openIdx = out.indexOf('| `open` | 2 |');
  const unreviewedIdx = out.indexOf('| `unreviewed` | 3 |');
  const fixedIdx = out.indexOf('| `fixed` | 2 |');
  const refutedIdx = out.indexOf('| `refuted` | 1 |');
  assert.ok(openIdx !== -1);
  assert.ok(unreviewedIdx !== -1);
  assert.ok(fixedIdx !== -1);
  assert.ok(refutedIdx !== -1);
  assert.ok(openIdx < unreviewedIdx);
  assert.ok(unreviewedIdx < fixedIdx);
  assert.ok(fixedIdx < refutedIdx);
});

test('renders severity table sorted by severity rank descending then name', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 10,
      recordsBySource: { findings: 10, missed: 0 },
      entries: 10,
      byDisposition: { open: 10 },
      bySeverity: { low: 2, critical: 3, high: 2, medium: 3 },
      recordsBySeverity: { low: 2, critical: 3, high: 2, medium: 3 },
    },
    conflicts: {
      multiRecordAnchors: 0,
      multiEntryAnchors: [],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 0,
      unreviewedWithEmptyNote: 0,
      unreviewedEntries: 0,
    },
    queue: [],
  };
  const out = renderMarkdown(doc);
  const critIdx = out.indexOf('| critical | 3 | 3 |');
  const highIdx = out.indexOf('| high | 2 | 2 |');
  const medIdx = out.indexOf('| medium | 3 | 3 |');
  const lowIdx = out.indexOf('| low | 2 | 2 |');
  assert.ok(critIdx !== -1);
  assert.ok(highIdx !== -1);
  assert.ok(medIdx !== -1);
  assert.ok(lowIdx !== -1);
  assert.ok(critIdx < highIdx);
  assert.ok(highIdx < medIdx);
  assert.ok(medIdx < lowIdx);
});

test('renders multi-entry anchors with warning when severities differ', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 5,
      recordsBySource: { findings: 5, missed: 0 },
      entries: 4,
      byDisposition: { open: 4 },
      bySeverity: { critical: 2, high: 2 },
      recordsBySeverity: { critical: 2, high: 3 },
    },
    conflicts: {
      multiRecordAnchors: 2,
      multiEntryAnchors: [
        { anchor: 'src/x.js:1', entries: 2, records: 2, severities: ['critical', 'high'], ids: ['a1', 'a2'] },
        { anchor: 'src/y.js:2', entries: 1, records: 1, severities: ['high'], ids: ['b1'] },
      ],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 0,
      unreviewedWithEmptyNote: 0,
      unreviewedEntries: 0,
    },
    queue: [],
  };
  const out = renderMarkdown(doc);
  assert.ok(out.includes('| `src/x.js:1` | 2 | 2 | critical vs high **\u26a0** | a1, a2 |'));
  assert.ok(out.includes('| `src/y.js:2` | 1 | 1 | high | b1 |'));
});

test('renders open queue entries with provenance and escaped summary', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 3,
      recordsBySource: { findings: 3, missed: 0 },
      entries: 3,
      byDisposition: { open: 3 },
      bySeverity: { high: 3 },
      recordsBySeverity: { high: 3 },
    },
    conflicts: {
      multiRecordAnchors: 0,
      multiEntryAnchors: [],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 0,
      unreviewedWithEmptyNote: 0,
      unreviewedEntries: 0,
    },
    queue: [
      { id: 'q1', severity: 'high', anchor: 'src/a.js:1', disposition: 'open', provenance: { passes: ['p1', 'p2'], sources: ['findings'], verdicts: ['verified'] }, summary: 'Bad | pipe and \\ backslash' },
      { id: 'q2', severity: 'high', anchor: 'src/b.js:2', disposition: 'open', provenance: { passes: ['p1'], sources: ['missed'], verdicts: ['verified'] }, summary: 'Another   issue' },
    ],
  };
  const out = renderMarkdown(doc);
  assert.ok(out.includes('| q1 | high | `src/a.js:1` | open | p1+p2/findings/verified | Bad \\| pipe and \\\\ backslash |'));
  assert.ok(out.includes('| q2 | high | `src/b.js:2` | open | p1/missed/verified | Another issue |'));
});

test('renders fixed entries with disposition reason split on em dash', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 2,
      recordsBySource: { findings: 2, missed: 0 },
      entries: 2,
      byDisposition: { fixed: 2 },
      bySeverity: { medium: 2 },
      recordsBySeverity: { medium: 2 },
    },
    conflicts: {
      multiRecordAnchors: 0,
      multiEntryAnchors: [],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 0,
      unreviewedWithEmptyNote: 0,
      unreviewedEntries: 0,
    },
    queue: [
      { id: 'f1', severity: 'medium', anchor: 'src/a.js:1', disposition: 'fixed', provenance: { passes: ['p1'], sources: ['findings'], verdicts: ['verified'] }, summary: 'Fixed one', dispositionReason: 'E.1 \u2014 changed the thing | with pipe' },
      { id: 'f2', severity: 'medium', anchor: 'src/b.js:2', disposition: 'fixed', provenance: { passes: ['p1'], sources: ['missed'], verdicts: ['verified'] }, summary: 'Fixed two', dispositionReason: 'F.3 \u2014 updated docs' },
    ],
  };
  const out = renderMarkdown(doc);
  assert.ok(out.includes('| f1 | medium | `src/a.js:1` | E.1 | changed the thing \\| with pipe |'));
  assert.ok(out.includes('| f2 | medium | `src/b.js:2` | F.3 | updated docs |'));
});

test('renders moved section only when moved entries exist', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 2,
      recordsBySource: { findings: 2, missed: 0 },
      entries: 2,
      byDisposition: { moved: 2 },
      bySeverity: { low: 2 },
      recordsBySeverity: { low: 2 },
    },
    conflicts: {
      multiRecordAnchors: 0,
      multiEntryAnchors: [],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 0,
      unreviewedWithEmptyNote: 0,
      unreviewedEntries: 0,
    },
    queue: [
      { id: 'm1', severity: 'low', anchor: 'src/new.js:1', disposition: 'moved', movedFrom: { anchor: 'src/old.js:1' }, provenance: { passes: ['p1'], sources: ['findings'], verdicts: ['verified'] }, summary: 'Moved one', dispositionReason: 'File renamed' },
      { id: 'm2', severity: 'low', anchor: 'src/new2.js:2', disposition: 'moved', movedFrom: undefined, provenance: { passes: ['p1'], sources: ['missed'], verdicts: ['verified'] }, summary: 'Moved two', dispositionReason: 'File moved' },
    ],
  };
  const out = renderMarkdown(doc);
  assert.ok(out.includes('## Moved \u2014 2 still live, at a different file than they were anchored to'));
  assert.ok(out.includes('| m1 | low | `src/old.js:1` | `src/new.js:1` | File renamed |'));
  assert.ok(out.includes('| m2 | low | `?` | `src/new2.js:2` | File moved |'));
});

test('omits moved section when no moved entries exist', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 1,
      recordsBySource: { findings: 1, missed: 0 },
      entries: 1,
      byDisposition: { open: 1 },
      bySeverity: { high: 1 },
      recordsBySeverity: { high: 1 },
    },
    conflicts: {
      multiRecordAnchors: 0,
      multiEntryAnchors: [],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 0,
      unreviewedWithEmptyNote: 0,
      unreviewedEntries: 0,
    },
    queue: [
      { id: 'o1', severity: 'high', anchor: 'src/a.js:1', disposition: 'open', provenance: { passes: ['p1'], sources: ['findings'], verdicts: ['verified'] }, summary: 'Open one' },
    ],
  };
  const out = renderMarkdown(doc);
  assert.ok(!out.includes('## Moved'));
});

test('renders refuted and unreviewed sections with escaped reasons and summaries', () => {
  const doc = {
    inputs: [],
    totals: {
      records: 4,
      recordsBySource: { findings: 4, missed: 0 },
      entries: 4,
      byDisposition: { refuted: 2, unreviewed: 2 },
      bySeverity: { medium: 2, low: 2 },
      recordsBySeverity: { medium: 2, low: 2 },
    },
    conflicts: {
      multiRecordAnchors: 0,
      multiEntryAnchors: [],
      coLocatedAnchors: [],
      crossEntryDisagreements: [],
      unreviewedRecords: 2,
      unreviewedWithEmptyNote: 1,
      unreviewedEntries: 2,
    },
    queue: [
      { id: 'r1', severity: 'medium', anchor: 'src/a.js:1', disposition: 'refuted', provenance: { passes: ['p1'], sources: ['findings'], verdicts: ['refuted'] }, summary: 'Refuted one', dispositionReason: 'Not a bug | with pipe' },
      { id: 'r2', severity: 'low', anchor: 'src/b.js:2', disposition: 'refuted', provenance: { passes: ['p1'], sources: ['missed'], verdicts: ['refuted'] }, summary: 'Refuted two', dispositionReason: 'False positive' },
      { id: 'u1', severity: 'medium', anchor: 'src/c.js:3', disposition: 'unreviewed', provenance: { passes: ['p1'], sources: ['findings'], verdicts: ['unreviewed'] }, summary: 'Unreviewed   one' },
      { id: 'u2', severity: 'low', anchor: 'src/d.js:4', disposition: 'unreviewed', provenance: { passes: ['p1'], sources: ['missed'], verdicts: ['unreviewed'] }, summary: 'Unreviewed two' },
    ],
  };
  const out = renderMarkdown(doc);
  assert.ok(out.includes('## Refuted \u2014 kept so they cannot be re-promoted'));
  assert.ok(out.includes('| r1 | `src/a.js:1` | Not a bug \\| with pipe |'));
  assert.ok(out.includes('| r2 | `src/b.js:2` | False positive |'));
  assert.ok(out.includes('## Unreviewed \u2014 2 entries that must be re-read before anything is scheduled off them'));
  assert.ok(out.includes('| u1 | medium | `src/c.js:3` | Unreviewed one |'));
  assert.ok(out.includes('| u2 | low | `src/d.js:4` | Unreviewed two |'));
});
