// A5 · the three unknowns, which were previously two because one flag answered two questions.
//
// THE DEFECT. `gate-tests.mjs` spread `ledgerPresent: true` over the result of `attributeFiles`
// even when `mySession` was null — and with no session, attributeFiles returns EVERY file as
// `unknown`. The reporter then chose its message on `ledgerPresent` alone and printed "Dirty, no
// ledger entry at all", which is a false statement about a ledger that had just been read
// perfectly. The comparator was missing, not the evidence.
//
// `mySession` is reachable as null: bin/gate-tests.mjs derives it from `?.session_id || null`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unattributedKind } from '../gate-tests-core.mjs';

test('THE DEFECT: ledger read, session missing → no-session, NOT no-entry', () => {
  assert.equal(unattributedKind({ ledgerPresent: true, sessionKnown: false }), 'no-session',
    'saying "no ledger entry" here blames the evidence for the absence of a comparator');
});

test('ledger unreadable wins, even when the session is known', () => {
  assert.equal(unattributedKind({ ledgerPresent: false, sessionKnown: true }), 'no-ledger');
});

test('ledger unreadable AND no session is still no-ledger — nothing was checked at all', () => {
  assert.equal(unattributedKind({ ledgerPresent: false, sessionKnown: false }), 'no-ledger');
});

test('only a readable ledger AND a known session earns "nobody touched them"', () => {
  assert.equal(unattributedKind({ ledgerPresent: true, sessionKnown: true }), 'no-entry',
    'this is the ONLY state that is a claim about the files rather than about the check');
});

test('a legacy result carrying neither field is not treated as an outage', () => {
  assert.equal(unattributedKind({}), 'no-entry');
  assert.equal(unattributedKind(), 'no-entry',
    'callers predating these fields must keep their existing behaviour, not start alarming');
});
