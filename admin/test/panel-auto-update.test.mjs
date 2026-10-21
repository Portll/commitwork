// admin/lib/panel-auto-update.mjs — the panel restarting itself onto the code on disk, driven with
// a fake clock, a fake code stamp and fake jobs so each gate is asserted on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoUpdater, autoUpdateEnabled, settleMs } from '../lib/panel-auto-update.mjs';

function rig({ preflightOk = true } = {}) {
  const w = { t: 0, health: { stale: false, changed: [], fingerprint: 'a' }, busy: false, preflights: 0, restarts: [] };
  w.updater = createAutoUpdater({
    codeHealth: () => w.health,
    busy: () => w.busy,
    preflight: async () => { w.preflights++; return preflightOk ? { ok: true } : { ok: false, error: 'serve.mjs: does not boot' }; },
    restart: (reason) => w.restarts.push(reason),
    settle: () => 60_000,
    now: () => w.t,
  });
  w.stale = (fp) => { w.health = { stale: true, changed: ['serve.mjs'], fingerprint: fp }; };
  return w;
}

test('current code does nothing', async () => {
  const w = rig();
  assert.equal((await w.updater.tick()).state, 'current');
  assert.equal(w.preflights, 0);
});

test('changed code waits until it has stopped changing for the settle window', async () => {
  const w = rig();
  w.stale('b');
  assert.equal((await w.updater.tick()).state, 'settling');
  w.t = 50_000; w.stale('c');
  assert.equal((await w.updater.tick()).state, 'settling', 'a further edit restarts the window');
  w.t = 100_000;
  assert.equal((await w.updater.tick()).state, 'settling');
  w.t = 110_000;
  assert.equal((await w.updater.tick()).state, 'updating');
  assert.deepEqual(w.restarts, ['automatic update']);
});

test('a running job holds the update until it finishes', async () => {
  const w = rig();
  w.stale('b'); await w.updater.tick();
  w.t = 60_000; w.busy = true;
  assert.equal((await w.updater.tick()).state, 'waiting');
  assert.equal(w.preflights, 0, 'no preflight is spent while a job holds the process');
  w.busy = false;
  assert.equal((await w.updater.tick()).state, 'updating');
});

test('a successor that does not boot blocks that code, and only that code', async () => {
  const w = rig({ preflightOk: false });
  w.stale('b'); await w.updater.tick();
  w.t = 60_000;
  const s = await w.updater.tick();
  assert.equal(s.state, 'blocked');
  assert.match(s.error, /does not boot/);
  w.t = 200_000;
  assert.equal((await w.updater.tick()).state, 'blocked');
  assert.equal(w.preflights, 1, 'the same broken code is not preflighted again');
  assert.equal(w.restarts.length, 0);
  w.stale('c');
  assert.equal((await w.updater.tick()).state, 'settling', 'new code earns a new attempt');
});

test('code that changes during the preflight is not restarted onto', async () => {
  const w = rig();
  w.updater = createAutoUpdater({
    codeHealth: () => w.health, busy: () => false, restart: (r) => w.restarts.push(r),
    preflight: async () => { w.stale('moved'); return { ok: true }; },
    settle: () => 0, now: () => w.t,
  });
  w.stale('b');
  assert.equal((await w.updater.tick()).state, 'settling');
  assert.equal(w.restarts.length, 0);
});

test('switches are read from the environment at call time', () => {
  assert.equal(autoUpdateEnabled({}), true);
  assert.equal(autoUpdateEnabled({ CW_PANEL_AUTO_UPDATE: '0' }), false);
  assert.equal(autoUpdateEnabled({ NODE_TEST_CONTEXT: 'child-v8' }), false);
  assert.equal(settleMs({}), 90_000);
  assert.equal(settleMs({ CW_PANEL_AUTO_UPDATE_SETTLE_MS: '5000' }), 5000);
  assert.equal(settleMs({ CW_PANEL_AUTO_UPDATE_SETTLE_MS: 'soon' }), 90_000);
});
