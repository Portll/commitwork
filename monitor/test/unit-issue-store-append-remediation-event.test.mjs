// appendRemediationEvent adds a remediation event to a document (monitor/issue-store.mjs appendRemediationEvent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRemediationEvent } from '../issue-store.mjs';

const baseDoc = {
  issues: {
    ISSUE1: { source: {}, anchor: {} },
  },
  events: [],
};

test('appends a valid remediation event of type fix-authored', () => {
  const doc = { ...baseDoc, events: [] };
  const result = appendRemediationEvent(doc, 'fix-authored', 'ISSUE1', {
    at: '2023-01-01T00:00:00Z',
    evidence: { note: 'note', who: 'tester' },
  });
  assert.deepEqual(result, { type: "fix-authored", issueId: "ISSUE1", at: "2023-01-01T00:00:00Z", data: { rule: "manual/task", pathPrefix: "./", package: null, evidence: { note: "note", who: "tester" } }, prevHash: null, hash: "6e595494fe414909b12c294d459e309738cba0275661ca4c264a34764fb3e577" });
});

test('throws when remediation event type is not in the allowed set', () => {
  const doc = { ...baseDoc, events: [] };
  assert.throws(
    () => appendRemediationEvent(doc, 'invalid-type', 'ISSUE1', {
      at: '2023-01-01T00:00:00Z',
      evidence: { note: 'note', who: 'tester' },
    }),
    {
      name: 'Error',
      message:
        'remediation event type must be one of fix-authored|fix-verified|fix-disputed|fp-reinvestigated|reopened-contradiction',
    }
  );
});

test('throws when the issue identifier is unknown', () => {
  const doc = { ...baseDoc, events: [] };
  assert.throws(
    () => appendRemediationEvent(doc, 'fix-authored', 'UNKNOWN', {
      at: '2023-01-01T00:00:00Z',
      evidence: { note: 'note', who: 'tester' },
    }),
    { name: 'Error', message: 'unknown issue UNKNOWN' }
  );
});

test('throws when the at timestamp is missing', () => {
  const doc = { ...baseDoc, events: [] };
  assert.throws(
    () => appendRemediationEvent(doc, 'fix-authored', 'ISSUE1', {
      evidence: { note: 'note', who: 'tester' },
    }),
    {
      name: 'Error',
      message: 'remediation event requires a parseable at instant',
    }
  );
});

test('throws when the at timestamp is not parseable', () => {
  const doc = { ...baseDoc, events: [] };
  assert.throws(
    () => appendRemediationEvent(doc, 'fix-authored', 'ISSUE1', {
      at: 'not-a-date',
      evidence: { note: 'note', who: 'tester' },
    }),
    {
      name: 'Error',
      message: 'remediation event requires a parseable at instant',
    }
  );
});

test('throws when fp-reinvestigated outcome is invalid', () => {
  const doc = { ...baseDoc, events: [] };
  assert.throws(
    () => appendRemediationEvent(doc, 'fp-reinvestigated', 'ISSUE1', {
      at: '2023-01-01T00:00:00Z',
      evidence: { note: 'note', who: 'tester' },
      outcome: 'invalid-outcome',
    }),
    {
      name: 'Error',
      message: 'fp-reinvestigated outcome must be confirmed or contradicted',
    }
  );
});

test('appends a fp-reinvestigated event with a valid outcome', () => {
  const doc = { ...baseDoc, events: [] };
  const result = appendRemediationEvent(doc, 'fp-reinvestigated', 'ISSUE1', {
    at: '2023-01-01T00:00:00Z',
    evidence: { note: 'note', who: 'tester' },
    outcome: 'confirmed',
  });
  assert.deepEqual(result, { type: "fp-reinvestigated", issueId: "ISSUE1", at: "2023-01-01T00:00:00Z", data: { rule: "manual/task", pathPrefix: "./", package: null, evidence: { note: "note", who: "tester" }, outcome: "confirmed" }, prevHash: null, hash: "c7a9ad4c7f4daef65414e505ca73b9aac2fd63e9347e77d5fcbb451d06c6a223" });
});
