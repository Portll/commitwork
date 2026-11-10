// Human-readable summary of a replay verdict (bin/spine-replay-core.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../spine-replay-core.mjs';

test('returns the unreadable message when verdict is LEDGER_UNREADABLE', () => {
  const r = summarise({ verdict: 'ledger-unreadable' });
  assert.equal(r, "spine ledger unreadable \u2014 UNKNOWN, not an empty ledger");
});

test('returns the nothing-to-replay message when verdict is NOTHING_TO_REPLAY', () => {
  const r = summarise({ verdict: 'nothing-to-replay' });
  assert.equal(r, "ledger names no plans \u2014 nothing to replay (not a clean result)");
});

test('returns the nothing-missing message with counts when verdict is NOTHING_MISSING', () => {
  const r = summarise({ verdict: 'nothing-missing', counts: { plansNamed: 3, tasksNamed: 7 } });
  assert.equal(r, "nothing missing: 3 plan(s), 7 task(s), all present");
});

test('returns the proposed skeletons message when verdict is a normal replay result', () => {
  const r = summarise({ verdict: 'replayed', counts: { plansProposed: 2, tasksProposed: 5 } });
  assert.equal(r, "2 plan skeleton(s) + 5 task skeleton(s) would be filed");
});

test('appends the partial suffix when partial is true and ledgerSkipped is set', () => {
  const r = summarise({ verdict: 'replayed', counts: { plansProposed: 1, tasksProposed: 4 }, partial: true, ledgerSkipped: 2 });
  assert.equal(r, "1 plan skeleton(s) + 4 task skeleton(s) would be filed (PARTIAL \u2014 2 unparseable line(s))");
});

test('omits the partial suffix when partial is false', () => {
  const r = summarise({ verdict: 'replayed', counts: { plansProposed: 1, tasksProposed: 4 }, partial: false });
  assert.equal(r, "1 plan skeleton(s) + 4 task skeleton(s) would be filed");
});

test('omits the partial suffix when partial is undefined', () => {
  const r = summarise({ verdict: 'replayed', counts: { plansProposed: 1, tasksProposed: 4 } });
  assert.equal(r, "1 plan skeleton(s) + 4 task skeleton(s) would be filed");
});

test('returns the unreadable message for a verdict that is not LEDGER_UNREADABLE but is a normal result', () => {
  const r = summarise({ verdict: 'replayed', counts: { plansProposed: 0, tasksProposed: 0 } });
  assert.equal(r, "0 plan skeleton(s) + 0 task skeleton(s) would be filed");
});
