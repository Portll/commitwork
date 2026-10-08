// bin/test/gate-spine-overwatch-outage.test.mjs
//
// The gate could not tell NOTHING FILED from NOWHERE TO FILE. Both arrive as zero spine records and
// they warrant opposite responses, so it blocked sessions that had no overwatch layer at all — a block no
// session could clear, which is how a gate teaches its reader to stop reading it.
//
// This file asserts BOTH directions separately, because only one of them lies to you. The exemption
// firing when it should is a convenience; the exemption firing when it should NOT is a hole in a
// blocking integrity gate, and that is the direction with its own tests below.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assess, overwatchReachability, render } from '../gate-spine-core.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const at = (ms) => new Date(NOW - ms).toISOString();
const reach = (o) => overwatchReachability({ now: NOW, outageMs: DAY, ...o });

describe('the two witnesses', () => {
  test('a recent spine row proves reachability — somebody filed', () => {
    assert.equal(reach({ spineRows: [{ at: at(2 * HOUR) }], dbMtimeMs: NOW - 90 * DAY }), true);
  });

  test('THE SECOND WITNESS: ledger stale but the SERVER wrote lately — still reachable', () => {
    // The hook could be uninstalled while the overwatch layer itself is fine. tasks.db is written by a
    // different process in a different repo, so it cannot fail the same way the ledger does.
    assert.equal(reach({ spineRows: [{ at: at(9 * DAY) }], dbMtimeMs: NOW - 30 * 60_000 }), true);
  });

  test('both witnesses stalled is an OUTAGE — the only shape that earns the exemption', () => {
    assert.equal(reach({ spineRows: [{ at: at(9 * DAY) }], dbMtimeMs: NOW - 9 * DAY }), false);
  });

  test('NO STORE AT ALL is unknown, not an outage — absence is not evidence', () => {
    // "never installed" and "died" are different states and only one is an outage. It is also the
    // cheapest exemption available: deleting one file outside this repo must not buy a pass.
    assert.equal(reach({ spineRows: [{ at: at(9 * DAY) }], dbMtimeMs: null }), 'unknown');
  });

  test('FAILS CLOSED: an UNREADABLE store is unknown, never an outage', () => {
    // Permissions, a lock, a moved schema. Unreadable must not buy an exemption — that would make
    // "break the sensor" the cheapest route to a pass.
    assert.equal(reach({ spineRows: [{ at: at(9 * DAY) }], dbMtimeMs: undefined }), 'unknown');
  });

  test('an empty or absent ledger is unknown — the recorder arms already own that case', () => {
    assert.equal(reach({ spineRows: [], dbMtimeMs: NOW - 9 * DAY }), 'unknown');
    assert.equal(reach({ spineRows: null, dbMtimeMs: NOW - 9 * DAY }), 'unknown');
  });

  test('rows with no parseable clock are unknown, not treated as infinitely old', () => {
    assert.equal(reach({ spineRows: [{ at: 'not-a-date' }, {}], dbMtimeMs: NOW - 9 * DAY }), 'unknown');
  });

  test('a broken clock (bad CW_NOW) yields unknown rather than a spurious outage', () => {
    assert.equal(overwatchReachability({
      spineRows: [{ at: at(9 * DAY) }], dbMtimeMs: NOW - 9 * DAY, now: NaN, outageMs: DAY,
    }), 'unknown');
  });

  test('the newest row wins, not the first or last in file order', () => {
    const rows = [{ at: at(9 * DAY) }, { at: at(1 * HOUR) }, { at: at(5 * DAY) }];
    assert.equal(reach({ spineRows: rows, dbMtimeMs: NOW - 9 * DAY }), true);
  });

  test('deterministic — identical inputs, identical verdict', () => {
    const args = { spineRows: [{ at: at(9 * DAY) }], dbMtimeMs: NOW - 9 * DAY };
    assert.equal(reach(args), reach(args));
  });
});

