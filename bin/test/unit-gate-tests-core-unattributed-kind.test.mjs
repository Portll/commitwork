// Classifies why a commit lacks attribution (bin/gate-tests-core.mjs unattributedKind).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unattributedKind } from '../gate-tests-core.mjs';

test('returns no-ledger when ledgerPresent is false', () => {
  const r = unattributedKind({ ledgerPresent: false, sessionKnown: true });
  assert.equal(r, "no-ledger");
});

test('returns no-session when ledgerPresent is true and sessionKnown is false', () => {
  const r = unattributedKind({ ledgerPresent: true, sessionKnown: false });
  assert.equal(r, "no-session");
});

test('returns no-entry when both ledgerPresent and sessionKnown are true', () => {
  const r = unattributedKind({ ledgerPresent: true, sessionKnown: true });
  assert.equal(r, "no-entry");
});

test('returns no-ledger when ledgerPresent is false and sessionKnown is false', () => {
  const r = unattributedKind({ ledgerPresent: false, sessionKnown: false });
  assert.equal(r, "no-ledger");
});

test('returns no-session when ledgerPresent is undefined and sessionKnown is false', () => {
  const r = unattributedKind({ ledgerPresent: undefined, sessionKnown: false });
  assert.equal(r, "no-session");
});

test('returns no-entry when ledgerPresent is undefined and sessionKnown is undefined', () => {
  const r = unattributedKind({ ledgerPresent: undefined, sessionKnown: undefined });
  assert.equal(r, "no-entry");
});

test('returns no-entry when ledgerPresent is null and sessionKnown is null', () => {
  const r = unattributedKind({ ledgerPresent: null, sessionKnown: null });
  assert.equal(r, "no-entry");
});

test('returns no-session when ledgerPresent is 0 and sessionKnown is false', () => {
  const r = unattributedKind({ ledgerPresent: 0, sessionKnown: false });
  assert.equal(r, "no-session");
});
