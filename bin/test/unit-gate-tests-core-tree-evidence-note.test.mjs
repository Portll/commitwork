// Formats a note about unstamped and foreign tree ledger rows (bin/gate-tests-core.mjs treeEvidenceNote).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeEvidenceNote } from '../gate-tests-core.mjs';

test('returns empty string when both unknown and foreign rows are zero', () => {
  const r = treeEvidenceNote({ treeUnknownRows: 0, foreignTreeRows: 0, treeMineRows: 0 });
  assert.equal(r, "");
});

test('returns empty string when unknown is zero and foreign is zero with mine present', () => {
  const r = treeEvidenceNote({ treeUnknownRows: 0, foreignTreeRows: 0, treeMineRows: 5 });
  assert.equal(r, "");
});

test('returns empty string when called with no arguments', () => {
  const r = treeEvidenceNote();
  assert.equal(r, "");
});

test('returns evidence note when unknown rows are present and foreign is zero', () => {
  const r = treeEvidenceNote({ treeUnknownRows: 1, foreignTreeRows: 0, treeMineRows: 0 });
  assert.equal(r, "\n\nEvidence quality: 1 of 1 ledger rows carry NO tree identity (100%). Unstamped rows cannot be placed in a tree, so any \"theirs\" above may name a session from a different checkout.");
});

test('returns evidence note with foreign clause when both unknown and foreign rows are present', () => {
  const r = treeEvidenceNote({ treeUnknownRows: 1, foreignTreeRows: 1, treeMineRows: 0 });
  assert.equal(r, "\n\nEvidence quality: 1 of 2 ledger rows carry NO tree identity (50%), and 1 were dropped as another checkout's. Unstamped rows cannot be placed in a tree, so any \"theirs\" above may name a session from a different checkout.");
});

test('returns evidence note with mine rows included in total', () => {
  const r = treeEvidenceNote({ treeUnknownRows: 2, foreignTreeRows: 1, treeMineRows: 3 });
  assert.equal(r, "\n\nEvidence quality: 2 of 6 ledger rows carry NO tree identity (33%), and 1 were dropped as another checkout's. Unstamped rows cannot be placed in a tree, so any \"theirs\" above may name a session from a different checkout.");
});

test('returns evidence note when unknown is zero and foreign is present', () => {
  const r = treeEvidenceNote({ treeUnknownRows: 0, foreignTreeRows: 2, treeMineRows: 0 });
  assert.equal(r, "\n\nEvidence quality: 0 of 2 ledger rows carry NO tree identity (0%), and 2 were dropped as another checkout's. Unstamped rows cannot be placed in a tree, so any \"theirs\" above may name a session from a different checkout.");
});
