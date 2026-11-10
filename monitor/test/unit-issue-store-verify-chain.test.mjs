// verifies chain integrity, index consistency and issue state rules (monitor/issue-store.mjs verifyChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyChain } from '../issue-store.mjs';

test('returns empty array for empty document', () => {
  const doc = { events: [], byKey: {}, issues: {} };
  assert.deepEqual(verifyChain(doc), []);
});

test('detects hash mismatch in a single event', () => {
  const doc = {
    events: [{ prevHash: null, hash: 'badhash', type: 'typeA', issueId: 'ISS-1' }],
    byKey: {},
    issues: {}
  };
  assert.deepEqual(verifyChain(doc), ["events[0]: hash mismatch (typeA ISS-1)"]);
});

test('detects prevHash mismatch between consecutive events', () => {
  const doc = {
    events: [
      { prevHash: null, hash: 'h1', type: 'typeA', issueId: 'ISS-1' },
      { prevHash: 'wrongPrev', hash: 'h2', type: 'typeB', issueId: 'ISS-2' }
    ],
    byKey: {},
    issues: {}
  };
  assert.deepEqual(verifyChain(doc), ["events[0]: hash mismatch (typeA ISS-1)", "events[1]: prevHash mismatch", "events[1]: hash mismatch (typeB ISS-2)"]);
});

test('detects byKey entry pointing to non\u2011existent issue', () => {
  const doc = {
    events: [],
    byKey: { 'key1': 'ISS-999' },
    issues: {}
  };
  assert.deepEqual(verifyChain(doc), ["byKey['key1'] -> ISS-999 which is not in issues{}"]);
});

test('detects issue id field not matching its key in issues map', () => {
  const doc = {
    events: [],
    byKey: {},
    issues: { 'ISS-1': { id: 'WRONG', source: {} } }
  };
  assert.deepEqual(verifyChain(doc), ["issues['ISS-1'].id is 'WRONG'"]);
});

test('detects sourceKey indexed by a different issue', () => {
  const doc = {
    events: [],
    byKey: { 'keyA': 'ISS-2' },
    issues: {
      'ISS-1': { id: 'ISS-1', source: { key: 'keyA' }, state: 'open' },
      'ISS-2': { id: 'ISS-2', source: { key: 'keyB' }, state: 'open' }
    }
  };
  assert.deepEqual(verifyChain(doc), ["ISS-1: sourceKey indexed to ISS-2, which does not claim it", "ISS-2: sourceKey 'keyB' is indexed by nobody"]);
});

test('detects open issue displaced by closed issue in byKey', () => {
  const doc = {
    events: [],
    byKey: { 'keyX': 'ISS-closed' },
    issues: {
      'ISS-open': { id: 'ISS-open', source: { key: 'keyX' }, state: 'open' },
      'ISS-closed': { id: 'ISS-closed', source: { key: 'keyX' }, state: 'closed' }
    }
  };
  assert.deepEqual(verifyChain(doc), ["ISS-open: open issue displaced in byKey by closed ISS-closed"]);
});

test('detects sourceKey indexed by nobody', () => {
  const doc = {
    events: [],
    byKey: {},
    issues: {
      'ISS-1': { id: 'ISS-1', source: { key: 'lonelyKey' }, state: 'open' }
    }
  };
  assert.deepEqual(verifyChain(doc), ["ISS-1: sourceKey 'lonelyKey' is indexed by nobody"]);
});
