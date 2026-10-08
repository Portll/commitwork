// Admission control for concurrent sweeps: the permit count must be a real bound, and running out
// of permits must be LOUD rather than a quiet extra sweep.
//
// The failure being guarded is not hypothetical. Eleven sweeps ran at once on 2026-08-21 because
// nothing bounded them; the box reached load 87 with 1GB free of 48, and per-repo throughput fell
// from 2.6 to 30 minutes. A semaphore that hands out unlimited permits under contention would
// reproduce that exactly while appearing to fix it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireSweepSlot, slotName, DEFAULT_SLOTS } from '../sweep-slot.mjs';

const fresh = () => mkdtempSync(join(tmpdir(), 'cw-slot-'));

describe('sweep admission control', () => {
  test('hands out exactly `slots` permits and no more', () => {
    const d = fresh();
    const a = acquireSweepSlot(d, { slots: 2, label: 'a' });
    const b = acquireSweepSlot(d, { slots: 2, label: 'b' });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notEqual(a.slot, b.slot, 'two holders must not share one permit');

    // Third caller with no time to wait: must be refused, not admitted.
    const c = acquireSweepSlot(d, { slots: 2, label: 'c', deadlineMs: 0 });
    assert.equal(c.ok, false, 'a third sweep must be refused while both permits are held');
    assert.match(c.reason, /slots held/);
    a.release(); b.release();
    rmSync(d, { recursive: true, force: true });
  });

  test('a released permit is reusable — the bound is concurrent, not lifetime', () => {
    const d = fresh();
    const a = acquireSweepSlot(d, { slots: 1, label: 'a' });
    assert.equal(a.ok, true);
    assert.equal(acquireSweepSlot(d, { slots: 1, deadlineMs: 0 }).ok, false);
    a.release();
    const b = acquireSweepSlot(d, { slots: 1, label: 'b' });
    assert.equal(b.ok, true, 'the permit must return to the pool on release');
    b.release();
    rmSync(d, { recursive: true, force: true });
  });

  test('a refused acquire NEVER reports ok — the truthy-object trap', () => {
    // acquireLock returns {ok:false,…} on failure and an object is truthy, so `if (got)` would take
    // every contended slot as acquired and hand out unlimited permits. This asserts the field.
    const d = fresh();
    const held = acquireSweepSlot(d, { slots: 1 });
    const refused = acquireSweepSlot(d, { slots: 1, deadlineMs: 0 });
    assert.equal(refused.ok, false);
    assert.equal(refused.slot, undefined, 'a refusal must not carry a slot number');
    assert.equal(typeof refused.release, 'undefined', 'a refusal must not carry a release()');
    held.release();
    rmSync(d, { recursive: true, force: true });
  });

  test('waits for a permit, and gives up at the deadline rather than never returning', () => {
    // Clock and sleep are injected: a waiting loop tested against the real clock is slow AND cannot
    // exercise the timeout branch, which is the branch that decides whether an area gets swept.
    const d = fresh();
    const held = acquireSweepSlot(d, { slots: 1 });
    let clock = 0;
    const waited = [];
    const r = acquireSweepSlot(d, {
      slots: 1, deadlineMs: 90_000,
      now: () => clock, sleep: (ms) => { waited.push(ms); clock += ms; },
    });
    assert.equal(r.ok, false, 'must give up rather than spin forever');
    assert.ok(waited.length >= 2, `must actually have waited between passes (slept ${waited.length}x)`);
    assert.ok(r.waitedMs >= 90_000, 'must report how long it waited, for the deferral message');
    held.release();
    rmSync(d, { recursive: true, force: true });
  });

  test('slot files are named per index, so a stuck holder is identifiable on disk', () => {
    assert.equal(slotName(0), '.sweep-slot-0.lock');
    assert.notEqual(slotName(0), slotName(1));
    assert.ok(DEFAULT_SLOTS >= 1);
  });
});
