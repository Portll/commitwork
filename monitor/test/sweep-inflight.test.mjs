// monitor/liveness.mjs + monitor/sweep.mjs — the start-marker deadman: a marker past the
// threshold is HUNG (rank 3) even beside a fresh rollup; unreadable/unparseable markers fail
// closed to hung; a young marker only reports; a declared area with no rollup and no marker is
// NEVER-SWEPT. sweep.mjs's wiring (write before scan, clear on publish) is asserted from source.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOne, readInflight, RANK, INFLIGHT_FILE } from '../liveness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const MAX = 4 * 60 * 60 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function area({ rollup, marker } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'cw-inflight-'));
  if (rollup !== undefined) writeFileSync(join(d, 'rollup.json'), typeof rollup === 'string' ? rollup : JSON.stringify(rollup));
  // a parseable rollup means a finished sweep, which writes its journal — a fixture without one
  // would trip the journal lane's alarm instead. The corrupt-rollup cases deliberately have none.
  if (rollup && typeof rollup === 'object' && rollup.sliceId) {
    appendRecord(join(d, 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-verdict', at: rollup.generated, sliceId: rollup.sliceId, area: 'a' });
  }
  if (marker !== undefined) writeFileSync(join(d, INFLIGHT_FILE), typeof marker === 'string' ? marker : JSON.stringify(marker));
  return d;
}
const opts = (extra = {}) => ({ nowMs: NOW, inflightMaxMs: MAX, ...extra });
// a CONFORMING stamp — liveness parses the scan time out of sliceId, and an unparseable one fails
// closed to `unknown`. The MARKER sliceIds below stay free-form: nothing parses them for a time.
const freshRollup = { sliceId: `sweep-${iso(60 * 60 * 1000).replace(/[-:T]/g, '').slice(0, 14)}`, generated: iso(60 * 60 * 1000), freshness: { generated: iso(60 * 60 * 1000) } };

describe('the start-marker deadman — a sweep that never finished is an alarm, not a silence', () => {
  test('a marker older than the threshold is HUNG even when the rollup beside it is fresh', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-y', startedAt: iso(MAX + 60000) } });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.equal(r.state, 'hung');
    assert.equal(RANK.hung, 3, 'hung must trip the deadman exit');
    assert.match(r.line, /HUNG/);
    assert.match(r.line, /sweep-y/, 'the line names the slice that never finished');
    assert.match(r.line, /never cleared/);
  });

  test('an UNPARSEABLE marker fails closed to hung — never ignored', () => {
    const d = area({ rollup: freshRollup, marker: '{ not json' });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.equal(r.state, 'hung');
    assert.match(r.line, /cannot be read/);
    assert.match(r.line, /failing closed/);
  });

  test('a marker with no parseable startedAt fails closed to hung', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-z' } });
    assert.equal(checkOne(join(d, 'rollup.json'), 'a', opts()).state, 'hung');
  });

  test('an UNREADABLE marker (permissions) fails closed to hung', (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('SKIPPED (not a silent pass): root ignores mode bits');
    const d = area({ rollup: freshRollup, marker: { startedAt: iso(1000) } });
    const _deny = denyRead(join(d, INFLIGHT_FILE));

    assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
    try { assert.equal(checkOne(join(d, 'rollup.json'), 'a', opts()).state, 'hung'); }
    finally { _deny.restore(); }
  });

  test('a YOUNG marker is reported in the line but never changes the state', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-now', startedAt: iso(10 * 60000) } });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.equal(r.state, 'fresh');
    assert.match(r.line, /sweep in flight \(started 10 min ago, slice sweep-now\)/);
  });

  test('no rollup + young marker = pending (a first sweep is running), not unknown', () => {
    const d = area({ marker: { sliceId: 'sweep-first', startedAt: iso(5 * 60000) } });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.equal(r.state, 'pending');
    assert.match(r.line, /first sweep in flight/);
  });

  test('no rollup + old marker = HUNG — the exact shape that hid client-d', () => {
    const d = area({ marker: { sliceId: 'sweep-dead', startedAt: iso(MAX * 3) } });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.equal(r.state, 'hung');
    assert.match(r.line, /no rollup at/);
  });

  test('a DECLARED area with no rollup and no marker is NEVER-SWEPT, visible and warned', () => {
    const d = area({});
    const r = checkOne(join(d, 'rollup.json'), 'a', opts({ missingOk: true }));
    assert.equal(r.state, 'never-swept');
    assert.equal(RANK['never-swept'], 1, 'visible as a warning — explicit uncertainty, and not an unclearable alarm either');
    assert.match(r.line, /NO rollup has ever been written/);
  });

  test('without missingOk (explicit single-path form) a missing rollup stays unknown', () => {
    const d = area({});
    assert.equal(checkOne(join(d, 'rollup.json'), 'a', opts()).state, 'unknown');
  });

  test('readInflight: only ENOENT means absent', () => {
    const d = area({});
    assert.deepEqual(readInflight(d, opts()), { verdict: 'none' });
  });
});

