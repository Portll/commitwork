// lib/update/scheduler.mjs: the daily check with jitter, deferring to idle, the notice it leaves,
// and what counts as busy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateScheduler, busyReason, DAY_MS, JITTER_MS } from '../update/scheduler.mjs';

function rig({ mode = 'install', result = { outcome: 'current', installed: '1.0.0', version: '1.0.0' }, random = 0.5 } = {}) {
  const w = { t: 0, busy: null, runs: [], logs: [], mode, result };
  w.s = createUpdateScheduler({
    mode: () => w.mode, busy: () => w.busy, now: () => w.t, random: () => random,
    run: async (m) => { w.runs.push(m); if (w.result instanceof Error) throw w.result; return w.result; },
    log: (m) => w.logs.push(m),
  });
  return w;
}
const FIRST = 2 * 60 * 1000 + 0.5 * 10 * 60 * 1000;

describe('the schedule', () => {
  test('nothing runs before the first, jittered check', async () => {
    // Arrange
    const w = rig();
    w.t = FIRST - 1;
    // Act
    const s = await w.s.tick();
    // Assert
    assert.equal(s.state, 'scheduled');
    assert.equal(w.runs.length, 0);
  });

  test('the first check runs a few minutes after start, the next a day plus jitter later', async () => {
    // Arrange
    const w = rig();
    w.t = FIRST;
    // Act
    const s = await w.s.tick();
    w.t = FIRST + DAY_MS;
    await w.s.tick();
    w.t = FIRST + DAY_MS + 0.5 * JITTER_MS;
    await w.s.tick();
    // Assert
    assert.equal(s.state, 'current');
    assert.equal(s.nextAt, new Date(FIRST + DAY_MS + 0.5 * JITTER_MS).toISOString());
    assert.deepEqual(w.runs, ['install', 'install']);
  });

  test('off runs nothing', async () => {
    // Arrange
    const w = rig({ mode: 'off' });
    w.t = FIRST;
    // Act
    const s = await w.s.tick();
    // Assert
    assert.equal(s.state, 'off');
    assert.equal(w.runs.length, 0);
  });

  test('notify only checks, even while busy', async () => {
    // Arrange
    const w = rig({ mode: 'notify', result: { outcome: 'available', installed: '1.0.0', version: '1.1.0' } });
    w.t = FIRST; w.busy = 'the sweep job is running';
    // Act
    const s = await w.s.tick();
    // Assert
    assert.deepEqual(w.runs, ['check']);
    assert.equal(s.state, 'available');
    assert.match(s.note, /run commitwork update to install 1\.1\.0/);
  });
});

describe('deferring to idle', () => {
  test('a busy process holds the install, and the next idle tick runs it', async () => {
    // Arrange
    const w = rig({ result: { outcome: 'installed', installed: '1.0.0', version: '1.1.0', source: 'portll', keyId: 'k' } });
    w.t = FIRST; w.busy = 'a sweep of web is in flight';
    // Act
    const held = await w.s.tick();
    w.t += 60_000; w.busy = null;
    const done = await w.s.tick();
    // Assert
    assert.equal(held.state, 'waiting');
    assert.equal(held.reason, 'a sweep of web is in flight');
    assert.deepEqual(w.runs, ['install']);
    assert.equal(done.state, 'installed');
    assert.match(done.note, /restarts onto it at its next idle point/);
    assert.match(w.logs[0], /1\.1\.0 installed from portll \(signed k\); the panel restarts onto it at its next idle point/);
  });

  test('a tick during a running check does not start a second one', async () => {
    // Arrange
    let release;
    const w = rig();
    let t = 0;
    w.s = createUpdateScheduler({ mode: () => 'install', busy: () => null, now: () => t, random: () => 0.5, run: () => new Promise((r) => { release = r; }) });
    t = FIRST;
    // Act
    const first = w.s.tick();
    const second = await w.s.tick();
    release({ outcome: 'current' });
    await first;
    // Assert
    assert.equal(second.state, 'scheduled');
  });

  test('a failed or throwing check is logged and rescheduled', async () => {
    // Arrange
    const w = rig({ result: { outcome: 'no-verified-manifest', detail: 'portll: offline' } });
    const x = rig({ result: new Error('boom') });
    w.t = FIRST; x.t = FIRST;
    // Act
    const a = await w.s.tick();
    const b = await x.s.tick();
    // Assert
    assert.equal(a.state, 'failed');
    assert.match(w.logs[0], /no-verified-manifest: portll: offline/);
    assert.equal(b.state, 'failed');
    assert.equal(b.detail, 'boom');
  });

  test('an available release on a checkout carries the reason as its note', async () => {
    // Arrange
    const w = rig({ result: { outcome: 'available', installed: '1.0.0', version: '1.1.0', detail: 'a checkout; update it with git' } });
    w.t = FIRST;
    // Act
    const s = await w.s.tick();
    // Assert
    assert.equal(s.note, 'a checkout; update it with git');
  });

  test('a failure with no detail still reschedules', async () => {
    // Arrange
    const w = rig({ result: { outcome: 'refused' } });
    w.t = FIRST;
    // Act
    const s = await w.s.tick();
    // Assert
    assert.deepEqual([s.state, s.detail], ['failed', null]);
  });
});

describe('busyReason', () => {
  const alive = (pid) => pid === 42;

  test('a running panel job is busy', () => {
    // Arrange
    const jobs = { sweep: false, health: true };
    // Act
    const r = busyReason({ jobs, pidAlive: alive });
    // Assert
    assert.equal(r, 'the health job is running');
  });

  test('a sweep marker with a live pid, or an unprobeable one, is busy; a dead pid is not', () => {
    // Arrange
    const live = { ok: true, markers: [{ area: 'web', pid: 42 }] };
    const noPid = { ok: true, markers: [{ area: 'api' }] };
    const dead = { ok: true, markers: [{ area: 'ops', pid: 7 }] };
    const throws = { ok: true, markers: [{ area: 'x', pid: 9 }] };
    // Act
    const r = [busyReason({ markers: live, pidAlive: alive }), busyReason({ markers: noPid, pidAlive: alive }),
      busyReason({ markers: dead, pidAlive: alive }), busyReason({ markers: throws, pidAlive: () => { throw new Error('EINVAL'); } })];
    // Assert
    assert.deepEqual(r, ['a sweep of web is in flight', 'a sweep of api is in flight', null, 'a sweep of x is in flight']);
  });

  test('markers that cannot be read hold the install', () => {
    // Arrange
    const markers = { ok: false, markers: [] };
    // Act
    const r = busyReason({ markers, pidAlive: alive });
    // Assert
    assert.match(r, /could not all be read/);
  });

  test('idle is null', () => {
    // Arrange
    const none = {};
    // Act
    const r = busyReason(none);
    // Assert
    assert.equal(r, null);
  });
});

test('the defaults schedule against the real clock', async () => {
  // Arrange
  const s = createUpdateScheduler({ mode: () => 'install', run: async () => ({ outcome: 'current' }), busy: () => null });
  // Act
  const st = await s.tick();
  // Assert
  assert.equal(st.state, 'scheduled');
  assert.ok(Date.parse(st.nextAt) > Date.now());
});
