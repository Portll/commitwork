// closed issue record and its issue-closed event (monitor/issue-store.mjs closeIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeIssue } from '../issue-store.mjs';

const AT = '2023-01-01T00:00:00.000Z';
const ONE_MS_LATER = '2023-01-01T00:00:00.001Z';
const ONE_MS_EARLIER = '2022-12-31T23:59:59.999Z';

const docWith = (fields = {}) => ({
  issues: {
    I1: { state: 'open', closedAs: null, claim: null, suspect: true, evidence: [], updatedAt: null, ...fields },
  },
  events: [],
});

const claimBy = (sessionId, expiresAt) => ({ by: 'bob', sessionId, expiresAt });

const closedRecord = (as, detail) => ({
  state: 'closed',
  closedAs: as,
  claim: null,
  suspect: false,
  evidence: [{ at: AT, tier: 'manual', detail }],
  updatedAt: AT,
});

const conflict = {
  name: 'Error',
  code: 'CLAIM_CONFLICT',
  message: 'I1 is claimed by bob (session s2); close refused \u2014 pass the owning --session or --force (human only)',
};

test('an open unclaimed issue becomes closed and one issue-closed event is recorded', () => {
  const doc = docWith();
  const r = closeIssue(doc, 'I1', { as: 'fixed', evidence: 'patched in abc123', at: AT });
  assert.deepEqual(r, closedRecord('fixed', 'patched in abc123'));
  assert.equal(r, doc.issues.I1);
  assert.equal(doc.events.length, 1);
  const { hash, ...event } = doc.events[0];
  assert.deepEqual(event, {
    type: 'issue-closed',
    issueId: 'I1',
    at: AT,
    data: { closedAs: 'fixed', evidence: 'patched in abc123' },
    prevHash: null,
  });
});

test('a closedAs outside the allowed list is rejected and the issue stays open', () => {
  const doc = docWith();
  assert.throws(() => closeIssue(doc, 'I1', { as: 'wontfix', evidence: 'e', at: AT }), {
    name: 'Error',
    message: 'closedAs must be one of fixed|accepted|refuted|superseded',
  });
  assert.equal(doc.issues.I1.state, 'open');
  assert.deepEqual(doc.events, []);
});

test('evidence that is absent, blank, empty or circular is rejected', () => {
  const circular = {};
  circular.self = circular;
  for (const evidence of [undefined, null, '', '   ', {}, [], circular]) {
    assert.throws(() => closeIssue(docWith(), 'I1', { as: 'fixed', evidence, at: AT }), {
      name: 'Error',
      message: 'close requires --evidence (a close without evidence is an assertion, not a closure)',
    });
  }
});

test('evidence is trimmed or serialised before it is stored', () => {
  const cases = [
    ['  run 42  ', 'run 42'],
    [42, '42'],
    [0, '0'],
    [false, 'false'],
    [{ run: 42 }, '{"run":42}'],
    [['a'], '["a"]'],
  ];
  for (const [evidence, detail] of cases) {
    const r = closeIssue(docWith(), 'I1', { as: 'accepted', evidence, at: AT });
    assert.deepEqual(r, closedRecord('accepted', detail));
  }
});

test('an unknown id and an already closed issue are both refused', () => {
  assert.throws(() => closeIssue(docWith(), 'I404', { as: 'fixed', evidence: 'e', at: AT }), {
    name: 'Error',
    message: 'unknown issue I404',
  });
  const doc = docWith({ state: 'closed', closedAs: 'refuted' });
  assert.throws(() => closeIssue(doc, 'I1', { as: 'fixed', evidence: 'e', at: AT }), {
    name: 'Error',
    message: 'I1 is already closed (refuted)',
  });
});

test('a claim from another session that expires one ms after the close refuses it', () => {
  const doc = docWith({ claim: claimBy('s2', ONE_MS_LATER) });
  assert.throws(() => closeIssue(doc, 'I1', { as: 'fixed', evidence: 'e', sessionId: 's1', at: AT }), conflict);
  assert.throws(() => closeIssue(doc, 'I1', { as: 'fixed', evidence: 'e', at: AT }), conflict);
  assert.equal(doc.issues.I1.state, 'open');
  assert.deepEqual(doc.issues.I1.claim, claimBy('s2', ONE_MS_LATER));
  assert.deepEqual(doc.events, []);
});

test('a claim from another session no longer blocks once its expiry is at or before the close', () => {
  for (const expiresAt of [AT, ONE_MS_EARLIER]) {
    const doc = docWith({ claim: claimBy('s2', expiresAt) });
    const r = closeIssue(doc, 'I1', { as: 'refuted', evidence: 'e', sessionId: 's1', at: AT });
    assert.deepEqual(r, closedRecord('refuted', 'e'));
  }
});

test('the session that owns an unexpired claim can close and the claim is cleared', () => {
  const owned = docWith({ claim: claimBy('s2', ONE_MS_LATER) });
  const r = closeIssue(owned, 'I1', { as: 'superseded', evidence: 'e', sessionId: 's2', at: AT });
  assert.deepEqual(r, closedRecord('superseded', 'e'));
  const sessionless = docWith({ claim: claimBy(null, ONE_MS_LATER) });
  const s = closeIssue(sessionless, 'I1', { as: 'superseded', evidence: 'e', at: AT });
  assert.deepEqual(s, closedRecord('superseded', 'e'));
});

test('force closes over an unexpired claim from another session', () => {
  const doc = docWith({ claim: claimBy('s2', ONE_MS_LATER) });
  const r = closeIssue(doc, 'I1', { as: 'accepted', evidence: 'e', sessionId: 's1', force: true, at: AT });
  assert.deepEqual(r, closedRecord('accepted', 'e'));
});

test('a by closer rides on the event data and earlier evidence is kept', () => {
  const by = { whoKind: 'agent', channel: 'cli', tool: 'sweep' };
  const prior = { at: ONE_MS_EARLIER, tier: 'scan', detail: 'seen' };
  const doc = docWith({ evidence: [prior] });
  const r = closeIssue(doc, 'I1', { as: 'fixed', evidence: 'e', at: AT, by });
  assert.deepEqual(r.evidence, [prior, { at: AT, tier: 'manual', detail: 'e' }]);
  assert.deepEqual(doc.events[0].data, { closedAs: 'fixed', evidence: 'e', by });
});
