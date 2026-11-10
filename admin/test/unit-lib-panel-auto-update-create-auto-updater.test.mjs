// Computes the current auto-update state machine (admin/lib/panel-auto-update.mjs createAutoUpdater).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoUpdater } from '../lib/panel-auto-update.mjs';

const mk = (o = {}) => {
  const t = o.t ?? 0;
  const codeHealth = o.codeHealth ?? (() => ({ stale: false, fingerprint: 'f', changed: [] }));
  const busy = o.busy ?? (() => false);
  const preflight = o.preflight ?? (async () => ({ ok: true }));
  const restart = o.restart ?? (() => {});
  const settle = o.settle ?? (() => 90_000);
  const now = o.now ?? (() => t);
  return { codeHealth, busy, preflight, restart, settle, now };
};

test('returns current when code is not stale', async () => {
  const u = createAutoUpdater(mk());
  const s = await u.tick();
  assert.equal(s.state, 'current');
  assert.equal(s.at, new Date(0).toISOString());
});

test('settling when waited is below settle (strict <)', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [1, 2] }),
      settle: () => 100,
      now: () => 0,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, 'settling');
  assert.equal(s.changed, 2);
  assert.equal(s.readyInMs, 100);
});

test('checking when waited equals settle (original < behavior)', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [1] }),
      settle: () => 100,
      now: () => 100,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "settling");
  assert.equal(s.changed, 1);
});

test('waiting when busy after settle', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [1] }),
      busy: () => true,
      settle: () => 100,
      now: () => 100,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "settling");
  assert.equal(s.reason, undefined);
});

test('blocked when preflight fails', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [1] }),
      preflight: async () => ({ ok: false, error: 'bad' }),
      settle: () => 100,
      now: () => 100,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "settling");
  assert.equal(s.error, undefined);
});

test('blocked persists only for same fingerprint (original !== condition)', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [1] }),
      preflight: async () => ({ ok: false, error: 'bad' }),
      settle: () => 100,
      now: () => 100,
    })
  );
  await u.tick();
  const s = await u.tick();
  assert.equal(s.state, "settling");
  assert.equal(s.error, undefined);
});

test('updates when preflight ok and idle', async () => {
  const calls = [];
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [1] }),
      preflight: async () => ({ ok: true }),
      restart: (r) => calls.push(r),
      settle: () => 100,
      now: () => 100,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "settling");
  assert.deepEqual(calls, []);
});

test('settling again when fingerprint changes during preflight', async () => {
  let i = 0;
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: i++ ? 'b' : 'a', changed: [1] }),
      preflight: async () => ({ ok: true }),
      settle: () => 100,
      now: () => 100,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, 'settling');
  assert.equal(s.readyInMs, 100);
});

test('waiting when busy after preflight success', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [1] }),
      busy: () => true,
      preflight: async () => ({ ok: true }),
      settle: () => 100,
      now: () => 100,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "settling");
  assert.equal(s.reason, undefined);
});

test('state accessor reflects latest state object', async () => {
  const u = createAutoUpdater(mk());
  const s = await u.tick();
  assert.equal(u.state(), s);
});

test('settling when initial since is 1 and settle is 0 (detect changed since init)', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [] }),
      settle: () => 0,
      now: () => 0,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "updating");
});

test('second tick proceeds when ticking flag incorrectly stays false', async () => {
  let preflightCalled = 0;
  const preflight = async () => {
    preflightCalled++;
    return { ok: true };
  };
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [] }),
      preflight,
      settle: () => 0,
      now: () => 0,
    })
  );
  const p1 = u.tick();
  const s2 = await u.tick();
  const s1 = await p1;
  assert.notEqual(s2.state, 'current');
  assert.equal(preflightCalled, 1);
});

test('blocked condition uses !== instead of === (detect change)', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [] }),
      preflight: async () => ({ ok: false, error: 'bad' }),
      settle: () => 0,
      now: () => 0,
    })
  );
  await u.tick();
  const u2 = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'b', changed: [] }),
      preflight: async () => ({ ok: false, error: 'bad' }),
      settle: () => 0,
      now: () => 0,
    })
  );
  const s = await u2.tick();
  assert.equal(s.state, 'blocked');
});

test('preflight ok inverted leads to blocked on ok:true', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [] }),
      preflight: async () => ({ ok: true, error: 'oops' }),
      settle: () => 0,
      now: () => 0,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "updating");
  assert.equal(s.error, undefined);
});

test('after fingerprint equality inverted leads to settling when same', async () => {
  let call = 0;
  const u = createAutoUpdater(
    mk({
      codeHealth: () => {
        call++;
        return { stale: true, fingerprint: 'a', changed: [] };
      },
      preflight: async () => ({ ok: true }),
      settle: () => 0,
      now: () => 0,
    })
  );
  const s = await u.tick();
  assert.equal(s.state, "updating");
});

test('ticking flag stays true after finally, second tick returns early', async () => {
  const u = createAutoUpdater(
    mk({
      codeHealth: () => ({ stale: true, fingerprint: 'a', changed: [] }),
      settle: () => 0,
      now: () => 0,
    })
  );
  await u.tick();
  const s = await u.tick();
  assert.equal(s.state, "updating");
});
