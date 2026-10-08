// monitor/test/migrate-line-keys.test.mjs — the D12 migration: adopt on contact, collapse
// deliberately. A place can hold SEVERAL legacy records (the line kept them apart). The migration
// is deliberately UNWIRED — flipping the mint first would file a duplicate beside every record.
import test from 'node:test';
import assert from 'node:assert/strict';

import { migrateLineKeys, mintIssue, verifyChain } from '../issue-store.mjs';

const AT = '2026-08-14T00:00:00.000Z';
const doc0 = () => ({ version: 1, nextOrdinal: 0, byKey: {}, events: [], issues: {}, lastIngest: {} });
const add = (doc, key, over = {}) => mintIssue(doc, {
  area: 'a', repo: 'r', kind: 'code', severity: 'high', title: 't',
  source: { kind: 'scanner-row', key, tool: 'sastCodeql', rule: 'js/xss' },
  ...over,
}, over.createdAt || '2026-08-01T00:00:00.000Z');

const PLACE = 'sc:r|sastCodeql|js/xss|a.js';

test('ONE legacy record ADOPTS the line-free key — no collapse, no closure, id preserved', () => {
  const doc = doc0();
  const { id } = add(doc, `${PLACE}|42`);
  const r = migrateLineKeys(doc, [PLACE], { at: AT });

  assert.deepEqual(r.adopted.map((a) => a.id), [id]);
  assert.equal(r.collapsed.length, 0);
  assert.equal(doc.issues[id].source.key, PLACE, 're-keyed in place');
  assert.deepEqual(doc.issues[id].priorKeys, [`${PLACE}|42`], 'the old key is kept — an identity change leaves a trail');
  assert.equal(doc.byKey[PLACE], id, 'reachable by the new key');
  assert.equal(doc.byKey[`${PLACE}|42`], undefined, 'and not by the old one');
  assert.equal(doc.issues[id].state, 'open', 'adoption never closes anything');
  assert.ok(doc.events.some((e) => e.type === 'issue-key-migrated' && e.issueId === id),
    'the migration is IN the chain, not a silent field swap');
});

test('TWO legacy records COLLAPSE — one survives re-keyed, the other is superseded, neither vanishes', () => {
  const doc = doc0();
  const older = add(doc, `${PLACE}|10`, { createdAt: '2026-06-01T00:00:00.000Z' });
  const newer = add(doc, `${PLACE}|99`, { createdAt: '2026-08-01T00:00:00.000Z', severity: 'crit' });
  const r = migrateLineKeys(doc, [PLACE], { at: AT });

  assert.equal(r.collapsed.length, 1);
  assert.equal(r.collapsed[0].id, older.id, 'the oldest live record is elected (chooseSurvivor)');
  assert.deepEqual(r.collapsed[0].absorbed, [newer.id]);

  const s = doc.issues[older.id];
  assert.equal(s.source.key, PLACE);
  assert.equal(s.severity, 'crit', 'and it inherits the WORST severity — a collapse must not forgive a crit');
  assert.equal(s.createdAt, '2026-06-01T00:00:00.000Z', 'while keeping the earliest clock');
  assert.ok(s.priorKeys.includes(`${PLACE}|10`) && s.priorKeys.includes(`${PLACE}|99`),
    'both keys survive on the survivor');

  const a = doc.issues[newer.id];
  assert.equal(a.state, 'closed');
  assert.equal(a.closedAs, 'superseded', 'absorbed, not deleted — a deleted id is a dangling citation');
  assert.equal(a.deps.supersededBy, older.id, 'and it says where it went');
  assert.equal(doc.byKey[`${PLACE}|99`], newer.id,
    'the absorbed record KEEPS its historical key and its index slot — unbinding it while it still '
    + 'claims the key leaves it "indexed by nobody", which is the orphan this migration removes');
  assert.equal(doc.byKey[PLACE], older.id, 'and the place resolves to the survivor — two keys, two slots, no contention');
});

test('a CLOSED record never wins the place from a live one', () => {
  // a first-member rule would collapse an open finding into a closed one and close it
  const doc = doc0();
  const closed = add(doc, `${PLACE}|10`, { createdAt: '2026-06-01T00:00:00.000Z' });
  doc.issues[closed.id].state = 'closed';
  doc.issues[closed.id].closedAs = 'fixed';
  const live = add(doc, `${PLACE}|99`, { createdAt: '2026-08-01T00:00:00.000Z' });

  migrateLineKeys(doc, [PLACE], { at: AT });
  assert.equal(doc.byKey[PLACE], live.id, 'the live record holds the place');
  assert.equal(doc.issues[live.id].state, 'open', 'and it is still open');
});

test('nothing legacy at the place is a NO-OP — a genuinely new finding files normally', () => {
  const doc = doc0();
  const r = migrateLineKeys(doc, ['sc:r|sastCodeql|js/other|b.js'], { at: AT });
  assert.deepEqual(r, { adopted: [], collapsed: [], skipped: [] });
  assert.equal(doc.events.length, 0, 'no events for a migration that had nothing to migrate');
});

test('a target that STILL CARRIES A LINE is refused, not migrated onto', () => {
  // Re-keying records onto an identity that still moves would rebuild the defect being removed.
  const doc = doc0();
  add(doc, `${PLACE}|10`);
  const r = migrateLineKeys(doc, [`${PLACE}|77`], { at: AT });
  assert.equal(r.adopted.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].why, /still carries a line/);
});

test('IDEMPOTENT — a second run migrates nothing and appends no events', () => {
  const doc = doc0();
  add(doc, `${PLACE}|42`);
  migrateLineKeys(doc, [PLACE], { at: AT });
  const eventsAfterFirst = doc.events.length;

  const second = migrateLineKeys(doc, [PLACE], { at: AT });
  assert.deepEqual(second, { adopted: [], collapsed: [], skipped: [] }, 'nothing left to do');
  assert.equal(doc.events.length, eventsAfterFirst, 'and a re-run does not pollute the chain');
});

test('dryRun reports the same decisions and mutates nothing', () => {
  const doc = doc0();
  const a = add(doc, `${PLACE}|10`, { createdAt: '2026-06-01T00:00:00.000Z' });
  add(doc, `${PLACE}|99`);
  const before = JSON.stringify(doc);
  const r = migrateLineKeys(doc, [PLACE], { at: AT, dryRun: true });
  assert.equal(r.collapsed.length, 1);
  assert.equal(r.collapsed[0].id, a.id);
  assert.equal(JSON.stringify(doc), before, 'the store is untouched');
});

test('the store still verifies after a collapse — no broken chain, no orphaned key', () => {
  // verifyChain returns a LIST of problems; empty is the pass — asserting `.ok` was green against undefined
  const doc = doc0();
  add(doc, `${PLACE}|10`, { createdAt: '2026-06-01T00:00:00.000Z' });
  add(doc, `${PLACE}|99`);
  migrateLineKeys(doc, [PLACE], { at: AT });
  const problems = verifyChain(doc);
  assert.ok(Array.isArray(problems), 'verifyChain returns a problem list, not a verdict object');
  assert.deepEqual(problems, [], `store invalid after migration: ${JSON.stringify(problems).slice(0, 300)}`);
});
