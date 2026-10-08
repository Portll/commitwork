// node --test monitor/test/  — a FRESH rollup over a PARTIAL fleet is 'degraded', never 'fresh':
// warn like stale, never trip like expired (an area-scoped sweep carries the fleet-wide gap every
// night). Scratch rollup.json fixtures only, never the real reports/ tree.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOne, RANK } from '../liveness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'cw-liveness-cov-')); });
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

// Builds <root>/<name>/rollup.json stamped `ageHours` old, optionally carrying a coverage block.
function makeArea(name, { ageHours, coverage = undefined }) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'history'), { recursive: true }); // history present: 'pending' must not mask the states under test
  const generated = new Date(Date.now() - ageHours * 3600_000).toISOString();
  const rollupPath = join(dir, 'rollup.json');
  // sliceId must be a REAL stamp — liveness parses the scan time out of it and an unparseable
  // stamp fails closed to `unknown`. Derived from `generated` so the declared age is the age under test.
  const sliceId = `sweep-${generated.replace(/[-:T]/g, '').slice(0, 14)}`;
  writeFileSync(rollupPath, JSON.stringify({ sliceId, generated, freshness: { generated }, ...(coverage !== undefined ? { coverage } : {}) }));
  // the fixture carries a verdict journal too, or every case trips the journal lane's alarm —
  // that lane has its own suite and each must be able to fail alone
  appendRecord(join(dir, 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-verdict', at: generated, sliceId, area: name });
  return rollupPath;
}

// the degrade keys on `unsweptInScope` — repos THIS batch declared and did not cover. Keying on
// the fleet-wide `unswept` made all 27 areas permanently degraded: an always-on state is a
// background colour, not a deadman. The fleet number is still reported, just not alarmed on.
test('a FRESH rollup that missed repos IN ITS OWN SCOPE reports degraded — rank 1, warns, never reads healthy', () => {
  const p = makeArea('partial-scope', { ageHours: 1, coverage: { resolved: 63, swept: 18, unswept: ['client-b', 'client-d', 'internal-d'], unsweptInScope: ['alpha', 'beta'], scope: 'area-scoped' } });
  const r = checkOne(p, 'partial-scope', { scheduled: true });
  assert.equal(r.state, 'degraded');
  assert.equal(RANK[r.state], 1, 'degraded must warn (like stale), not trip the deadman (like expired)');
  assert.match(r.line, /alpha/, 'the line must name what was missed, not just count it');
  assert.match(r.line, /coverage void, not a clean one/);
});

test('a FRESH rollup whose own scope was fully covered stays fresh, even with a fleet-wide gap', () => {
  // this is every per-area nightly sweep — it must not read degraded or the state means nothing
  const p = makeArea('scope-complete', { ageHours: 1, coverage: { resolved: 63, swept: 18, unswept: ['client-b', 'client-d'], unsweptInScope: [], scope: 'area-scoped' } });
  const r = checkOne(p, 'scope-complete', { scheduled: true });
  assert.equal(r.state, 'fresh', 'a healthy area sweep carries the fleet gap by construction — alarming on it trains the operator to ignore the deadman');
  assert.match(r.line, /fleet: 2 of 63/, 'the fleet gap is still REPORTED, just not alarmed on');
});

test('a rollup predating unsweptInScope reports the fleet gap and says the in-scope figure is UNAVAILABLE', () => {
  // absence must not read as zero — a clean scope nobody measured is an unsupported pass
  const p = makeArea('old-shape', { ageHours: 1, coverage: { resolved: 63, swept: 18, unswept: ['client-b', 'client-d', 'internal-d'], scope: 'area-scoped' } });
  const r = checkOne(p, 'old-shape', { scheduled: true });
  assert.equal(r.state, 'fresh', 'an old rollup must not degrade on the fleet list — that is the always-on state again');
  assert.match(r.line, /in-scope coverage unavailable/, 'unmeasured must be stated, never implied fine');
  assert.match(r.line, /3 of 63/);
});

test('a FRESH rollup with an EMPTY unswept list stays fresh — full coverage needs no relabelling', () => {
  const p = makeArea('full-fleet', { ageHours: 1, coverage: { resolved: 18, swept: 18, unswept: [], scope: 'fleet-wide' } });
  const r = checkOne(p, 'full-fleet', { scheduled: true });
  assert.equal(r.state, 'fresh');
});

test('an EXPIRED rollup keeps its (worse) state; the coverage gap is appended to the line, never hidden', () => {
  const p = makeArea('old-partial', { ageHours: 200, coverage: { resolved: 10, swept: 4, unswept: ['a', 'b', 'c', 'd', 'e', 'f'], scope: 'unknown' } });
  const r = checkOne(p, 'old-partial', { scheduled: true });
  assert.equal(r.state, 'expired', 'the temporal deadman must still trip — degraded never masks expired');
  assert.equal(RANK[r.state], 3);
  assert.match(r.line, /6 of 10/, 'the gap is still reported on the non-fresh path');
});

test('an UNSCHEDULED area with a gap stays unscheduled (rank 0) — its message is the more actionable one', () => {
  const p = makeArea('ghost-partial', { ageHours: 200, coverage: { resolved: 5, swept: 1, unswept: ['w', 'x', 'y', 'z'], scope: 'unknown' } });
  const r = checkOne(p, 'ghost-partial', { scheduled: false });
  assert.equal(r.state, 'unscheduled');
  assert.equal(RANK[r.state], 0);
  assert.match(r.line, /4 of 5/, 'reported, never hidden — the gap still appears on the unscheduled line');
});

test('a rollup that PREDATES the coverage block is untouched — absence of the block is not evidence of a gap', () => {
  const p = makeArea('legacy-rollup', { ageHours: 1 });
  const r = checkOne(p, 'legacy-rollup', { scheduled: true });
  assert.equal(r.state, 'fresh');
  assert.doesNotMatch(r.line, /never swept|degraded/);
});
