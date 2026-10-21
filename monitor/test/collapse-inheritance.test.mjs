// monitor/test/collapse-inheritance.test.mjs — what survives when two issues turn out to be one
// (D12: identity is line-free). The invariant is PER-PLACE, not per-fleet: no surviving place may
// be LESS breached, or LESS severe, than the worst member it absorbed — fleet counts falling is
// simply what merging does.
import test from 'node:test';
import assert from 'node:assert/strict';

import { collapseInheritance, chooseSurvivor, slaDueAt } from '../issue-store.mjs';

const iss = (o = {}) => ({
  id: 'ISS-000001', severity: 'high', createdAt: '2026-08-01T00:00:00.000Z',
  reopenCount: 0, suspect: false, attemptCount: 0, priorKeys: [],
  source: { key: 'sc:r|sastCodeql|js/xss|a.js|10' }, ...o,
});
const AT = '2026-08-13T00:00:00.000Z';
const breached = (i, now) => new Date(i.slaDueAt).getTime() < new Date(now).getTime();

test('the survivor inherits the EARLIEST createdAt — the clock is never restarted', () => {
  const keep = iss({ id: 'A', createdAt: '2026-08-10T00:00:00.000Z' });
  const gone = iss({ id: 'B', createdAt: '2026-07-01T00:00:00.000Z' });
  const r = collapseInheritance(keep, [gone], { at: AT });
  assert.equal(r.createdAt, '2026-07-01T00:00:00.000Z', 'the older origin wins, whichever record survives');
  assert.equal(r.slaDueAt, slaDueAt('2026-07-01T00:00:00.000Z', 'high'), 'and the clock is recomputed from it');
});

test('A SURVIVOR IS NEVER LESS BREACHED THAN WHAT IT ABSORBED — the defect this rule exists to stop', () => {
  // keep the survivor's own createdAt and the breach vanishes — remediation by arithmetic
  const now = '2026-08-13T00:00:00.000Z';
  const fresh = iss({ id: 'A', createdAt: '2026-08-12T00:00:00.000Z', severity: 'high' });
  const old = iss({ id: 'B', createdAt: '2026-06-01T00:00:00.000Z', severity: 'high' });
  fresh.slaDueAt = slaDueAt(fresh.createdAt, 'high');
  old.slaDueAt = slaDueAt(old.createdAt, 'high');

  const before = [fresh, old].filter((i) => breached(i, now)).length;
  assert.equal(before, 1, 'precondition: exactly one of the two is past due');

  const r = collapseInheritance(fresh, [old], { at: AT });
  const after = breached(r, now) ? 1 : 0;
  assert.ok(after >= before,
    `the collapse forgave a breach: ${before} breached before, ${after} after. A correctness fix `
    + 'that lowers the overdue count without anyone fixing anything is remediation by arithmetic.');
});

test('severity is the same defect one field over — the WORST is inherited', () => {
  const r = collapseInheritance(iss({ severity: 'high' }), [iss({ id: 'B', severity: 'crit' })], { at: AT });
  assert.equal(r.severity, 'crit', 'collapsing a crit into a high must not forgive the crit');
  assert.equal(r.slaDueAt, slaDueAt(r.createdAt, 'crit'), 'and the clock follows the severity it inherited');
});

test('unknown severity does not outrank a real one', () => {
  // SEV_RANK puts unknown between med and high — no promotion over scored, no demoting a crit
  assert.equal(collapseInheritance(iss({ severity: 'crit' }), [iss({ id: 'B', severity: 'unknown' })], { at: AT }).severity, 'crit');
  assert.equal(collapseInheritance(iss({ severity: 'low' }), [iss({ id: 'B', severity: 'unknown' })], { at: AT }).severity, 'unknown');
});

test('every key the absorbed issues were known by is kept — a collapse leaves a trail', () => {
  const keep = iss({ id: 'A', priorKeys: ['sc:r|sastCodeql|js/xss|a.js|3'] });
  const gone = iss({ id: 'B', source: { key: 'sc:r|sastCodeql|js/xss|a.js|91' }, priorKeys: ['sc:r|sastCodeql|js/xss|a.js|88'] });
  const r = collapseInheritance(keep, [gone], { at: AT });
  assert.deepEqual(r.priorKeys.sort(), [
    'sc:r|sastCodeql|js/xss|a.js|3', 'sc:r|sastCodeql|js/xss|a.js|88', 'sc:r|sastCodeql|js/xss|a.js|91',
  ], 'the absorbed key AND its own history survive — dropping them is silent mutation in a migration costume');
  assert.deepEqual(r.absorbedFrom.map((a) => a.id), ['B'], 'and the record says what it swallowed');
});

