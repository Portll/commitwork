// The queue in front of the sweep permits: arrival order, coalescing, abandoned tickets, and the fairness it buys.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostname, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enqueue, readQueue, reapQueue, listQueue, renderQueue, queueDirFor, TICKET_STALE_MS, QUEUE_REAP_JOURNAL } from '../sweep-queue.mjs';
import { acquireSweepSlot } from '../sweep-slot.mjs';
import { ownStartMs } from '../lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'sweep-queue.mjs');
const DEAD_PID = 2_147_483_646;
const fresh = () => mkdtempSync(join(tmpdir(), 'cw-queue-'));
const names = (root) => { try { return readdirSync(queueDirFor(root)).sort(); } catch (e) { return e.code; } };

// A ticket written by hand, as a departed waiter leaves it
function plant(root, { pid, label, at, enqueuedAt = at, startedAt = ownStartMs(), host = hostname() }) {
  const dir = queueDirFor(root);
  mkdirSync(dir, { recursive: true });
  const t = { v: 1, pid, nonce: `planted-${label}`, label, area: label, group: 'all', host, startedAt, enqueuedAt, at, deadlineAt: null };
  const path = join(dir, `${String(enqueuedAt).padStart(15, '0')}-${pid}-${t.nonce}.json`);
  writeFileSync(path, JSON.stringify(t));
  return { ...t, path };
}

