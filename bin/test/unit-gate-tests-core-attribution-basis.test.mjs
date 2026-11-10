// Computes the attribution basis for a commit gate (bin/gate-tests-core.mjs attributionBasis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionBasis } from '../gate-tests-core.mjs';

test('empty input yields zero files and no sessions', () => {
  const r = attributionBasis();
  assert.deepEqual(r, { kind: "no-entry", files: 0, evidenced: 0, unevidenced: 0, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('missing liveSessions object is treated as empty', () => {
  const r = attributionBasis({ mine: ['a'], theirs: ['b'], unknown: ['c'] });
  assert.deepEqual(r, { kind: "no-entry", files: 3, evidenced: 2, unevidenced: 0, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('liveSessions with duplicate session ids counts unique sessions', () => {
  const r = attributionBasis({ liveSessions: { a: ['s1', 's2'], b: ['s1', 's3'] } });
  assert.deepEqual(r, { kind: "no-entry", files: 0, evidenced: 0, unevidenced: 0, sessionsConsidered: 3, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('files sums mine theirs and unknown lengths', () => {
  const r = attributionBasis({ mine: ['a', 'b'], theirs: ['c'], unknown: ['d', 'e', 'f'] });
  assert.deepEqual(r, { kind: "no-entry", files: 6, evidenced: 3, unevidenced: 0, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('evidenced subtracts unknown and unevidenced from files', () => {
  const r = attributionBasis({ mine: ['a', 'b', 'c', 'd', 'e'], theirs: ['f'], unknown: ['g', 'h'], unevidenced: ['x'] });
  assert.deepEqual(r, { kind: "no-entry", files: 8, evidenced: 5, unevidenced: 1, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('evidenced is clamped to zero when unevidenced exceeds files', () => {
  const r = attributionBasis({ mine: ['a'], unevidenced: ['x', 'y', 'z'] });
  assert.deepEqual(r, { kind: "no-entry", files: 1, evidenced: 0, unevidenced: 3, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('rows defaults to zero when row counts are absent', () => {
  const r = attributionBasis({ mine: ['a'] });
  assert.deepEqual(r, { kind: "no-entry", files: 1, evidenced: 1, unevidenced: 0, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('rows reflects provided tree and foreign counts', () => {
  const r = attributionBasis({ treeMineRows: 5, treeUnknownRows: 3, foreignTreeRows: 2, torn: 1 });
  assert.deepEqual(r, { kind: "no-entry", files: 0, evidenced: 0, unevidenced: 0, sessionsConsidered: 0, rows: { treeMine: 5, treeUnknown: 3, foreign: 2, torn: 1 } });
});

test('unevidenced length is reported when provided', () => {
  const r = attributionBasis({ mine: ['a', 'b', 'c'], unevidenced: ['x', 'y'] });
  assert.deepEqual(r, { kind: "no-entry", files: 3, evidenced: 1, unevidenced: 2, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});

test('kind is no-entry when ledger and session are present', () => {
  const r = attributionBasis({ ledgerPresent: true, sessionKnown: true, mine: ['a'] });
  assert.deepEqual(r, { kind: "no-entry", files: 1, evidenced: 1, unevidenced: 0, sessionsConsidered: 0, rows: { treeMine: 0, treeUnknown: 0, foreign: 0, torn: 0 } });
});