test('judgement carries — being merged does not make an issue clean', () => {
  const r = collapseInheritance(
    iss({ id: 'A', suspect: false, reopenCount: 0, attemptCount: 0 }),
    [iss({ id: 'B', suspect: true, reopenCount: 3, attemptCount: 2 })],
    { at: AT });
  assert.equal(r.suspect, true, 'a suspect sibling makes the survivor suspect');
  assert.equal(r.reopenCount, 3, 'reopens are history, not the survivor\'s personal record');
  assert.equal(r.attemptCount, 2);
});

test('authorityRequired is NOT inherited — it is a ruling, recomputed at ingest', () => {
  const r = collapseInheritance(iss({ authorityRequired: true }), [iss({ id: 'B' })], { at: AT });
  assert.equal('authorityRequired' in r, false,
    'inheriting it would let a stale flag outlive the ruling (D11) that set it');
});

// ── which record survives ─────────────────────────────────────────────────────────────────────
// chooseSurvivor replaces insertion order with a total order

test('a LIVE record always beats a closed one — a migration must not close a finding', () => {
  const closedOld = iss({ id: 'A', state: 'closed', createdAt: '2026-01-01T00:00:00.000Z' });
  const openNew = iss({ id: 'B', state: 'open', createdAt: '2026-08-01T00:00:00.000Z' });
  assert.equal(chooseSurvivor([closedOld, openNew]).id, 'B',
    'the open finding survives even though the closed one is older — otherwise the collapse closes it');
  assert.equal(chooseSurvivor([openNew, closedOld]).id, 'B', 'and the input order does not change that');
});

test('among live records the OLDEST survives — it is the id everything else points at', () => {
  const older = iss({ id: 'B', createdAt: '2026-07-01T00:00:00.000Z' });
  const newer = iss({ id: 'A', createdAt: '2026-08-01T00:00:00.000Z' });
  assert.equal(chooseSurvivor([newer, older]).id, 'B',
    'oldest wins on age, not on id — A sorts first alphabetically and still loses');
});

test('when every member is closed, a closed record survives rather than nothing', () => {
  const a = iss({ id: 'A', state: 'closed', createdAt: '2026-03-01T00:00:00.000Z' });
  const b = iss({ id: 'B', state: 'closed', createdAt: '2026-02-01T00:00:00.000Z' });
  assert.equal(chooseSurvivor([a, b]).id, 'B');
});

test('DETERMINISTIC under permutation — the answer never depends on iteration order', () => {
  // The whole reason chooseSurvivor exists. Same set, every ordering, one answer.
  const members = [
    iss({ id: 'C', createdAt: '2026-05-01T00:00:00.000Z', evidence: [1, 2] }),
    iss({ id: 'A', createdAt: '2026-05-01T00:00:00.000Z', evidence: [1] }),
    iss({ id: 'B', createdAt: '2026-05-01T00:00:00.000Z', evidence: [1, 2] }),
  ];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const picks = new Set(perms.map((p) => chooseSurvivor(p.map((i) => members[i])).id));
  assert.deepEqual([...picks], ['B'],
    'same createdAt, so evidence count breaks the tie (B and C have 2, A has 1), then id (B < C)');
});

test('the survivor already holds the earliest clock, so inheritance cannot get it wrong', () => {
  // electing the oldest live record makes the createdAt inheritance a no-op — the rules cannot disagree
  const members = [
    iss({ id: 'A', createdAt: '2026-08-01T00:00:00.000Z' }),
    iss({ id: 'B', createdAt: '2026-06-01T00:00:00.000Z' }),
  ];
  const keep = chooseSurvivor(members);
  const r = collapseInheritance(keep, members.filter((m) => m !== keep), { at: AT });
  assert.equal(r.createdAt, keep.createdAt, 'no inherited change to the clock — the right record was elected');
});

test('a collapse of one is not a collapse', () => {
  assert.equal(collapseInheritance(iss(), [], { at: AT }), null);
  assert.equal(collapseInheritance(iss(), [null], { at: AT }), null);
});
