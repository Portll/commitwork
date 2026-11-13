// classification of subjects and sorting of gaps (lib/security-malicious-content-evidence.mjs contentEvidence)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentEvidence } from '../security-malicious-content-evidence.mjs';

test('classifies a completed subject with no evidence and non-empty advisoryIds as nothing-observed', () => {
  const input = {
    subjects: [
      {
        id: 's1',
        type: 'installed-dependency',
        scannerOutcome: 'completed',
        advisoryIds: ['ADV-1'],
        evidence: { observed: [], static: [], unreadable: [] }
      }
    ],
    coverage: { gaps: [] }
  };
  const result = contentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "s1", type: "installed-dependency", class: "nothing-observed", confidence: "none", observed: [], static: [], unreadable: [], gaps: [], advisoryIds: ["ADV-1"] }], gaps: [] });
});

test('classifies a subject with observed behaviour as dangerous-behaviour', () => {
  const input = {
    subjects: [
      {
        id: 's2',
        type: 'vendored-javascript',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: {
          observed: [{ behaviour: 'code-execution-on-load', detail: 'detail' }],
          static: [],
          unreadable: []
        }
      }
    ],
    coverage: { gaps: [] }
  };
  const result = contentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "s2", type: "vendored-javascript", class: "dangerous-behaviour", confidence: "demonstrated", observed: [{ behaviour: "code-execution-on-load", detail: "detail" }], static: [], unreadable: [], gaps: [], advisoryIds: [] }], gaps: [] });
});

test('classifies a subject with static capability as candidate', () => {
  const input = {
    subjects: [
      {
        id: 's3',
        type: 'model-serialization',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: {
          observed: [],
          static: [{ capability: 'install-hook', detail: 'detail' }],
          unreadable: []
        }
      }
    ],
    coverage: { gaps: [] }
  };
  const result = contentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "s3", type: "model-serialization", class: "candidate", confidence: "needs-context", observed: [], static: [{ capability: "install-hook", detail: "detail" }], unreadable: [], gaps: [], advisoryIds: [] }], gaps: [] });
});

test('classifies a subject with unreadable evidence as unreadable', () => {
  const input = {
    subjects: [
      {
        id: 's4',
        type: 'dataset-loader',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: {
          observed: [],
          static: [],
          unreadable: [{ path: '/path', why: 'why' }]
        }
      }
    ],
    coverage: { gaps: [] }
  };
  const result = contentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "s4", type: "dataset-loader", class: "unreadable", confidence: "none", observed: [], static: [], unreadable: [{ path: "/path", why: "why" }], gaps: [], advisoryIds: [] }], gaps: [] });
});

test('classifies a subject with scannerOutcome failed as not-examined', () => {
  const input = {
    subjects: [
      {
        id: 's5',
        type: 'installed-dependency',
        scannerOutcome: 'failed',
        advisoryIds: [],
        evidence: { observed: [], static: [], unreadable: [] }
      }
    ],
    coverage: { gaps: [] }
  };
  const result = contentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "s5", type: "installed-dependency", class: "not-examined", confidence: "none", observed: [], static: [], unreadable: [], gaps: [], advisoryIds: [] }], gaps: [] });
});

test('throws TypeError for duplicate subject ids', () => {
  const input = {
    subjects: [
      {
        id: 'dup',
        type: 'installed-dependency',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: { observed: [], static: [], unreadable: [] }
      },
      {
        id: 'dup',
        type: 'vendored-javascript',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: { observed: [], static: [], unreadable: [] }
      }
    ],
    coverage: { gaps: [] }
  };
  assert.throws(() => contentEvidence(input), { name: 'TypeError', message: 'subject.id duplicate' });
});

test('throws TypeError when subjects is an object', () => {
  const input = { subjects: {}, coverage: { gaps: [] } };
  assert.throws(() => contentEvidence(input), { name: 'TypeError', message: 'subjects' });
});

test('throws TypeError when a subject is a string', () => {
  const input = { subjects: ['not an object'], coverage: { gaps: [] } };
  assert.throws(() => contentEvidence(input), { name: 'TypeError', message: 'subject' });
});

test('throws TypeError when an unreadable entry is a string', () => {
  const input = {
    subjects: [
      {
        id: 's6',
        type: 'installed-dependency',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: { observed: [], static: [], unreadable: ['not an object'] }
      }
    ],
    coverage: { gaps: [] }
  };
  assert.throws(() => contentEvidence(input), { name: 'TypeError', message: 'subject.evidence.unreadable entry' });
});

test('gap sorting respects subject, reason, detail order and equality', () => {
  const input = {
    subjects: [
      {
        id: 'a',
        type: 'installed-dependency',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: { observed: [], static: [], unreadable: [] }
      },
      {
        id: 'b',
        type: 'installed-dependency',
        scannerOutcome: 'completed',
        advisoryIds: [],
        evidence: { observed: [], static: [], unreadable: [] }
      }
    ],
    coverage: {
      gaps: [
        { subject: 'b', reason: 'unreadable', detail: 'z' },
        { subject: 'a', reason: 'unreadable', detail: 'z' },
        { subject: 'a', reason: 'unreadable', detail: 'a' },
        { subject: 'a', reason: 'unreadable', detail: 'a' }
      ]
    }
  };
  const result = contentEvidence(input);
  assert.deepEqual(result, { observations: [{ subject: "a", type: "installed-dependency", class: "unreadable", confidence: "none", observed: [], static: [], unreadable: [], gaps: [{ subject: "a", reason: "unreadable", detail: "a" }, { subject: "a", reason: "unreadable", detail: "a" }, { subject: "a", reason: "unreadable", detail: "z" }], advisoryIds: [] }, { subject: "b", type: "installed-dependency", class: "unreadable", confidence: "none", observed: [], static: [], unreadable: [], gaps: [{ subject: "b", reason: "unreadable", detail: "z" }], advisoryIds: [] }], gaps: [{ subject: "a", reason: "unreadable", detail: "a" }, { subject: "a", reason: "unreadable", detail: "a" }, { subject: "a", reason: "unreadable", detail: "z" }, { subject: "b", reason: "unreadable", detail: "z" }] });
});
