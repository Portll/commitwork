// node --test bin/test/ — hunk attribution's three states. The one that must never collapse is
// SUPERSEDED: "someone replaced my edit" and "I cannot tell what happened to it" are different
// facts, and merging them is the failure this module was written to avoid. Most of these tests are
// the cases where a naive implementation would answer confidently and wrongly.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATE, attributeFile, claimants, reobserve, rowsForFile } from '../lib/touch-attribution.mjs';

const at = (n) => `2026-08-23T00:00:${String(n).padStart(2, '0')}.000Z`;
const edit = (s, f, h, n, i) => ({ s, f, at: at(i), h, n, t: 'edit' });
const write = (s, f, n, i) => ({ s, f, at: at(i), n, t: 'write' });

describe('the three states', () => {
  test('an unreplaced edit is STANDING — the affirmative state, and it is labelled weakly on purpose', () => {
    const rows = [edit('alice', 'a.mjs', 'h1', 'n1', 1)];
    const [a] = attributeFile(rows, 'a.mjs');
    assert.equal(a.state, STATE.STANDING);
    assert.equal(a.supersededBy, null);
  });

  test('the CHAIN proves supersession — a later h equal to this n, exactly, no heuristics', () => {
    const rows = [edit('alice', 'a.mjs', 'h1', 'n1', 1), edit('bob', 'a.mjs', 'n1', 'n2', 2)];
    const [first, second] = attributeFile(rows, 'a.mjs');
    assert.equal(first.state, STATE.SUPERSEDED);
    assert.equal(first.supersededBy, 'bob', 'SUPERSEDED must name who consumed it — "replaced by nobody" is not a fact');
    assert.equal(second.state, STATE.STANDING);
  });

  test('a whole-file WRITE after a claim makes it UNKNOWN, never STANDING', () => {
    // A write obliterates hunks without leaving a chain link. Reporting STANDING here would be a
    // guess dressed as a finding — the exact shape this module exists to refuse.
    const rows = [edit('alice', 'a.mjs', 'h1', 'n1', 1), write('bob', 'a.mjs', 'n9', 2)];
    const [a] = attributeFile(rows, 'a.mjs');
    assert.equal(a.state, STATE.UNKNOWN);
    assert.equal(a.supersededBy, null);
  });

  test('SUPERSEDED and UNKNOWN are never collapsed — the whole point', () => {
    const rows = [
      edit('alice', 'a.mjs', 'h1', 'n1', 1),
      edit('bob', 'a.mjs', 'n1', 'n2', 2),   // proves it replaced alice
      edit('carol', 'a.mjs', 'hX', 'n3', 3), // unrelated, then a write lands after it
      write('dave', 'a.mjs', 'n4', 4),
    ];
    const byN = Object.fromEntries(attributeFile(rows, 'a.mjs').map((a) => [a.n, a.state]));
    assert.equal(byN.n1, STATE.SUPERSEDED, 'proved replaced');
    assert.equal(byN.n3, STATE.UNKNOWN, 'fate undecidable after a whole-file write');
    assert.notEqual(byN.n1, byN.n3, 'these two must never be the same state');
  });

  test('a REVERT does not attribute the original text to the reverter', () => {
    // bob replaces alice's n1 with n2; carol reverts, replacing n2 with n1 again. carol authored a
    // revert, not alice's original — the chain says exactly that and nothing more.
    const rows = [
      edit('alice', 'a.mjs', 'h0', 'n1', 1),
      edit('bob', 'a.mjs', 'n1', 'n2', 2),
      edit('carol', 'a.mjs', 'n2', 'n1', 3),
    ];
    const out = attributeFile(rows, 'a.mjs');
    assert.equal(out[0].supersededBy, 'bob');
    assert.equal(out[1].supersededBy, 'carol');
    assert.equal(out[2].session, 'carol');
    assert.equal(out[2].state, STATE.STANDING);
  });
});

