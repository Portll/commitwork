// Stamps snoozedUntil on an open issue and appends an issue-snoozed event (monitor/issue-store.mjs snoozeIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snoozeIssue } from '../issue-store.mjs';

const AT = '2025-01-01T00:00:00Z';
const UNTIL = '2025-01-02T00:00:00Z';
const AT_MESSAGE = 'snoozeIssue requires `at` (ISO instant)';
const TOO_FAR_MESSAGE = 'until is more than 365 days out; a snooze that long is a decision, file one';

const openDoc = () => ({ issues: { i1: { id: 'i1', state: 'open' } }, events: [] });

test('throws when the issue id is not in the document', () => {
  const doc = openDoc();
  assert.throws(() => snoozeIssue(doc, 'missing', { until: UNTIL, at: AT }), { name: 'Error', message: 'unknown issue missing' });
});

test('throws when the issue is closed and records no event', () => {
  const doc = { issues: { i1: { id: 'i1', state: 'closed' } }, events: [] };
  assert.throws(() => snoozeIssue(doc, 'i1', { until: UNTIL, at: AT }), { name: 'Error', message: 'i1 is closed; nothing to snooze' });
  assert.deepEqual(doc.events, []);
});

test('throws when until is not a string', () => {
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: 123, at: AT }), { name: 'Error', message: 'until must be an ISO instant' });
});

test('throws when until is a string that does not parse as a date', () => {
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: 'not-a-date', at: AT }), { name: 'Error', message: 'until must be an ISO instant' });
});

test('throws when at is missing, empty or not a string', () => {
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: UNTIL }), { name: 'Error', message: AT_MESSAGE });
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: UNTIL, at: '' }), { name: 'Error', message: AT_MESSAGE });
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: UNTIL, at: 123 }), { name: 'Error', message: AT_MESSAGE });
});

test('throws when until is equal to at or earlier than at', () => {
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: AT, at: AT }), { name: 'Error', message: 'until (2025-01-01T00:00:00Z) is not after now (2025-01-01T00:00:00Z)' });
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: '2024-12-31T00:00:00Z', at: AT }), { name: 'Error', message: 'until (2024-12-31T00:00:00Z) is not after now (2025-01-01T00:00:00Z)' });
});

test('accepts until one millisecond after at and leaves by out of the event data', () => {
  const doc = openDoc();
  const until = '2025-01-01T00:00:00.001Z';
  const r = snoozeIssue(doc, 'i1', { until, at: AT });
  assert.deepEqual(r, { id: 'i1', state: 'open', snoozedUntil: until, updatedAt: AT });
  assert.deepEqual(doc.events[0].data, { until });
});

test('accepts until exactly 365 days after at', () => {
  const until = '2026-01-01T00:00:00.000Z';
  const r = snoozeIssue(openDoc(), 'i1', { until, at: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { id: 'i1', state: 'open', snoozedUntil: until, updatedAt: '2025-01-01T00:00:00.000Z' });
});

test('throws when until is 365 days and one millisecond after at', () => {
  assert.throws(() => snoozeIssue(openDoc(), 'i1', { until: '2026-01-01T00:00:00.001Z', at: '2025-01-01T00:00:00.000Z' }), { name: 'Error', message: TOO_FAR_MESSAGE });
});

test('returns the stored issue, records by in the event, and chains a second snooze onto the first', () => {
  const doc = openDoc();
  const r = snoozeIssue(doc, 'i1', { until: UNTIL, at: AT, by: 'alice' });
  assert.equal(r, doc.issues.i1);
  assert.deepEqual(r, { id: 'i1', state: 'open', snoozedUntil: UNTIL, updatedAt: AT });
  assert.equal(doc.events.length, 1);
  assert.deepEqual({ ...doc.events[0], hash: '' }, { type: 'issue-snoozed', issueId: 'i1', at: AT, data: { until: UNTIL, by: 'alice' }, prevHash: null, hash: '' });
  const later = '2025-01-03T00:00:00Z';
  const again = snoozeIssue(doc, 'i1', { until: later, at: UNTIL });
  assert.deepEqual(again, { id: 'i1', state: 'open', snoozedUntil: later, updatedAt: UNTIL });
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[1].prevHash, doc.events[0].hash);
});
