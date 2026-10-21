// Validates the shape and consistency of a cobolwork-advice document (lib/cobolwork-bridge.mjs adviceProblem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceProblem } from '../cobolwork-bridge.mjs';

test('returns null for a valid advice document', () => {
  const doc = {
    tool: 'cobolwork-advice',
    schemaVersion: 1,
    items: [
      {
        id: 'a1',
        ref: 'file:1',
        kind: 'finding',
        sev: 'info',
        where: { line: 1 },
        remediation: { action: 'fix' },
        fingerprint: '0123456789abcdef0123456789abcdef'
      }
    ],
    summary: { ordered: ['a1'] },
    unmeasured: []
  };
  assert.equal(adviceProblem(doc), null);
});

test('returns error for null input', () => {
  assert.equal(adviceProblem(null), 'it wrote no advice document');
});

test('returns error for non-object input', () => {
  assert.equal(adviceProblem('string'), 'it wrote no advice document');
});

test('returns error for array input', () => {
  assert.equal(adviceProblem([]), 'it wrote no advice document');
});

test('returns error for wrong tool name', () => {
  const doc = { tool: 'other-tool', schemaVersion: 1, items: [], summary: { ordered: [] }, unmeasured: [] };
  assert.equal(adviceProblem(doc), 'expected a cobolwork-advice document, got "other-tool"');
});

test('returns error for wrong schema version', () => {
  const doc = { tool: 'cobolwork-advice', schemaVersion: 2, items: [], summary: { ordered: [] }, unmeasured: [] };
  assert.equal(adviceProblem(doc), 'the advice document\'s schemaVersion is 2, and commitwork reads only 1');
});

test('returns error when items is missing', () => {
  const doc = { tool: 'cobolwork-advice', schemaVersion: 1, summary: { ordered: [] }, unmeasured: [] };
  assert.equal(adviceProblem(doc), 'the advice document has no items, summary.ordered or unmeasured list');
});

test('returns error when summary.ordered references a non-existent item', () => {
  const doc = {
    tool: 'cobolwork-advice',
    schemaVersion: 1,
    items: [{ id: 'a1', ref: 'r', kind: 'finding', sev: 'info', where: {}, remediation: {} }],
    summary: { ordered: ['a1', 'missing'] },
    unmeasured: []
  };
  assert.equal(adviceProblem(doc), 'summary.ordered names "missing", which is not an item');
});

test('returns error when summary.ordered count does not match items count', () => {
  const doc = {
    tool: 'cobolwork-advice',
    schemaVersion: 1,
    items: [
      { id: 'a1', ref: 'r', kind: 'finding', sev: 'info', where: {}, remediation: {} },
      { id: 'a2', ref: 'r', kind: 'finding', sev: 'info', where: {}, remediation: {} }
    ],
    summary: { ordered: ['a1'] },
    unmeasured: []
  };
  assert.equal(adviceProblem(doc), 'summary.ordered lists 1 ids for 2 items');
});

test('returns error for item with invalid kind', () => {
  const doc = {
    tool: 'cobolwork-advice',
    schemaVersion: 1,
    items: [{ id: 'a1', ref: 'r', kind: 'invalid-kind', sev: 'info', where: {}, remediation: {} }],
    summary: { ordered: ['a1'] },
    unmeasured: []
  };
  assert.equal(adviceProblem(doc), 'item "a1" is not a version 1 advice item: it lacks an id, ref, where or remediation, or its kind, sev or fingerprint is not one version 1 writes');
});