describe('tickets', () => {
  test('arrival order is the order, whatever the labels sort as', () => {
    const root = fresh();
    try {
      const c = enqueue(root, { label: 'sweep:c', nowMs: 1_000 });
      const a = enqueue(root, { label: 'sweep:a', nowMs: 2_000 });
      const b = enqueue(root, { label: 'sweep:b', nowMs: 3_000 });
      for (const t of [a, b, c]) assert.equal(t.ok, true);
      assert.deepEqual(readQueue(root, { nowMs: 4_000 }).waiting.map((w) => w.label), ['sweep:c', 'sweep:a', 'sweep:b']);
      assert.equal(b.position(4_000).index, 2);
      assert.deepEqual(b.position(4_000).ahead.map((w) => w.label), ['sweep:c', 'sweep:a']);
      assert.equal(c.position(4_000).index, 0);
      a.leave();
      assert.equal(b.position(4_000).index, 1, 'a leaver closes the gap');
      b.leave(); c.leave();
      assert.equal(names(root), 'ENOENT', 'the last leaver removes the empty queue directory — no debris under the reports root');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a second ticket under a waiting label is coalesced, naming the one it joined', () => {
    const root = fresh();
    try {
      const first = enqueue(root, { label: 'sweep:x', nowMs: 1_000 });
      const again = enqueue(root, { label: 'sweep:x', nowMs: 61_000 });
      assert.equal(again.ok, false);
      assert.equal(again.reason, 'coalesced');
      assert.equal(again.duplicate.nonce, first.ticket.nonce);
      assert.equal(again.duplicate.waitedMs, 60_000);
      assert.equal(readQueue(root, { nowMs: 61_000 }).waiting.length, 1, 'nothing was written for the coalesced caller');
      const other = enqueue(root, { label: 'sweep:y', nowMs: 61_000 });
      assert.equal(other.ok, true, 'a different label is a different scope and queues');
      first.leave(); other.leave();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('touch() re-stamps, and re-creates a ticket a reaper took, at its original place', () => {
    const root = fresh();
    try {
      const a = enqueue(root, { label: 'sweep:a', nowMs: 1_000 });
      const b = enqueue(root, { label: 'sweep:b', nowMs: 2_000 });
      rmSync(a.path);
      assert.equal(a.position(3_000).index, Infinity, 'off disk, it has no place');
      assert.equal(a.touch(3_000).ok, true);
      assert.equal(a.position(3_000).index, 0, 'back at the front: the filename carries the enqueue instant');
      assert.equal(JSON.parse(readFileSync(a.path, 'utf8')).at, 3_000);
      a.leave(); b.leave();
      assert.equal(a.touch(4_000).ok, false, 'a left ticket is not re-created');
      assert.equal(names(root), 'ENOENT');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a dead pid, a reused pid past the grace, and a stopped stamp are abandoned; a live waiter is not', () => {
    const root = fresh();
    try {
      const now = 10 * 60_000;
      plant(root, { pid: DEAD_PID, label: 'dead', at: now });
      plant(root, { pid: process.pid, label: 'stopped', at: now - TICKET_STALE_MS });
      // A ticket whose stamp is fresh but whose pid-start is an hour off: held, as a slot would be
      plant(root, { pid: process.pid, label: 'mismatch-fresh', at: now, startedAt: ownStartMs() - 3_600_000 });
      plant(root, { pid: process.pid, label: 'mismatch-old', at: now - TICKET_STALE_MS, startedAt: ownStartMs() - 3_600_000 });
      plant(root, { pid: process.pid, label: 'live', at: now - 30_000 });
      const q = readQueue(root, { nowMs: now });
      assert.equal(q.ok, true);
      assert.deepEqual(q.waiting.map((w) => w.label).sort(), ['live', 'mismatch-fresh']);
      assert.deepEqual(Object.fromEntries(q.abandoned.map((a) => [a.label, a.why])), {
        dead: 'pid dead', stopped: `stamp stopped ${TICKET_STALE_MS / 1000}s old`, 'mismatch-old': 'pid reused',
      });
      const dry = reapQueue(root, { nowMs: now });
      assert.equal(dry.applied, false);
      assert.equal(names(root).length, 5, 'a dry run removes nothing');
      const r = reapQueue(root, { nowMs: now, apply: true });
      assert.equal(r.applied, true);
      assert.deepEqual(r.reaped.map((x) => x.label).sort(), ['dead', 'mismatch-old', 'stopped']);
      assert.ok(r.reaped.every((x) => x.recorded), 'every reap is journaled');
      assert.deepEqual(r.failed, []);
      assert.deepEqual(readQueue(root, { nowMs: now }).waiting.map((w) => w.label).sort(), ['live', 'mismatch-fresh']);
      const journal = readFileSync(join(root, QUEUE_REAP_JOURNAL), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(journal.length, 3);
      assert.ok(journal.every((j) => j.kind === 'sweep-queue-reaped' && typeof j.pid === 'number' && j.why));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an unreadable ticket is listed and keeps its place; it is never dropped as absent', () => {
    const root = fresh();
    try {
      plant(root, { pid: process.pid, label: 'live', at: 5_000, enqueuedAt: 5_000 });
      writeFileSync(join(queueDirFor(root), '000000000001000-1-garbage.json'), '{not json');
      const q = readQueue(root, { nowMs: 6_000 });
      assert.equal(q.ok, true);
      assert.equal(q.unreadable.length, 1);
      assert.equal(q.waiting.length, 1);
      assert.equal(reapQueue(root, { nowMs: 6_000, apply: true }).reaped.length, 0, 'unreadable is not abandoned');
      assert.ok(existsSync(join(queueDirFor(root), '000000000001000-1-garbage.json')));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('what the queue buys the permits', () => {
  test('a permit that frees goes to the longest waiter, not to whoever polls first', () => {
    const root = fresh();
    let b = null;
    try {
      const a = acquireSweepSlot(root, { slots: 1, label: 'sweep:a' });
      assert.equal(a.ok, true);
      assert.equal(names(root), 'ENOENT', 'an admitted sweep holds no ticket');
      let clock = 0;
      let late = null;
      b = acquireSweepSlot(root, {
        slots: 1, label: 'sweep:b', deadlineMs: 600_000, now: () => clock,
        sleep: (ms) => {
          clock += ms;
          if (late) return;
          // A third sweep arrives while b waits: the slot is still held, and when it frees it must be b's
          late = acquireSweepSlot(root, { slots: 1, label: 'sweep:c', deadlineMs: 0, now: () => clock });
          a.release();
        },
      });
      assert.equal(late.ok, false, 'the newcomer is refused');
      assert.match(late.reason, /queued behind 1 sweep\(s\)/);
      assert.equal(late.queue.position, 1);
      assert.deepEqual(late.queue.ahead.map((w) => w.label), ['sweep:b']);
      assert.equal(late.holders.length, 1, 'a waiter that never probed still names the holders');
      assert.equal(late.holders[0].holder.label, 'sweep:a');
      assert.equal(b.ok, true, 'b was admitted on the pass after the release');
      assert.equal(b.queue.position, 0);
      assert.ok(b.waitedMs > 0);
      assert.equal(names(root), 'ENOENT', 'both tickets are gone');
    } finally { if (b && b.ok) b.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a same-scope arrival while one waits is coalesced through acquireSweepSlot', () => {
    const root = fresh();
    let b = null;
    try {
      const a = acquireSweepSlot(root, { slots: 1, label: 'sweep:a' });
      let clock = 0;
      let twin = null;
      b = acquireSweepSlot(root, {
        slots: 1, label: 'sweep:b', deadlineMs: 600_000, now: () => clock,
        sleep: (ms) => { clock += ms; if (twin) return; twin = acquireSweepSlot(root, { slots: 1, label: 'sweep:b', deadlineMs: 0, now: () => clock }); a.release(); },
      });
      assert.equal(twin.ok, false);
      assert.ok(twin.coalesced, 'the refusal carries the ticket it joined');
      assert.match(twin.reason, /^coalesced — sweep:b is already queued as pid \d+/);
      assert.deepEqual(twin.holders, []);
      assert.equal(b.ok, true);
    } finally { if (b && b.ok) b.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a stale ticket in front does not hold the queue: it is judged abandoned and the live waiter is at the head', () => {
    const root = fresh();
    try {
      const now = 60 * 60_000;
      plant(root, { pid: DEAD_PID, label: 'sweep:ghost', at: now - 1000, enqueuedAt: 1000 });
      const got = acquireSweepSlot(root, { slots: 1, label: 'sweep:live', deadlineMs: 0, now: () => now });
      assert.equal(got.ok, true, 'admitted: the dead ticket ahead is not a waiter');
      assert.equal(got.queue.position, 0);
      got.release();
      assert.deepEqual(names(root).length, 1, 'the ghost ticket is left for the reaper to journal, never silently dropped');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('queue: false leaves the bare permit race and writes nothing', () => {
    const root = fresh();
    try {
      const a = acquireSweepSlot(root, { slots: 1, label: 'sweep:a', queue: false });
      const b = acquireSweepSlot(root, { slots: 1, label: 'sweep:b', queue: false, deadlineMs: 0 });
      assert.equal(a.ok, true); assert.equal(b.ok, false);
      assert.match(b.reason, /slots held/);
      assert.equal(names(root), 'ENOENT');
      a.release();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('the operator surface', () => {
  test('list renders permits and queue, --json carries both, reap without --apply removes nothing, bad usage exits 2', () => {
    const root = fresh();
    let held = null;
    try {
      held = acquireSweepSlot(root, { slots: 2, label: 'sweep:held' });
      plant(root, { pid: process.pid, label: 'sweep:waiting', at: Date.now() - 30_000, enqueuedAt: Date.now() - 120_000 });
      plant(root, { pid: DEAD_PID, label: 'sweep:ghost', at: Date.now() - 1000, enqueuedAt: Date.now() - 1000 });
      const l = listQueue(root);
      assert.equal(l.ok, true);
      assert.equal(l.slots.length, 1, 'only the permits that exist on disk are listed');
      assert.equal(l.slots[0].holder.label, 'sweep:held');
      assert.deepEqual(l.waiting.map((w) => w.label), ['sweep:waiting']);
      assert.deepEqual(l.abandoned.map((w) => w.label), ['sweep:ghost']);
      const text = renderQueue(l);
      assert.match(text, /sweep permits: 1/); assert.match(text, /pid \d+ \(sweep:held\)/);
      assert.match(text, /1\. pid \d+ \(sweep:waiting\) waited 2 min/); assert.match(text, /abandoned: pid \d+ \(sweep:ghost\) — pid dead/);

      const json = spawnSync(process.execPath, [CLI, 'list', root, '--json'], { encoding: 'utf8' });
      assert.equal(json.status, 0, json.stderr);
      const parsed = JSON.parse(json.stdout);
      assert.equal(parsed.waiting.length, 1); assert.equal(parsed.slots.length, 1);
      const dry = spawnSync(process.execPath, [CLI, 'reap', root], { encoding: 'utf8' });
      assert.equal(dry.status, 0, dry.stderr);
      assert.equal(JSON.parse(dry.stdout).applied, false);
      assert.equal(names(root).length, 2);
      const usage = spawnSync(process.execPath, [CLI, 'tidy', root], { encoding: 'utf8' });
      assert.equal(usage.status, 2);
      const self = spawnSync(process.execPath, [CLI, 'list', root, '--prefix', 'self'], { encoding: 'utf8' });
      assert.equal(self.status, 0);
      assert.match(self.stdout, /self queue: 0 waiting \(no queue directory yet\)/);
    } finally { if (held && held.ok) held.release(); rmSync(root, { recursive: true, force: true }); }
  });
});
