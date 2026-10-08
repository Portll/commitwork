// bin/test/spine-reconcile.test.mjs — the reconciler's floor.
//
// The module's whole value is that it distinguishes five answers a readability check collapses into
// two. So most of these tests are about the non-findings — absent store, absent ledger, unreadable,
// nothing-filed — because those are the ones a careless implementation reports as clean or as catastrophe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcile, summarise, planOf, viaOf,
  STORE_ABSENT, LEDGER_ABSENT, STORE_UNREADABLE, RECONCILED, DANGLING,
} from '../spine-reconcile-core.mjs';

const row = (plan, at = '2026-08-20T00:00:00.000Z') => ({ s: 'sess', plan, task: '1', at, kind: 'set_status' });

// ── The three non-findings ──────────────────────────────────────────────────

test('no store is UNKNOWN, never a finding — absence cannot evidence loss', () => {
  const r = reconcile({ ledgerRows: [row('p1')], storePlanIds: null, storePresent: false });
  assert.equal(r.verdict, STORE_ABSENT);
  assert.equal(r.grey, true);
  assert.equal(r.block, false);
  assert.equal(r.dangling.length, 0, 'a store that was never here cannot make a plan dangle');
  assert.match(r.detail, /not installed.*lost its contents|different states/);
});

test('a store present but unreadable is a FAULT, never an empty store', () => {
  const r = reconcile({ ledgerRows: [row('p1')], storePlanIds: null, storePresent: true });
  assert.equal(r.verdict, STORE_UNREADABLE);
  assert.equal(r.grey, true);
  assert.equal(r.dangling.length, 0, 'reporting 75 dangling from an unreadable store would invent a data-loss event');
});

test('an unreadable LEDGER is UNKNOWN, not "nothing was ever filed"', () => {
  const r = reconcile({ ledgerRows: null, storePlanIds: ['p1'], storePresent: true });
  assert.equal(r.verdict, STORE_UNREADABLE);
  assert.equal(r.planCount, null);
  assert.equal(r.storeCount, 1, 'what IS known is still reported');
});

test('an ABSENT ledger is its own UNKNOWN — not a read fault, and never pinned on the store', () => {
  const r = reconcile({ ledgerRows: null, ledgerPresent: false, storePlanIds: ['p1'], storePresent: true });
  assert.equal(r.verdict, LEDGER_ABSENT);
  assert.equal(r.verdict, 'ledger-absent');
  assert.equal(r.grey, true);
  assert.equal(r.block, false);
  assert.equal(r.planCount, null, 'absence is not "nothing was filed"');
  assert.equal(r.storeCount, 1, 'what IS known is still reported');
  assert.equal(r.bypass.rows, null);
  assert.match(r.bypass.witnesses, /not assessed/);
  assert.match(r.detail, /no spine ledger/);
  assert.equal(summarise(r), 'spine ledger absent — UNKNOWN, not a finding');
});

test('the store is decided first: an absent or unreadable store outranks an absent ledger', () => {
  assert.equal(reconcile({ ledgerRows: null, ledgerPresent: false, storePlanIds: null, storePresent: false }).verdict, STORE_ABSENT);
  assert.equal(reconcile({ ledgerRows: null, ledgerPresent: false, storePlanIds: null, storePresent: true }).verdict, STORE_UNREADABLE);
});

test('an empty ledger reconciles but is explicitly NOT a clean bill of health', () => {
  const r = reconcile({ ledgerRows: [], storePlanIds: ['p1'], storePresent: true });
  assert.equal(r.verdict, RECONCILED);
  assert.equal(r.planCount, 0);
  assert.match(r.detail, /not a clean bill of health/);
  assert.match(summarise(r), /not a clean result/);
});

// ── The finding ─────────────────────────────────────────────────────────────

test('every ledger plan present reconciles', () => {
  const r = reconcile({ ledgerRows: [row('p1'), row('p2')], storePlanIds: ['p1', 'p2', 'p3'], storePresent: true });
  assert.equal(r.verdict, RECONCILED);
  assert.equal(r.dangling.length, 0);
  assert.equal(r.coverage, 1);
  assert.equal(r.storeCount, 3, 'a store holding MORE than the ledger names is not a fault');
});

