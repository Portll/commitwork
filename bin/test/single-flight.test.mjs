import test from 'node:test';
import assert from 'node:assert/strict';
import { holderAlive, readHolder, acquire, release } from '../lib/single-flight.mjs';

// A fake process table. `exists` is signal-0; `startedAt` is the epoch SECONDS ps would report.
const io = (procs, files = {}) => ({
  exists: (pid) => Object.prototype.hasOwnProperty.call(procs, pid),
  startedAt: (pid) => (procs[pid] === undefined ? null : procs[pid]),
  read: (p) => (p in files ? files[p] : null),
  remove: (p) => { delete files[p]; },
  writeNew: (p, text) => { if (p in files) return 'EEXIST'; files[p] = text; return true; },
  _files: files,
});

test('a holder whose pid is gone is dead — only ESRCH proves absence', () => {
  assert.equal(holderAlive({ pid: 999, pidStart: 1_000_000_000_000 }, io({})), false);
});

test('a holder whose pid AND start time match is alive', () => {
  assert.equal(holderAlive({ pid: 42, pidStart: 1_788_677_533_409 }, io({ 42: 1_788_677_533 })), true);
});

test('a RECYCLED pid is dead, not alive — this is the case a bare kill(pid,0) gets wrong', () => {
  // Same pid, different process: start times disagree. kern.maxproc is 12000 on this box, so this
  // is reachable rather than theoretical.
  assert.equal(holderAlive({ pid: 42, pidStart: 1_788_677_533_409 }, io({ 42: 1_788_690_000 })), false);
});

test('a ONE-SECOND rounding difference is tolerated — a false mismatch restores the stampede', () => {
  // The holder computes its start from process.uptime(); we read ps, in whole seconds. A process
  // starting either side of a second boundary rounds apart by one.
  assert.equal(holderAlive({ pid: 42, pidStart: 1_788_677_533_409 }, io({ 42: 1_788_677_534 })), true);
  assert.equal(holderAlive({ pid: 42, pidStart: 1_788_677_533_409 }, io({ 42: 1_788_677_532 })), true);
});

test('but TWO seconds apart is still a different process', () => {
  assert.equal(holderAlive({ pid: 42, pidStart: 1_788_677_533_409 }, io({ 42: 1_788_677_535 })), false);
});

test('milliseconds are floored to seconds before comparison, not compared raw', () => {
  // pid_start is ms; ps reports whole seconds. A raw compare would never match.
  assert.equal(holderAlive({ pid: 7, pidStart: 1_788_677_533_999 }, io({ 7: 1_788_677_533 })), true);
});

test('UNKNOWN liveness fails CLOSED — an unmeasurable holder is treated as alive', () => {
  // io.startedAt returns null: the process exists but we cannot read its start time.
  const probe = { exists: () => true, startedAt: () => null };
  assert.equal(holderAlive({ pid: 5, pidStart: 123_000 }, probe), true,
    'declining to steal a lock we cannot prove abandoned is the safe direction — the cost is one skipped run');
});

test('a holder with no recorded start cannot be refuted, so it is alive', () => {
  assert.equal(holderAlive({ pid: 5 }, { exists: () => true, startedAt: () => 1 }), true);
});

test('a corrupt lock file is NOT an absent lock', () => {
  const h = readHolder('{not json');
  assert.equal(h.corrupt, true);
  const f = io({}, { '/lock': '{not json' });
  const r = acquire('/lock', { pid: 1, pidStart: 1000 }, f);
  assert.equal(r.ok, false, 'unreadable lock state must defer, never assume the lock is free');
});

test('acquire succeeds on a free lock and writes the holder', () => {
  const f = io({});
  const r = acquire('/lock', { pid: 11, pidStart: 22_000 }, f);
  assert.equal(r.ok, true);
  assert.equal(r.stolen, false);
  assert.deepEqual(JSON.parse(f._files['/lock']), { pid: 11, pidStart: 22_000 });
});

test('acquire DEFERS to a live holder and names it', () => {
  const f = io({ 42: 1_000 }, { '/lock': JSON.stringify({ pid: 42, pidStart: 1_000_000 }) });
  const r = acquire('/lock', { pid: 11, pidStart: 22_000 }, f);
  assert.equal(r.ok, false);
  assert.equal(r.holder.pid, 42);
  assert.match(r.reason, /alive/);
});

test('acquire STEALS a provably abandoned lock', () => {
  const f = io({}, { '/lock': JSON.stringify({ pid: 42, pidStart: 1_000_000 }) });   // pid 42 gone
  const r = acquire('/lock', { pid: 11, pidStart: 22_000 }, f);
  assert.equal(r.ok, true);
  assert.equal(r.stolen, true);
  assert.deepEqual(JSON.parse(f._files['/lock']), { pid: 11, pidStart: 22_000 });
});

test('release only removes a lock we still hold', () => {
  const mine = { pid: 11, pidStart: 22_000 };
  const f = io({}, { '/lock': JSON.stringify(mine) });
  assert.equal(release('/lock', mine, f), true);
  assert.equal('/lock' in f._files, false);

  const g = io({}, { '/lock': JSON.stringify({ pid: 99, pidStart: 1 }) });
  assert.equal(release('/lock', mine, g), false, 'a lock taken over by another run is not ours to delete');
  assert.equal('/lock' in g._files, true);
});