describe('the gate decision — both directions', () => {
  const base = { edits: 7, spineRecords: [], tasks: [], minEdits: 5 };

  test('NOWHERE TO FILE: an outage reports grey and does NOT block', () => {
    const v = assess({ ...base, overwatchReachable: false });
    assert.equal(v.block, false);
    // The verdict id was renamed on 2026-08-30 for the public release. The sampler still CLASSIFIES
    // the pre-rename spelling (8 stored records carry it) via GATE_REGISTRY's `retired` list — this
    // asserts what is EMITTED, which must be the new id only. The old spelling is deliberately not
    // written here: it is a redacted identity, and a test that names one re-adds what Phase C removes.
    assert.equal(v.reason, 'overwatch-unreachable');
    assert.equal(v.grey, true, 'must be grey — an outage is not a clean session');
  });

  test('THE DIRECTION THAT MATTERS: overwatch-layer reachable and nothing filed still BLOCKS', () => {
    // If this ever goes false the gate has a hole, not a feature.
    const v = assess({ ...base, overwatchReachable: true });
    assert.equal(v.block, true);
    assert.equal(v.reason, 'no-spine-record');
  });

  test('INERT BY DEFAULT: omitting the input leaves the old behaviour exactly', () => {
    // Proves the change cannot alter any caller that has not been taught to supply evidence.
    const v = assess({ ...base });
    assert.equal(v.block, true);
    assert.equal(v.reason, 'no-spine-record');
  });

  test('unknown reachability blocks — absence of evidence is not evidence of an outage', () => {
    const v = assess({ ...base, overwatchReachable: 'unknown' });
    assert.equal(v.block, true);
  });

  test('an outage does not swallow a session that DID file — that path stays satisfied', () => {
    const v = assess({
      ...base, spineRecords: [{ task: 't1', at: at(HOUR) }], tasks: [{ id: 't1', status: 'doing' }],
      overwatchReachable: false,
    });
    assert.equal(v.reason, 'satisfied');
  });

  test('below threshold still wins — an outage never upgrades a trivial session', () => {
    const v = assess({ ...base, edits: 1, overwatchReachable: false });
    assert.equal(v.reason, 'below-threshold');
  });

  test('ORDERING: a broken recorder is reported as broken, not as an outage', () => {
    // Opposite fixes: one is "restore the overwatch layer", the other is "fix the hook". The sensor-health
    // arms must win, or the outage message sends the reader to the wrong repair.
    const absent = assess({ ...base, spineLedgerPresent: false, overwatchReachable: false });
    assert.equal(absent.reason, 'spine-ledger-absent');
    const corrupt = assess({ ...base, spineLedgerCorrupt: true, overwatchReachable: false });
    assert.equal(corrupt.reason, 'spine-ledger-unreadable');
    const noTouch = assess({ ...base, ledgerPresent: false, overwatchReachable: false });
    assert.equal(noTouch.reason, 'sensor-absent');
  });
});

describe('what the reader is told', () => {
  test('GREY, NOT GREEN: the outage never reads like a satisfied session', () => {
    const outage = render(assess({ edits: 7, spineRecords: [], tasks: [], overwatchReachable: false }));
    const clean = render(assess({
      edits: 7, spineRecords: [{ task: 't1', at: at(HOUR) }], tasks: [{ id: 't1', status: 'doing' }],
    }));
    assert.match(outage, /UNKNOWN/, 'an outage must be visibly unknown');
    assert.doesNotMatch(clean, /UNKNOWN/);
    assert.notEqual(outage, clean);
  });

  test('it names the repair, so the reader is not left to guess', () => {
    const msg = render(assess({ edits: 7, spineRecords: [], tasks: [], overwatchReachable: false }));
    assert.match(msg, /overwatch-layer's MCP server/i);
    assert.match(msg, /NOWHERE TO FILE|nowhere to file/);
  });
});
