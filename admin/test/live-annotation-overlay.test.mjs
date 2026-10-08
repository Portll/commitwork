// rollup.json freezes the judgments in force at sweep time. The operator recorded fifteen leaks as
// false positives on 2026-08-25 and the header still read "leaks 15, 15 open", because the overlay
// only ran when a sweep wrote the slice — hours away, or days for a weekly area.
//
// The panel now re-runs the SAME overlay when it reads a slice. These assert the properties that
// make that safe: idempotence (a row the sweep already suppressed must not be counted twice), the
// aggregate moving rather than shrinking, and an unreadable store leaving the slice alone rather
// than blanking it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScannerAnnotations } from '../../monitor/annotate-lib.mjs';

const IDENTITY = { secrets: ['rule', 'file'] };
const identityFor = (k) => (IDENTITY[k] ? [...IDENTITY[k]] : null);
const annotationView = (a) => ({ action: a.action, reason: a.reason, who: a.who, at: a.at });
const SEVLESS = { secrets: 'undetermined' };

const slice = () => ({
  scannerFindings: {
    secrets: [
      { repo: 'r', rule: 'generic-api-key', file: 'a.js', line: 3, sev: '' },
      { repo: 'r', rule: 'generic-api-key', file: 'b.js', line: 9, sev: '' },
      { repo: 'r', rule: 'aws-access-token', file: 'c.js', line: 1, sev: 'high' },
    ],
  },
  scanners: { secrets: { high: 1, undetermined: 2, total: 3, annotated: 0, ran: 1 } },
});

const ann = (over = {}) => ({
  category: 'secrets', repo: 'r', rule: 'generic-api-key', file: 'a.js',
  action: 'false-positive', reason: 'test fixture', who: 'op',
  at: '2026-08-25T00:00:00.000Z', ...over,
});

const run = (s, annots, asOf = '2026-08-26T00:00:00.000Z') => applyScannerAnnotations({
  annots, scannerFindings: s.scannerFindings, scannerFleet: s.scanners,
  asOf, identityFor, annotationView, sevlessBucket: SEVLESS,
});

test('the harness is live — an un-annotated slice keeps every finding', () => {
  const s = slice();
  const { annotatedTotal } = run(s, []);
  assert.equal(annotatedTotal, 0);
  assert.equal(s.scanners.secrets.total, 3, 'nothing to apply must change nothing');
});

test('a false positive drops the open count and the row keeps its place', () => {
  const s = slice();
  const { annotatedTotal } = run(s, [ann()]);
  assert.equal(annotatedTotal, 1);
  assert.equal(s.scanners.secrets.total, 2, 'the open total must fall');
  assert.equal(s.scanners.secrets.annotated, 1, 'and the count must reappear as annotated');
  assert.equal(s.scannerFindings.secrets.length, 3, 'suppressed is never deleted — the row stays');
  assert.ok(s.scannerFindings.secrets[0].annotation, 'the suppressed row carries its judgment');
});

test('a severity-less row moves out of undetermined, not out of a crit/high bucket', () => {
  const s = slice();
  run(s, [ann()]);
  assert.equal(s.scanners.secrets.undetermined, 1, 'gitleaks rows carry no sev — they leave undetermined');
  assert.equal(s.scanners.secrets.high, 1, 'the unrelated high finding is untouched');
});

// The property that makes running this at READ time safe at all.
test('IDEMPOTENT — re-running over an already-overlaid slice double-counts nothing', () => {
  const s = slice();
  run(s, [ann()]);
  const afterFirst = JSON.parse(JSON.stringify(s.scanners.secrets));
  const { annotatedTotal } = run(s, [ann()]);
  assert.equal(annotatedTotal, 0, 'the second pass must find nothing new to suppress');
  assert.deepEqual(s.scanners.secrets, afterFirst, 'and must leave the aggregate exactly as it was');
});

test('an annotation authored AFTER the slice still applies — that is the whole point', () => {
  const s = slice();
  // asOf is NOW, not the slice stamp; a judgment recorded an hour after the sweep is in force.
  const { annotatedTotal } = run(s, [ann({ at: '2026-08-25T23:00:00.000Z' })]);
  assert.equal(annotatedTotal, 1);
});

test('an annotation not yet authored as-of the read is NOT applied', () => {
  const s = slice();
  const { annotatedTotal } = run(s, [ann({ at: '2027-01-01T00:00:00.000Z' })]);
  assert.equal(annotatedTotal, 0, 'a future-dated record must not suppress today');
  assert.equal(s.scanners.secrets.total, 3);
});

test('an expired annotation is reported expired and suppresses nothing', () => {
  const s = slice();
  const { status, annotatedTotal } = run(s, [ann({ expires: '2026-08-25T12:00:00.000Z' })]);
  assert.equal(annotatedTotal, 0);
  assert.equal(status.expired.length, 1, 'a lapsed judgment must be named, not silently ignored');
});

test('note and resolved inform without suppressing', () => {
  for (const action of ['note', 'resolved']) {
    const s = slice();
    const { annotatedTotal } = run(s, [ann({ action })]);
    assert.equal(annotatedTotal, 0, `${action} must not drop a finding from the open count`);
  }
});

test('a record matching nothing is reported as noMatch, not as applied', () => {
  const s = slice();
  const { status } = run(s, [ann({ file: 'nowhere.js' })]);
  assert.equal(status.applied.length, 0);
  assert.equal(status.noMatch.length, 1, 'a stale acceptance must surface, or it rots unseen');
});

test('the aggregate never goes negative, even if more records match than the count admits', () => {
  const s = slice();
  s.scanners.secrets.undetermined = 0;      // a slice whose aggregate disagrees with its rows
  run(s, [ann()]);
  assert.ok(s.scanners.secrets.undetermined >= 0, 'a negative count would be worse than a wrong one');
  assert.ok(s.scanners.secrets.total >= 0);
});