describe('scoping and shape', () => {
  test('rows for OTHER files never leak into a file\'s attribution', () => {
    const rows = [edit('alice', 'a.mjs', 'h1', 'n1', 1), edit('bob', 'b.mjs', 'n1', 'n2', 2)];
    const [a] = attributeFile(rows, 'a.mjs');
    assert.equal(a.state, STATE.STANDING, 'b.mjs consuming the same fingerprint must not supersede a.mjs');
  });

  test('rows with no fingerprint make no hunk claim — a Bash commit row is touched, not standing', () => {
    const rows = [
      { s: 'alice', f: 'a.mjs', at: at(1), via: 'commit', sha: 'abc1234' },
      edit('bob', 'a.mjs', 'h1', 'n1', 2),
    ];
    assert.equal(attributeFile(rows, 'a.mjs').length, 1, 'only the fingerprinted row is a claim');
    const c = claimants(rows, 'a.mjs');
    assert.deepEqual(c.standing, ['bob']);
    assert.ok(c.touched.includes('alice'), 'alice touched the file and must be visible as such');
    assert.equal(c.standing.includes('alice'), false, 'but a commit row is not a hunk claim');
  });

  test('claimants returns a SET, never one owner', () => {
    const rows = [edit('alice', 'a.mjs', 'h1', 'n1', 1), edit('bob', 'a.mjs', 'h2', 'n2', 2)];
    const c = claimants(rows, 'a.mjs');
    assert.deepEqual(c.standing, ['alice', 'bob'], 'two independent edits are two candidates, not a winner');
  });

  test('out-of-order rows are sorted before the chain is walked', () => {
    const rows = [edit('bob', 'a.mjs', 'n1', 'n2', 2), edit('alice', 'a.mjs', 'h1', 'n1', 1)];
    const out = attributeFile(rows, 'a.mjs');
    assert.equal(out[0].session, 'alice');
    assert.equal(out[0].state, STATE.SUPERSEDED, 'chronology must come from `at`, not array order');
  });

  test('an empty ledger yields an empty attribution, not a throw', () => {
    assert.deepEqual(attributeFile([], 'a.mjs'), []);
    assert.deepEqual(attributeFile(null, 'a.mjs'), []);
    assert.deepEqual(rowsForFile(undefined, 'a.mjs'), []);
  });
});

describe('O2 — re-observation, because a cached verdict goes stale', () => {
  test('a STANDING claim that has since been replaced is REPORTED as changed, not left standing', () => {
    const before = [edit('alice', 'a.mjs', 'h1', 'n1', 1)];
    const prior = attributeFile(before, 'a.mjs');
    assert.equal(prior[0].state, STATE.STANDING);

    const after = [...before, edit('bob', 'a.mjs', 'n1', 'n2', 2)];
    const { attribution, changes } = reobserve(prior, after, 'a.mjs');
    assert.equal(attribution[0].state, STATE.SUPERSEDED);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].from, STATE.STANDING);
    assert.equal(changes[0].to, STATE.SUPERSEDED);
  });

  test('a claim that vanished from the ledger is flagged — the rotation tell', () => {
    // If a reader did not walk the chain, prior claims silently disappear. That must surface as a
    // change, not as a quiet shrink of the denominator.
    const prior = attributeFile([edit('alice', 'a.mjs', 'h1', 'n1', 1)], 'a.mjs');
    const { changes } = reobserve(prior, [], 'a.mjs');
    assert.equal(changes[0].to, 'absent');
    assert.match(changes[0].why, /rotation|did not walk the chain/);
  });

  test('nothing changed means no changes reported — re-observation is not noise', () => {
    const rows = [edit('alice', 'a.mjs', 'h1', 'n1', 1)];
    assert.deepEqual(reobserve(attributeFile(rows, 'a.mjs'), rows, 'a.mjs').changes, []);
  });
});
