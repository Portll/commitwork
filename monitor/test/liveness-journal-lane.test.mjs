// node --test monitor/test/  — the journal-health lane's ABSENT branch, split: absence beside a
// CURRENT rollup is a broken writer and ranks; absence beside a stale/expired/unscheduled one is
// an era gap and only reports — the alarm decays with freshness instead of firing forever.
// Scratch dirs, real stamps, never the live reports/ tree.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOne, RANK } from '../liveness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'cw-liveness-journal-')); });
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const stampOf = (iso) => `sweep-${iso.replace(/[-:T]/g, '').slice(0, 14)}`;

/**
 * <root>/<name>/rollup.json aged `ageHours`, plus an optional sweep-journal.jsonl beside it.
 * `journal: 'current' | 'behind' | undefined` — undefined means the file is absent, which is the
 * state this suite is about. Journal lines go through appendRecord so the hash chain is real:
 * a hand-rolled line would read as chain-broken and assert against a shape production never emits.
 */
function makeArea(name, { ageHours, coverage = undefined, journal = undefined }) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'history'), { recursive: true }); // history present: 'pending' must not mask the state under test
  const generated = new Date(Date.now() - ageHours * 3600_000).toISOString();
  const sliceId = stampOf(generated);
  const rollupPath = join(dir, 'rollup.json');
  writeFileSync(rollupPath, JSON.stringify({
    sliceId, generated, freshness: { generated },
    ...(coverage !== undefined ? { coverage } : {}),
  }));
  if (journal) {
    const jSlice = journal === 'behind'
      ? stampOf(new Date(Date.now() - (ageHours + 48) * 3600_000).toISOString())
      : sliceId;
    appendRecord(join(dir, 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-verdict', at: generated, sliceId: jSlice, area: name });
  }
  return rollupPath;
}

test('a FRESH rollup with NO journal alarms — a sweep ran and recorded nothing is a broken writer', () => {
  const p = makeArea('writer-dead', { ageHours: 1 });
  const r = checkOne(p, 'writer-dead', { scheduled: true });
  assert.equal(r.state, 'unjournaled', 'the state the lane could not reach before: never-written, not behind');
  assert.equal(RANK[r.state], 1, 'warn like stale — a lost verdict is not a dead area');
  assert.match(r.line, /NEVER WRITTEN/);
  assert.match(r.line, /broken writer, not an era gap/, 'the line must name which absence this is, or the reader relearns the ambiguity');
});

test('a STALE rollup with no journal only REPORTS — absence predating the writer must never alarm forever', () => {
  // a deadman that fires on a permanent state is a background colour
  const p = makeArea('era-gap', { ageHours: 200 });
  const r = checkOne(p, 'era-gap', { scheduled: true });
  assert.equal(r.state, 'expired', 'the temporal state stands on its own — the journal lane must not touch it');
  assert.match(r.line, /verdict journal: none recorded/);
  assert.doesNotMatch(r.line, /NEVER WRITTEN/);
});

test('an UNSCHEDULED area with no journal stays rank 0 — a ghost area is not a broken writer', () => {
  const p = makeArea('ghost', { ageHours: 200 });
  const r = checkOne(p, 'ghost', { scheduled: false });
  assert.equal(r.state, 'unscheduled');
  assert.equal(RANK[r.state], 0);
  assert.doesNotMatch(r.line, /NEVER WRITTEN/);
});

test('a FRESH rollup WITH a current journal stays fresh — the healthy case, and the one this fix must not break', () => {
  // the production steady state — the new alarm must not reach it
  const p = makeArea('healthy', { ageHours: 1, journal: 'current' });
  const r = checkOne(p, 'healthy', { scheduled: true });
  assert.equal(r.state, 'fresh');
  assert.doesNotMatch(r.line, /NEVER WRITTEN|BEHIND/);
});

test('a journal BEHIND its rollup keeps its own wording — the pre-existing branch is untouched', () => {
  const p = makeArea('lagging', { ageHours: 1, journal: 'behind' });
  const r = checkOne(p, 'lagging', { scheduled: true });
  assert.equal(r.state, 'unjournaled');
  assert.match(r.line, /BEHIND the rollup/);
  assert.doesNotMatch(r.line, /NEVER WRITTEN/, 'behind and never-written are different faults and must stay distinguishable');
});

test('a DEGRADED rollup with no journal keeps rank 1 and still names the missing writer', () => {
  // two independent faults on one area: the coverage gap owns the state, the journal gap still has
  // to be readable on the line or fixing the first one hides the second
  const p = makeArea('degraded-and-silent', {
    ageHours: 1,
    coverage: { resolved: 9, swept: 7, unswept: ['x'], unsweptInScope: ['x', 'y'], scope: 'area-scoped' },
  });
  const r = checkOne(p, 'degraded-and-silent', { scheduled: true });
  assert.equal(r.state, 'degraded', 'the worse-or-equal state stands; the journal lane never downgrades it');
  assert.equal(RANK[r.state], 1);
  assert.match(r.line, /coverage void/);
  assert.match(r.line, /NEVER WRITTEN/);
});
