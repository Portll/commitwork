// Reopened issue fields and its reopen event trail (monitor/issue-store.mjs reopenIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reopenIssue } from '../issue-store.mjs';

const AT = '2024-01-02T00:00:00.000Z';
const LATER = '2024-01-03T00:00:00.000Z';
const DEFAULT_NOTE = 'finding reappeared after verification';

function makeDoc(overrides = {}) {
  return {
    issues: {
      '1': {
        id: '1',
        state: 'closed',
        closedAs: 'fixed',
        severity: 'high',
        reopenCount: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        claim: null,
        blockedReason: null,
        unsatisfiable: null,
        ...overrides,
      },
    },
    events: [],
  };
}

const types = (doc) => doc.events.map((e) => e.type);

test('a closed fixed issue logs a reopened event then a contradiction event chained to it', () => {
  const doc = makeDoc();
  reopenIssue(doc, '1', { at: AT, reason: 'regression' });
  assert.deepEqual(types(doc), ['issue-reopened', 'reopened-contradiction']);
  const [reopened, contradiction] = doc.events;
  assert.equal(reopened.issueId, '1');
  assert.equal(reopened.at, AT);
  assert.equal(reopened.prevHash, null);
  assert.deepEqual(reopened.data, { reason: 'regression' });
  assert.equal(contradiction.issueId, '1');
  assert.equal(contradiction.at, AT);
  assert.equal(contradiction.prevHash, reopened.hash);
  assert.deepEqual(contradiction.data.evidence, { note: 'regression', who: 'scanner' });
});

test('a closed issue that was not fixed logs only the reopened event', () => {
  const doc = makeDoc({ closedAs: 'wontfix' });
  reopenIssue(doc, '1', { at: AT, reason: 'reconsider' });
  assert.deepEqual(types(doc), ['issue-reopened']);
  assert.deepEqual(doc.events[0].data, { reason: 'reconsider' });
});

test('an open issue logs only the reopened event whether or not closedAs says fixed', () => {
  const staleFixed = makeDoc({ state: 'open', closedAs: 'fixed' });
  reopenIssue(staleFixed, '1', { at: AT, reason: 'stale' });
  assert.deepEqual(types(staleFixed), ['issue-reopened']);
  const plainOpen = makeDoc({ state: 'open', closedAs: null });
  reopenIssue(plainOpen, '1', { at: AT, reason: 'still open' });
  assert.deepEqual(types(plainOpen), ['issue-reopened']);
});

test('reopening returns the stored issue with closure fields cleared and reopenCount up by one', () => {
  const doc = makeDoc({ reopenCount: 5, claim: { who: 'worker' }, blockedReason: 'waiting' });
  const result = reopenIssue(doc, '1', { at: AT, reason: 'again' });
  assert.equal(result, doc.issues['1']);
  assert.equal(result.state, 'open');
  assert.equal(result.closedAs, null);
  assert.equal(result.blockedReason, null);
  assert.equal(result.claim, null);
  assert.equal(result.updatedAt, AT);
  assert.equal(result.reopenCount, 6);
});

test('reopening a fixed issue twice logs the contradiction only the first time', () => {
  const doc = makeDoc();
  reopenIssue(doc, '1', { at: AT, reason: 'first' });
  const result = reopenIssue(doc, '1', { at: LATER, reason: 'second' });
  assert.deepEqual(types(doc), ['issue-reopened', 'reopened-contradiction', 'issue-reopened']);
  assert.equal(doc.events[2].prevHash, doc.events[1].hash);
  assert.equal(doc.events[2].at, LATER);
  assert.equal(result.reopenCount, 2);
  assert.equal(result.updatedAt, LATER);
});

test('a missing or empty reason on a fixed issue uses the default evidence note', () => {
  const missing = makeDoc();
  reopenIssue(missing, '1', { at: AT });
  assert.deepEqual(missing.events[0].data, { reason: undefined });
  assert.deepEqual(missing.events[1].data.evidence, { note: DEFAULT_NOTE, who: 'scanner' });
  const empty = makeDoc();
  reopenIssue(empty, '1', { at: AT, reason: '' });
  assert.deepEqual(empty.events[0].data, { reason: '' });
  assert.deepEqual(empty.events[1].data.evidence, { note: DEFAULT_NOTE, who: 'scanner' });
});

test('a whitespace reason on a fixed issue throws after the reopened event is logged', () => {
  const doc = makeDoc();
  assert.throws(() => reopenIssue(doc, '1', { at: AT, reason: '   ' }), {
    name: 'Error',
    message: 'remediation event evidence.note is required',
  });
  assert.deepEqual(types(doc), ['issue-reopened']);
  assert.equal(doc.issues['1'].state, 'open');
});

test('a truthy unsatisfiable marker is cleared to null and a false one stays false', () => {
  const truthy = makeDoc({ closedAs: 'wontfix', unsatisfiable: { note: 'no fix' } });
  assert.equal(reopenIssue(truthy, '1', { at: AT, reason: 'r' }).unsatisfiable, null);
  const falsy = makeDoc({ closedAs: 'wontfix', unsatisfiable: false });
  assert.equal(reopenIssue(falsy, '1', { at: AT, reason: 'r' }).unsatisfiable, false);
});

test('an unknown issue id throws and logs no events', () => {
  const doc = { issues: {}, events: [] };
  assert.throws(() => reopenIssue(doc, 'missing', { at: AT, reason: 'x' }), {
    name: 'Error',
    message: 'unknown issue missing',
  });
  assert.deepEqual(doc.events, []);
});

test('an unparseable at instant throws a RangeError before any event is logged', () => {
  const doc = makeDoc();
  assert.throws(() => reopenIssue(doc, '1', { at: 'not-a-date', reason: 'x' }), {
    name: 'RangeError',
    message: 'Invalid time value',
  });
  assert.deepEqual(doc.events, []);
});
