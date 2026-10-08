// The spine gate's decision table. The dangerous direction is "blocks when it should not" — a
// blocking gate that cries wolf gets uninstalled — so most cases assert SILENCE.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assess, render } from '../gate-spine-core.mjs';

const base = { edits: 20, spineRecords: [], tasks: [], history: [], minEdits: 5, ledgerPresent: true };

describe('the spine gate blocks only on the one condition it is for', () => {
  test('substantive edits with nothing filed → BLOCK', () => {
    const v = assess(base);
    assert.equal(v.block, true);
    assert.equal(v.reason, 'no-spine-record');
    assert.match(render(v), /list_plans/, 'the block must name the action that clears it');
    assert.match(render(v), /CW_SPINE_MIN_EDITS/, 'and the escape hatch, or it reads as unappealable');
  });

  test('edits WITH a filed record → silent', () => {
    const v = assess({ ...base, spineRecords: [{ task: '1', at: '2026-08-12T01:00:00Z' }] });
    assert.equal(v.block, false);
    assert.equal(v.reason, 'satisfied');
  });

  test('below the threshold → silent, however many records exist', () => {
    assert.equal(assess({ ...base, edits: 4 }).block, false);
    assert.equal(assess({ ...base, edits: 0 }).reason, 'below-threshold');
  });
});

describe('a blind sensor never blocks, and never reads as clean', () => {
  // Inverting the house fail-CLOSED rule, on purpose and only here: a wrong block costs the hook
  // itself. But a blind sensor must not read as clean, so both paths carry `grey`.
  test('no touch ledger → open, and STATED as unknown', () => {
    const v = assess({ ...base, ledgerPresent: false });
    assert.equal(v.block, false);
    assert.equal(v.reason, 'sensor-absent');
    assert.equal(v.grey, true);
    assert.match(v.detail, /UNKNOWN/);
    assert.match(v.detail, /not "no"/, 'absence of evidence must not be phrased as evidence of absence');
  });

  test('unreadable task store with nothing filed → open, and stated', () => {
    const v = assess({ ...base, tasks: null });
    assert.equal(v.block, false);
    assert.equal(v.reason, 'store-unreadable');
    assert.equal(v.grey, true);
  });

  test('an unreadable store does NOT excuse a session that filed nothing when the ledger is fine', () => {
    // tasks:null only reaches store-unreadable when there is also nothing filed. With records
    // present the store is only needed for the decoy arm, which is allowed to be blind.
    const v = assess({ ...base, tasks: null, spineRecords: [{ task: '1', at: '2026-08-12T01:00:00Z' }] });
    assert.equal(v.block, false);
    assert.equal(v.reason, 'satisfied');
  });
});

describe('the feedback arm — the loop is closed, so a decoy is visible', () => {
  const blockedAt = { block: true, at: '2026-08-12T01:00:00Z' };

  test('a task filed after a block that never leaves pending → BLOCK, named as a decoy', () => {
    const v = assess({
      ...base,
      history: [blockedAt],
      spineRecords: [{ task: '7', at: '2026-08-12T02:00:00Z' }],
      tasks: [{ id: '7', status: 'pending' }],
    });
    assert.equal(v.block, true);
    assert.equal(v.reason, 'decoy-suspected');
    assert.deepEqual(v.taskIds, ['7']);
    assert.match(render(v), /cheapest way to satisfy it/);
  });

  test('the same task, once it has actually moved → silent', () => {
    const v = assess({
      ...base,
      history: [blockedAt],
      spineRecords: [{ task: '7', at: '2026-08-12T02:00:00Z' }],
      tasks: [{ id: '7', status: 'active' }],
    });
    assert.equal(v.block, false);
    assert.equal(v.reason, 'satisfied');
  });

  test('work filed BEFORE the block is not judged by the decoy arm', () => {
    // otherwise a compliant session would be accused of gaming
    const v = assess({
      ...base,
      history: [blockedAt],
      spineRecords: [{ task: '3', at: '2026-08-12T00:30:00Z' }],
      tasks: [{ id: '3', status: 'pending' }],
    });
    assert.equal(v.block, false);
    assert.equal(v.reason, 'satisfied');
  });

  test('an UNREADABLE store never produces a decoy accusation', () => {
    // `moved` computed from `(tasks || [])` made a null store fire the arm — a false alarm aimed
    // at exactly the case that must never see one
    const v = assess({
      ...base, tasks: null,
      history: [{ block: true, at: '2026-08-12T01:00:00Z' }],
      spineRecords: [{ task: '7', at: '2026-08-12T02:00:00Z' }],
    });
    assert.equal(v.block, false, 'no evidence is not adverse evidence');
    assert.notEqual(v.reason, 'decoy-suspected');
  });

  test('with no prior block there is no decoy judgement at all', () => {
    const v = assess({
      ...base, history: [],
      spineRecords: [{ task: '9', at: '2026-08-12T02:00:00Z' }],
      tasks: [{ id: '9', status: 'pending' }],
    });
    assert.equal(v.block, false, 'a fresh pending task is normal — it is only suspicious as an ANSWER to a block');
  });
});

test('the threshold is honoured as given, so a session can be excused explicitly', () => {
  assert.equal(assess({ ...base, edits: 20, minEdits: 21 }).reason, 'below-threshold');
});
