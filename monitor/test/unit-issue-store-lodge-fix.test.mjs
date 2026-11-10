// Records a fix claim on an issue and in its event log (monitor/issue-store.mjs lodgeFix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lodgeFix } from '../issue-store.mjs';

const AT = '2026-01-02T03:04:05.000Z';
const makeIssue = () => ({
  id: 'i1',
  state: 'open',
  source: { key: 'f:abc|semgrep|no-eval|lodash|src/app.js' },
  anchor: { file: 'src/app.js' },
});
const makeDoc = () => ({ issues: { i1: makeIssue() }, events: [] });
const args = (over = {}) => ({ fixType: 'code-change', notes: 'Fixed the bug', who: 'alice', at: AT, ...over });
const rejects = (over, message) => assert.throws(() => lodgeFix(makeDoc(), 'i1', args(over)), { name: 'Error', message });
const lengthMessage = (n) => `notes must be 8..2000 characters (got ${n}) \u2014 a lodging without reasoning is a checkbox, not a record`;

test('an issue id missing from the document is rejected', () => {
  assert.throws(() => lodgeFix(makeDoc(), 'missing', args()), { name: 'Error', message: 'unknown issue missing' });
});

test('only the six listed fix types are accepted', () => {
  for (const fixType of ['code-change', 'config-change', 'dep-upgrade', 'compensating-control', 'suppression', 'wont-fix']) {
    assert.equal(lodgeFix(makeDoc(), 'i1', args({ fixType })).fix.fixType, fixType);
  }
  const message = 'fixType must be one of code-change|config-change|dep-upgrade|compensating-control|suppression|wont-fix';
  for (const fixType of ['patch', 'Code-Change', undefined]) rejects({ fixType }, message);
});

test('notes below 8 or above 2000 characters are rejected with their length', () => {
  rejects({ notes: 'x'.repeat(7) }, lengthMessage(7));
  rejects({ notes: 'x'.repeat(2001) }, lengthMessage(2001));
  rejects({ notes: null }, lengthMessage(0));
  rejects({ notes: undefined }, lengthMessage(0));
});

test('notes of exactly 8 and exactly 2000 characters are accepted', () => {
  for (const n of [8, 2000]) {
    const notes = 'x'.repeat(n);
    assert.equal(lodgeFix(makeDoc(), 'i1', args({ notes })).fix.notes, notes);
  }
  assert.equal(lodgeFix(makeDoc(), 'i1', args({ notes: 12345678 })).fix.notes, '12345678');
});

test('notes with a control character or only spaces are rejected and leave the document untouched', () => {
  for (const c of ['\n', '\u0000', '\u001f', '\u007f']) {
    rejects({ notes: `abcdefgh${c}` }, 'notes contain a control character; only printable text is accepted');
  }
  const doc = makeDoc();
  assert.throws(() => lodgeFix(doc, 'i1', args({ notes: ' '.repeat(8) })), { name: 'Error', message: 'remediation event evidence.note is required' });
  assert.deepEqual(doc, makeDoc());
});

test('who must be present and not blank after trimming', () => {
  const message = 'lodgeFix requires `who` \u2014 an unattributed lodging is worth exactly the identity behind it';
  for (const who of [undefined, null, '', 0, '   ']) rejects({ who }, message);
});

test('at must be a non-empty string', () => {
  const message = 'lodgeFix requires `at` (ISO instant) \u2014 the store never reads the clock for a caller';
  for (const at of [undefined, null, '', 0, 123, new Date(0)]) rejects({ at }, message);
});

test('a disposition id must be DSP- followed by twelve lowercase hex digits', () => {
  rejects({ dispositionId: 'BAD' }, 'dispositionId "BAD" is not a DSP- id');
  rejects({ dispositionId: '' }, 'dispositionId "" is not a DSP- id');
  rejects({ dispositionId: 'DSP-123456789ab' }, 'dispositionId "DSP-123456789ab" is not a DSP- id');
  rejects({ dispositionId: 'DSP-0123456789abc' }, 'dispositionId "DSP-0123456789abc" is not a DSP- id');
  rejects({ dispositionId: 'DSP-0123456789AB' }, 'dispositionId "DSP-0123456789AB" is not a DSP- id');
  rejects({ dispositionId: 'DSP-0123456789ag' }, 'dispositionId "DSP-0123456789ag" is not a DSP- id');
  rejects({ dispositionId: 7 }, 'dispositionId 7 is not a DSP- id');
});

test('a valid lodging stores the fix, stamps updatedAt, logs one event and returns the same issue', () => {
  const doc = makeDoc();
  const r = lodgeFix(doc, 'i1', args());
  assert.equal(r, doc.issues.i1);
  assert.deepEqual(r, {
    ...makeIssue(),
    fix: { fixType: 'code-change', notes: 'Fixed the bug', who: 'alice', at: AT, dispositionId: null },
    updatedAt: AT,
  });
  assert.equal(doc.events.length, 1);
  const [event] = doc.events;
  assert.equal(event.type, 'fix-authored');
  assert.equal(event.issueId, 'i1');
  assert.equal(event.at, AT);
  assert.equal(event.prevHash, null);
  assert.equal(event.data.rule, 'semgrep/no-eval');
  assert.equal(event.data.package, 'lodash');
  assert.deepEqual(event.data.evidence, { note: 'Fixed the bug', who: 'alice' });
  assert.deepEqual(event.data.fix, { fixType: 'code-change', notes: 'Fixed the bug', who: 'alice', dispositionId: null });
});

test('re-lodging replaces the fix and chains a second event onto the first', () => {
  const doc = makeDoc();
  lodgeFix(doc, 'i1', args());
  const later = '2026-02-03T04:05:06.000Z';
  const dispositionId = 'DSP-0123456789ab';
  const notes = '  accepted risk  ';
  const r = lodgeFix(doc, 'i1', args({ fixType: 'wont-fix', notes, who: 42, at: later, dispositionId }));
  assert.deepEqual(r.fix, { fixType: 'wont-fix', notes, who: '42', at: later, dispositionId });
  assert.equal(r.updatedAt, later);
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[1].prevHash, doc.events[0].hash);
  assert.equal(doc.events[1].at, later);
  assert.deepEqual(doc.events[1].data.evidence, { note: 'accepted risk', who: '42' });
  assert.deepEqual(doc.events[1].data.fix, { fixType: 'wont-fix', notes, who: '42', dispositionId });
});