describe('sweep.mjs wiring — the marker is written before scanning and cleared only on publish', () => {
  const src = readFileSync(join(HERE, '..', 'sweep.mjs'), 'utf8');
  test('the marker write precedes the scan loop and the clear is gated on rollupPublished', () => {
    const writeAt = src.indexOf('renameSync(tmp, INFLIGHT)');
    const scanAt = src.indexOf('── SCAN, optionally in parallel');
    const clearAt = src.indexOf('rmSync(INFLIGHT');
    const gateAt = src.indexOf('if (rollupPublished)');
    assert.ok(writeAt > -1 && scanAt > -1 && clearAt > -1 && gateAt > -1, 'marker wiring not found in sweep.mjs');
    assert.ok(writeAt < scanAt, 'the marker must be written BEFORE any scanning starts');
    assert.ok(gateAt < clearAt && clearAt > src.indexOf('rollup.mjs\'), batchDir'), 'the clear must come after the rollup phase and be gated on publish');
  });
  test('the marker filename is the one liveness watches', () => {
    assert.ok(src.includes(`'${INFLIGHT_FILE}'`) || src.includes(INFLIGHT_FILE), 'sweep.mjs and liveness.mjs must agree on the marker path');
  });
});

describe('the PID is the discriminator, not the age', () => {
  // Measured 2026-08-23: client-a ran 605 min with a live pid, a current log mtime and 289MB written
  // — healthy, and reported HUNG for six hours because this check looked only at age. It is a
  // 34-project area and crosses 4h on every normal run; so does 100randomrepos. Meanwhile the real
  // hangs of 2026-08-20 (pids 36023, 90944) had been dead for hours and age alone would have stayed
  // quiet for four of them.
  const LIVE = process.pid;          // certainly alive
  const DEAD = 2_147_483_646;        // no such process

  test('THE REGRESSION: a live pid past the threshold is OVERRUNNING, never hung', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-long', startedAt: iso(605 * 60000), pid: LIVE } });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.equal(r.state, 'overrunning', 'a running sweep must not be reported as one that died');
    assert.match(r.line, /OVERRUNNING/);
    assert.match(r.line, /is ALIVE/, 'the line must say WHY it is not hung — the evidence, not just the verdict');
  });

  test('overrunning WARNS and does not trip the deadman exit', () => {
    assert.equal(RANK.overrunning, 1,
      'rank 3 would fail the gate on every healthy long run, which is how a reader learns to ignore it');
    assert.ok(RANK.overrunning < RANK.hung, 'a long sweep is not as bad as a dead one');
  });

  test('a DEAD pid is hung AT ANY AGE — stronger than the old threshold, not weaker', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-dead', startedAt: iso(30 * 60000), pid: DEAD } });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.equal(r.state, 'hung', 'a marker whose process is gone is a hang even 30 minutes in');
    assert.equal(RANK.hung, 3);
    assert.match(r.line, /DEAD/);
  });

  test('a live pid UNDER the threshold is still just in flight', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-young', startedAt: iso(10 * 60000), pid: LIVE } });
    const r = checkOne(join(d, 'rollup.json'), 'a', opts());
    assert.notEqual(r.state, 'hung');
    assert.notEqual(r.state, 'overrunning');
  });

  test('a marker with NO pid keeps the old age-only posture exactly', () => {
    // Markers written before pids were recorded must not become quietly un-alarmable — the fallback
    // preserves today's answer rather than inventing a gentler one.
    const old = area({ rollup: freshRollup, marker: { sliceId: 'sweep-nopid', startedAt: iso(MAX + 60000) } });
    assert.equal(checkOne(join(old, 'rollup.json'), 'a', opts()).state, 'hung');
    const young = area({ rollup: freshRollup, marker: { sliceId: 'sweep-nopid2', startedAt: iso(60000) } });
    assert.notEqual(checkOne(join(young, 'rollup.json'), 'a', opts()).state, 'hung');
  });

  test('a non-integer pid is unprobeable and falls back to age, reporting why', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-badpid', startedAt: iso(MAX + 60000), pid: 'nonsense' } });
    assert.equal(checkOne(join(d, 'rollup.json'), 'a', opts()).state, 'hung');
    const r = readInflight(d, { nowMs: NOW, inflightMaxMs: MAX });
    assert.equal(r.pidState, 'unprobeable');
  });

  test('pid 0 is refused rather than probed — kill(0,0) signals the whole process group', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-zero', startedAt: iso(MAX + 60000), pid: 0 } });
    assert.equal(readInflight(d, { nowMs: NOW, inflightMaxMs: MAX }).pidState, 'unprobeable');
  });

  test('readInflight reports the pid and its state, so a reader can check the verdict', () => {
    const d = area({ rollup: freshRollup, marker: { sliceId: 'sweep-x', startedAt: iso(605 * 60000), pid: LIVE } });
    const r = readInflight(d, { nowMs: NOW, inflightMaxMs: MAX });
    assert.equal(r.verdict, 'overrunning');
    assert.equal(r.pid, LIVE);
    assert.equal(r.pidState, 'alive');
  });
});