test('a plan the store does not hold is reported DANGLING, and never called lost', () => {
  const r = reconcile({
    ledgerRows: [row('kept'), row('gone'), row('gone'), row('gone')],
    storePlanIds: ['kept'], storePresent: true,
  });
  assert.equal(r.verdict, DANGLING);
  assert.equal(r.dangling.length, 1);
  assert.equal(r.dangling[0].plan, 'gone');
  assert.equal(r.dangling[0].rows, 3);
  assert.equal(r.danglingRows, 3);
  assert.match(r.detail, /DANGLING IS NOT LOST/, 'the observation is named, never the cause');
  assert.match(r.detail, /archived, pruned, or filed into a different store/);
});

test('coverage is over FILINGS, not plans — one heavily-filed plan going dangling costs more', () => {
  // 1 dangling plan of 2 (50% by plan), but it carries 9 of 10 filings (10% by row).
  const rows = [row('kept'), ...Array.from({ length: 9 }, () => row('gone'))];
  const r = reconcile({ ledgerRows: rows, storePlanIds: ['kept'], storePresent: true });
  assert.equal(r.dangling.length / r.planCount, 0.5);
  assert.equal(r.coverage, 0.1, 'row coverage must not be substitutable for plan coverage');
});

test('the report never blocks — a reporter that blocked on the measured 99% would be uninstalled', () => {
  for (const c of [
    { ledgerRows: [row('a')], storePlanIds: [], storePresent: true },
    { ledgerRows: [row('a')], storePlanIds: null, storePresent: false },
    { ledgerRows: null, storePlanIds: null, storePresent: true },
  ]) assert.equal(reconcile(c).block, false);
});

// ── Row handling ────────────────────────────────────────────────────────────

test('a row with no plan is not evidence about any plan, and is skipped rather than counted', () => {
  const r = reconcile({
    ledgerRows: [row('p1'), { s: 'x', at: '2026-08-20T00:00:00.000Z' }, { plan: null }, {}],
    storePlanIds: ['p1'], storePresent: true,
  });
  assert.equal(r.verdict, RECONCILED);
  assert.equal(r.planCount, 1);
  assert.equal(planOf({ plan: null }), null);
  assert.equal(planOf({ plan: '' }), null, 'an empty string is not a plan id');
});

test('the newest filing per plan is reported, and an unparseable clock costs the timestamp not the row', () => {
  const r = reconcile({
    ledgerRows: [
      row('gone', '2026-08-01T00:00:00.000Z'),
      row('gone', '2026-08-31T03:20:18.356Z'),
      { plan: 'gone', at: 'not-a-date' },
    ],
    storePlanIds: [], storePresent: true,
  });
  assert.equal(r.dangling[0].rows, 3, 'the row with a bad clock still counts as a filing');
  assert.equal(r.dangling[0].newest, '2026-08-31T03:20:18.356Z');
});

test('ordering is deterministic — worst first, ties broken by id, never by insertion order', () => {
  const rows = [row('zzz'), row('zzz'), row('aaa'), row('aaa'), row('mmm')];
  const a = reconcile({ ledgerRows: rows, storePlanIds: [], storePresent: true });
  const b = reconcile({ ledgerRows: [...rows].reverse(), storePlanIds: [], storePresent: true });
  assert.deepEqual(a.dangling.map((d) => d.plan), ['aaa', 'zzz', 'mmm']);
  assert.deepEqual(a.dangling.map((d) => d.plan), b.dangling.map((d) => d.plan),
    'same inputs in any order must produce byte-identical output');
});

// ── The measured case ───────────────────────────────────────────────────────

