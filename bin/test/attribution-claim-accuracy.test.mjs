// The attribution CLAIM's accuracy, pinned so it cannot regress silently. Twelve cases are truth
// BY CONSTRUCTION, so the population is fixed and re-runnable. Timestamps deliberately use the
// two REAL shapes — commits carry a local offset and second precision (git %cI), touches carry
// UTC with milliseconds — because the defect lived in the difference.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeFiles } from '../gate-tests-core.mjs';
import { attributionClaim } from '../gate-ratchet-core.mjs';

const ME = 'me000000-full-session-id';
const me = 'me000000';
const you = 'other111';
const L = (s, f, at) => JSON.stringify({ s, f, at });

const COMMIT = '2026-08-11T17:24:18+09:30';   // === 07:54:18Z
const AFTER = '2026-08-11T09:44:00.000Z';     // 110 min AFTER the commit — but sorts BEFORE it as text
const BEFORE = '2026-08-11T02:00:00.000Z';
const LATER = '2026-08-11T23:30:00.000Z';     // after the commit in both readings

const CASES = [
  { id: 'A1', truth: 'mine', files: ['a.mjs'], lines: [L(me, 'a.mjs', AFTER)], commit: COMMIT,
    why: 'only I am live; my touch postdates the commit but sorts before it as text' },
  { id: 'A2', truth: 'theirs', files: ['a.mjs'], lines: [L(you, 'a.mjs', AFTER)], commit: COMMIT,
    why: 'only they are live, same offset trap' },
  { id: 'A3', truth: 'mixed', files: ['a.mjs'], lines: [L(me, 'a.mjs', AFTER), L(you, 'a.mjs', LATER)], commit: COMMIT,
    why: 'we are BOTH live in the SAME file — the case the old shape could not express at all' },
  { id: 'A4', truth: 'mixed', files: ['a.mjs', 'b.mjs'], lines: [L(me, 'a.mjs', AFTER), L(you, 'b.mjs', LATER)], commit: COMMIT,
    why: 'disjoint: my live file and their live file' },
  { id: 'A5', truth: 'unknown', files: ['a.mjs'], lines: [L(me, 'a.mjs', BEFORE), L(you, 'a.mjs', BEFORE)], commit: COMMIT,
    why: 'every touch predates the commit: the dirt is real but genuinely unattributable' },
  { id: 'A6', truth: 'mine', files: ['a.mjs'], lines: [L(me, 'a.mjs', BEFORE)], commit: '',
    why: 'no commit for this path, so there is no boundary and every touch is live' },
  { id: 'A7', truth: 'theirs', files: ['a.mjs'], lines: [L(me, 'a.mjs', BEFORE), L(you, 'a.mjs', LATER)], commit: COMMIT,
    why: 'their touch is live; mine is on the far side of the boundary' },
  { id: 'A8', truth: 'mine', files: ['a.mjs'], lines: [L(me, 'a.mjs', '2026-08-11T07:54:18.500Z')], commit: COMMIT,
    why: 'a touch inside the commit\'s own second — %cI has no milliseconds, so the tie must fall live' },
  { id: 'A9', truth: 'unknown', files: ['a.mjs'], lines: [], commit: COMMIT,
    why: 'no ledger entry at all — the only true unknown' },
  { id: 'A10', truth: 'mixed', files: ['a.mjs', 'b.mjs', 'c.mjs'],
    lines: [L(me, 'a.mjs', AFTER), L(you, 'b.mjs', AFTER), L('third222', 'c.mjs', LATER)], commit: COMMIT,
    why: 'three sessions, one file each, one of them me' },
  { id: 'A11', truth: 'mixed', files: ['a.mjs', 'b.mjs'],
    lines: [L(me, 'a.mjs', AFTER), L(you, 'a.mjs', AFTER), L(you, 'b.mjs', LATER)], commit: COMMIT,
    why: 'a shared file PLUS a file only they hold' },
  { id: 'A12', truth: 'theirs', files: ['a.mjs'], lines: [L(you, 'a.mjs', LATER)], commit: COMMIT,
    why: 'plain live co-session touch, no trap — the control' },
];

const claimFor = (c) => attributionClaim(
  attributeFiles(c.files, ME, { ledgerLines: c.lines, committedAt: () => c.commit }),
  null,
);

for (const c of CASES) {
  test(`claim accuracy ${c.id}: ${c.truth} — ${c.why}`, () => {
    assert.equal(claimFor(c), c.truth);
  });
}

test('the whole population scores 12/12 — the number 23.5 could not honestly report', () => {
  const correct = CASES.filter((c) => claimFor(c) === c.truth).length;
  assert.equal(correct, CASES.length,
    `attribution claim accuracy fell to ${correct}/${CASES.length}. This suite is the ratchet on a metric that was once reported as 2/2 while its comparator was broken — a drop here means the claim is wrong again, not that the fixture is stale.`);
});

test('standing outranks every attribution — a reading that predates the turn was not added by it', () => {
  // making shared/mixed win over standing would reintroduce the removed accusation
  const shared = { mine: [], theirs: ['a.mjs'], shared: ['a.mjs'] };
  assert.equal(attributionClaim(shared, '2026-08-10T00:00:00Z'), 'standing');
});
