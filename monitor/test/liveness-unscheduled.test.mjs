// node --test monitor/test/  — the liveness deadman is survivable: an area nothing will ever
// schedule reports `unscheduled` (rank 0) instead of EXPIRED forever. checkOne() takes a
// `scheduled` flag, exercised against scratch rollup.json fixtures.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOne, RANK } from '../liveness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'cw-liveness-')); });
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

// Builds <root>/<name>/rollup.json (+ a history/ dir unless withHistory:false) stamped `ageHours` old.
function makeArea(name, { ageHours, withHistory = true }) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (withHistory) mkdirSync(join(dir, 'history'), { recursive: true });
  const generated = new Date(Date.now() - ageHours * 3600_000).toISOString();
  const rollupPath = join(dir, 'rollup.json');
  // a real stamp — liveness classifies on the scan time inside sliceId; an unparseable one fails
  // closed to `unknown` and the age under test never applies
  const sliceId = `sweep-${generated.replace(/[-:T]/g, '').slice(0, 14)}`;
  writeFileSync(rollupPath, JSON.stringify({ sliceId, generated, freshness: { generated } }));
  // the fixture carries a verdict journal too, or the fresh cases would trip the journal lane's
  // alarm (that lane has its own suite)
  appendRecord(join(dir, 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-verdict', at: generated, sliceId, area: name });
  return rollupPath;
}

test('an old rollup for an UNDECLARED area reports unscheduled, ranked like fresh — never trips the deadman', () => {
  const p = makeArea('ghost-repo', { ageHours: 200 }); // 200h ago: EXPIRED by age alone (default expireMs=50h)
  const r = checkOne(p, 'ghost-repo', { scheduled: false });
  assert.equal(r.state, 'unscheduled');
  assert.equal(RANK[r.state], 0, 'unscheduled must never contribute to the deadman tripping');
  assert.match(r.line, /unscheduled/);
  assert.match(r.line, /not declared in monitor\/projects\.json areas\[\]/);
});

test('the SAME old rollup for a DECLARED area still reports expired, ranked to trip the deadman', () => {
  const p = makeArea('real-area', { ageHours: 200 });
  const r = checkOne(p, 'real-area', { scheduled: true });
  assert.equal(r.state, 'expired');
  assert.equal(RANK[r.state], 3, 'a genuinely scheduled area\'s stale data must still alarm — this is not a blanket silence');
});

test('a FRESH undeclared area still reports fresh, not unscheduled — good news needs no relabelling', () => {
  const p = makeArea('ghost-fresh', { ageHours: 1 });
  const r = checkOne(p, 'ghost-fresh', { scheduled: false });
  assert.equal(r.state, 'fresh');
  assert.equal(RANK[r.state], 0);
});

test('UNSCHEDULED outranks PENDING: a brand-new undeclared area (no history yet) is unscheduled, not "new"', () => {
  const p = makeArea('ghost-new', { ageHours: 200, withHistory: false });
  const r = checkOne(p, 'ghost-new', { scheduled: false });
  assert.equal(r.state, 'unscheduled');
});

test('a brand-new DECLARED area (no history yet) is still pending, not expired — unaffected by this change', () => {
  const p = makeArea('real-new', { ageHours: 200, withHistory: false });
  const r = checkOne(p, 'real-new', { scheduled: true });
  assert.equal(r.state, 'pending');
  assert.equal(RANK[r.state], 0);
});

test('day-one regression anchor: the real bug shape (old + undeclared, e.g. clientDRemote and other root-discovered repos) ranks 0, not 3', () => {
  const p = makeArea('clientDRemote-like', { ageHours: 79 }); // this machine's real observed age at write time
  const r = checkOne(p, 'clientDRemote-like', { scheduled: false });
  assert.equal(RANK[r.state], 0,
    'an area nothing will ever schedule must not be able to trip the deadman on its own, no matter its age');
});

test('an unreadable rollup still reports unknown regardless of scheduled — corruption is never silently OK', () => {
  const dir = join(root, 'corrupt-area');
  mkdirSync(dir, { recursive: true });
  const rollupPath = join(dir, 'rollup.json');
  writeFileSync(rollupPath, '{ not valid json');
  const scheduled = checkOne(rollupPath, 'corrupt-area', { scheduled: true });
  const unscheduled = checkOne(rollupPath, 'corrupt-area', { scheduled: false });
  assert.equal(scheduled.state, 'unknown');
  assert.equal(unscheduled.state, 'unknown', 'a cannot-read failure is not the same class as "not on the schedule"');
});