test('the shape measured on this box: one plan held, many named', () => {
  // 76 plans named, 1 held — the 2026-09-06/07 measurement, reduced to its structure.
  const rows = [];
  for (let i = 0; i < 75; i++) rows.push(row(`plan-${i}`));
  for (let i = 0; i < 10; i++) rows.push(row('commitwork-remediation-2026-08-29'));

  const r = reconcile({ ledgerRows: rows, storePlanIds: ['commitwork-remediation-2026-08-29'], storePresent: true });
  assert.equal(r.verdict, DANGLING);
  assert.equal(r.planCount, 76);
  assert.equal(r.dangling.length, 75);
  assert.equal(r.storeCount, 1);
  assert.ok(r.coverage < 0.12, 'the overwhelming majority of filings do not resolve');
  assert.match(summarise(r), /^DANGLING: 75\/76 plan\(s\) absent/);
});

// ── Route evidence: the F-3 inversion, pinned so it cannot recur ────────────

test('a via row witnesses the tool being UNAVAILABLE — never that it was reachable', () => {
  const r = reconcile({
    ledgerRows: [
      row('p1'),
      { ...row('p1'), via: 'spine/db.mjs direct — substrate MCP not attached to this session' },
    ],
    storePlanIds: ['p1'], storePresent: true,
  });
  assert.equal(r.bypass.rows, 1);
  assert.match(r.bypass.witnesses, /UNAVAILABLE/);
  assert.match(r.bypass.witnesses, /never evidence that the tool was reachable/,
    'the direction is stated ON the result so no consumer re-derives it backwards, as F-3 did');
});

test('the via reason survives VERBATIM — a marker whose text is discarded can only be counted', () => {
  const reason = 'spine/db.mjs direct — substrate MCP not attached to this session';
  const r = reconcile({
    ledgerRows: [{ ...row('p1'), via: reason }], storePlanIds: ['p1'], storePresent: true,
  });
  assert.equal(r.bypass.reasons[0].reason, reason, 'summarising this into a category loses the evidence');
  assert.deepEqual(r.bypass.reasons[0].plans, ['p1']);
  assert.equal(viaOf({ via: '' }), null, 'an empty marker is not a marker');
  assert.equal(viaOf({}), null);
});

test('bypass rows are counted even when the row names no plan', () => {
  // A bypass filing evidences the ROUTE whether or not it evidences a plan.
  const r = reconcile({
    ledgerRows: [{ s: 'x', at: '2026-08-30T00:00:00.000Z', via: 'direct' }],
    storePlanIds: [], storePresent: true,
  });
  assert.equal(r.bypass.rows, 1);
  assert.equal(r.planCount, 0, 'and it still contributes no plan');
});

test('a clean reconcile still reports route evidence — it matters most when nothing looks wrong', () => {
  const r = reconcile({
    ledgerRows: [{ ...row('p1'), via: 'direct' }], storePlanIds: ['p1'], storePresent: true,
  });
  assert.equal(r.verdict, RECONCILED);
  assert.equal(r.bypass.rows, 1, 'a verdict of reconciled must not suppress how the filings arrived');
});

test('bypass is NOT ASSESSED rather than zero when the ledger was never walked', () => {
  for (const c of [
    { ledgerRows: [row('a')], storePlanIds: null, storePresent: false },
    { ledgerRows: null, storePlanIds: ['a'], storePresent: true },
  ]) {
    const r = reconcile(c);
    assert.equal(r.bypass.rows, null, 'zero would claim we looked and found none');
    assert.match(r.bypass.witnesses, /not assessed/);
  }
});

test('bypass reason ordering is deterministic', () => {
  const rows = [
    { ...row('p'), via: 'bbb' }, { ...row('p'), via: 'aaa' },
    { ...row('p'), via: 'aaa' }, { ...row('p'), via: 'ccc' },
  ];
  const a = reconcile({ ledgerRows: rows, storePlanIds: ['p'], storePresent: true });
  const b = reconcile({ ledgerRows: [...rows].reverse(), storePlanIds: ['p'], storePresent: true });
  assert.deepEqual(a.bypass.reasons.map((x) => x.reason), ['aaa', 'bbb', 'ccc']);
  assert.deepEqual(a.bypass.reasons.map((x) => x.reason), b.bypass.reasons.map((x) => x.reason));
});
