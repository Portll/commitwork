// Snooze is a field on an open issue, never a fifth state: the issue stays open work and keeps its
// state; the feed hides it inside Focus until the instant. Bounded, forward-only, refused on a
// closed issue, and recorded as its own event so the chain says who hid what until when.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyIssuesDoc, mintIssue, snoozeIssue, unsnoozeIssue, isSnoozed, closeIssue, SNOOZE_MAX_DAYS, ISSUE_STATES } from '../issue-store.mjs';

const AT = '2026-10-08T00:00:00.000Z';
const mk = () => {
  const doc = emptyIssuesDoc();
  doc.organisation = 'FIXTURE';
  const { id } = mintIssue(doc, { area: 'a', repo: 'r', kind: 'code', severity: 'high', title: 't', source: { kind: 'scanner-row', key: 'sc:r|sastSemgrep|js/x|src/a.js', tool: 'sastSemgrep', rule: 'js/x' } }, AT);
  return { doc, id };
};

test('snooze sets the field, keeps the state, writes one event; unsnooze clears it with its own event', () => {
  const { doc, id } = mk();
  const until = '2026-10-15T00:00:00.000Z';
  snoozeIssue(doc, id, { until, at: AT, by: 'op' });
  assert.equal(doc.issues[id].snoozedUntil, until);
  assert.equal(doc.issues[id].state, 'open', 'not a fifth state');
  assert.ok(!ISSUE_STATES.includes('snoozed'));
  assert.equal(isSnoozed(doc.issues[id], AT), true);
  assert.equal(isSnoozed(doc.issues[id], '2026-10-16T00:00:00.000Z'), false, 'lapsed');
  const ev = doc.events.at(-1);
  assert.equal(ev.type, 'issue-snoozed');
  assert.deepEqual(ev.data, { until, by: 'op' });
  unsnoozeIssue(doc, id, { at: '2026-10-09T00:00:00.000Z', by: 'op' });
  assert.equal(doc.issues[id].snoozedUntil, null);
  assert.equal(doc.events.at(-1).type, 'issue-unsnoozed');
  const n = doc.events.length;
  unsnoozeIssue(doc, id, { at: '2026-10-09T00:00:00.000Z' });
  assert.equal(doc.events.length, n, 'unsnoozing an unsnoozed issue writes nothing');
});

test('refuses a past instant, a bad instant, more than the maximum, and a closed issue', () => {
  const { doc, id } = mk();
  assert.throws(() => snoozeIssue(doc, id, { until: '2026-10-01T00:00:00.000Z', at: AT }), /not after now/);
  assert.throws(() => snoozeIssue(doc, id, { until: 'tomorrow', at: AT }), /ISO instant/);
  assert.throws(() => snoozeIssue(doc, id, { until: new Date(Date.parse(AT) + (SNOOZE_MAX_DAYS + 1) * 864e5).toISOString(), at: AT }), /more than 365 days/);
  closeIssue(doc, id, { as: 'accepted', at: AT, evidence: 'fixture' });
  assert.throws(() => snoozeIssue(doc, id, { until: '2026-10-15T00:00:00.000Z', at: AT }), /is closed/);
  assert.throws(() => snoozeIssue(doc, 'ISS-NOPE', { until: '2026-10-15T00:00:00.000Z', at: AT }), /unknown issue/);
});
