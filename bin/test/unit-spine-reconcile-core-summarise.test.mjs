// one-line human summary of a reconcile verdict (bin/spine-reconcile-core.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../spine-reconcile-core.mjs';

test('returns the store-absent summary when the verdict is store-absent', () => {
  assert.equal(summarise({ verdict: 'store-absent' }), "spine store absent \u2014 UNKNOWN, not a finding");
});

test('returns the ledger-absent summary when the verdict is ledger-absent', () => {
  assert.equal(summarise({ verdict: 'ledger-absent' }), "spine ledger absent \u2014 UNKNOWN, not a finding");
});

test('returns the unreadable summary when the verdict is store-unreadable', () => {
  assert.equal(summarise({ verdict: 'store-unreadable' }), "spine store or ledger unreadable \u2014 a fault, not an empty store");
});

test('returns the empty-ledger reconciled summary when planCount is zero', () => {
  assert.equal(summarise({ verdict: 'reconciled', planCount: 0 }), "ledger names no plans \u2014 nothing to reconcile (not a clean result)");
});

test('returns the populated reconciled summary when planCount is one', () => {
  assert.equal(summarise({ verdict: 'reconciled', planCount: 1 }), "reconciled: 1 plan(s), all present");
});

test('returns the dangling summary with a null coverage shown as n/a', () => {
  assert.equal(summarise({ verdict: 'dangling-referents', planCount: 3, dangling: [{ plan: 'a' }, { plan: 'b' }, { plan: 'c' }], danglingRows: 2, coverage: null }), "DANGLING: 3/3 plan(s) absent from the store, 2 filing(s) affected, n/a of filings still resolve");
});

test('returns the dangling summary with a numeric coverage formatted to one decimal', () => {
  assert.equal(summarise({ verdict: 'dangling-referents', planCount: 4, dangling: [{ plan: 'a' }, { plan: 'b' }], danglingRows: 3, coverage: 0.5 }), "DANGLING: 2/4 plan(s) absent from the store, 3 filing(s) affected, 50.0% of filings still resolve");
});

test('returns the dangling summary with a full coverage of one', () => {
  assert.equal(summarise({ verdict: 'dangling-referents', planCount: 2, dangling: [{ plan: 'a' }], danglingRows: 1, coverage: 1 }), "DANGLING: 1/2 plan(s) absent from the store, 1 filing(s) affected, 100.0% of filings still resolve");
});
