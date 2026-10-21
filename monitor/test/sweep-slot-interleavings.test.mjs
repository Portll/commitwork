// monitor/test/sweep-slot-interleavings.test.mjs — two sweeps racing for one slot at every step of
// the real acquisition, and what the slot decides about a holder it cannot vouch for.
//
// acquireSweepSlot() delegates to acquireLock() (monitor/lockfile.mjs), whose claim() is
// mkdir-staging → write owner.json → utimes → rename(staging, lock); the rename is the test-and-set
// and the read-back (observeLock) only runs on the losing path. sweep-slot.mjs and lockfile.mjs
// read no CW_* at all — the reports root is a parameter, so every fixture here is an mkdtemp.
//
// The pause seam is TEST-SIDE: a `--import` preload wraps the fs calls claim() makes and
// syncBuiltinESMExports() re-points lockfile.mjs's named imports at the wrappers (the mechanism
// admin/test/fixtures/boot-trace.mjs uses). One child is paused at one step via marker files while
// the other runs the UNPATCHED module to completion, so each outcome is witnessed by a pristine
// process. Nothing in monitor/ was changed; a pause point that is never reached fails the test.
//
// Decision table, measured 2026-10-18 and asserted below — recorded, not endorsed:
//   holder pid reused by a live non-sweep, fresh stamp   HELD      (stamp alone; pid never probed)
//   holder pid dead, fresh stamp                         HELD      (crashed sweep keeps its permit)
//   holder pid alive, stamp 31 min old                   TAKEN OVER, silently (sweeps run for hours)
//   holder pid alive, stamp 29 min old                   HELD
//   owner.json unreadable, fresh mtime                   HELD, age from mtime
//   owner.json unreadable, mtime zeroed                  HELD, age unknown — never stale, never absent
//   lock directory unreadable                            HELD
//   refused acquireSweepSlot()                           carries no holder; only the disk names one

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync, chmodSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireSweepSlot, slotName } from '../sweep-slot.mjs';
import { inspectLock } from '../lockfile.mjs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SWEEP_SLOT = join(HERE, '..', 'sweep-slot.mjs');
const LOCKFILE = join(HERE, '..', 'lockfile.mjs');
const SWEEP = join(HERE, '..', 'sweep.mjs');
const OWNER = 'owner.json';
const MIN = 60_000;
const CAP_MS = 15_000;      // every wait inside a test gives up here, well under the test timeout
const CHILD_TEST_MS = 45_000; // node spawns are slow on a loaded box; each race spawns two
const SYNC_TEST_MS = 10_000;
const DEAD_PID = 2_147_483_646; // no such process — the same sentinel sweep-inflight.test.mjs uses

// ── the seam ──────────────────────────────────────────────────────────────────────────────────
const PRELOAD = `
import { createRequire, syncBuiltinESMExports } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
const AT = process.env.CW_TEST_SLOT_PAUSE_AT || '';
const DIR = process.env.CW_TEST_SLOT_PAUSE_DIR || '';
const CAP = Number(process.env.CW_TEST_SLOT_PAUSE_CAP_MS || 15000);
const orig = { mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, readFileSync: fs.readFileSync, existsSync: fs.existsSync };
const STAGING = /\\.sweep-slot-\\d+\\.lock\\.new-/;
const LOCK = /\\.sweep-slot-\\d+\\.lock$/;
const OWNER_IN_LOCK = /\\.sweep-slot-\\d+\\.lock[\\\\/]owner\\.json$/;
let fired = false;
function pause(event) {
  if (fired || !DIR || event !== AT) return;
  fired = true;
  orig.writeFileSync.call(fs, DIR + '/reached', event);
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + CAP;
  while (!orig.existsSync.call(fs, DIR + '/go')) {
    if (Date.now() > until) { fs.writeSync(2, 'pause seam: no go within ' + CAP + 'ms at ' + event + '\\n'); process.exit(97); }
    Atomics.wait(cell, 0, 0, 5);
  }
}
fs.mkdirSync = function (p, ...r) {
  const s = STAGING.test(String(p));
  if (s) pause('before-stage');
  const out = orig.mkdirSync.call(this, p, ...r);
  if (s) pause('after-stage');
  return out;
};
fs.writeFileSync = function (p, ...r) {
  const out = orig.writeFileSync.call(this, p, ...r);
  if (STAGING.test(String(p)) && /owner\\.json$/.test(String(p))) pause('after-write');
  return out;
};
fs.renameSync = function (a, b) {
  const s = STAGING.test(String(a)) && LOCK.test(String(b));
  try { const out = orig.renameSync.call(this, a, b); if (s) pause('after-rename'); return out; }
  catch (e) { if (s) pause('after-rename-fail'); throw e; }
};
fs.readFileSync = function (p, ...r) {
  const s = OWNER_IN_LOCK.test(String(p));
  try { const out = orig.readFileSync.call(this, p, ...r); if (s) pause('after-readback'); return out; }
  catch (e) { if (s) pause('after-readback'); throw e; }
};
syncBuiltinESMExports();
`;

// One acquirer. argv: root label mode(sig-dir). `hold` keeps the permit until release-<label> appears.
const CHILD = `
import { acquireSweepSlot, slotName } from ${JSON.stringify(pathToFileURL(SWEEP_SLOT).href)};
import { inspectLock } from ${JSON.stringify(pathToFileURL(LOCKFILE).href)};
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [root, label, mode, sig] = process.argv.slice(2);
const CAP = Number(process.env.CW_TEST_SLOT_PAUSE_CAP_MS || 15000);
const got = acquireSweepSlot(root, { slots: 1, label, deadlineMs: 0 });
const lock = join(root, slotName(0));
const out = { pid: process.pid, label, ok: got.ok === true, slot: got.slot ?? null, reason: got.reason ?? null,
  refusalKeys: got.ok === true ? null : Object.keys(got).sort(), seen: inspectLock(lock) };
if (got.ok === true) {
  out.mine = out.seen.holder;
  writeFileSync(join(sig, 'acquired-' + label), '');
  if (mode === 'hold') {
    const cell = new Int32Array(new SharedArrayBuffer(4));
    const until = Date.now() + CAP;
    while (!existsSync(join(sig, 'release-' + label))) {
      if (Date.now() > until) { process.stderr.write('holder ' + label + ': never released\\n'); process.exit(98); }
      Atomics.wait(cell, 0, 0, 5);
    }
  }
  got.release();
  out.afterRelease = inspectLock(lock);
}
process.stdout.write(JSON.stringify(out) + '\\n');
`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-slot-race-'));
  const f = { dir, root: join(dir, 'reports'), sig: join(dir, 'sig'), preload: join(dir, 'pause-fs.mjs'), child: join(dir, 'acquire.mjs'), kids: [] };
  mkdirSync(f.root); mkdirSync(f.sig);
  writeFileSync(f.preload, PRELOAD);
  writeFileSync(f.child, CHILD);
  return f;
}
function teardown(f) {
  for (const k of f.kids) k.kill();
  rmSync(f.dir, { recursive: true, force: true });
}

function spawnAcquirer(f, label, { pauseAt = '', mode = 'once' } = {}) {
  const env = { ...process.env, CW_SELF_SWEEP: '0', CW_TEST_SLOT_PAUSE_AT: pauseAt, CW_TEST_SLOT_PAUSE_DIR: f.sig, CW_TEST_SLOT_PAUSE_CAP_MS: String(CAP_MS) };
  // Only the paused child is patched; its opponent runs the module exactly as shipped.
  const args = pauseAt ? ['--import', pathToFileURL(f.preload).href, f.child] : [f.child];
  const c = spawn(process.execPath, [...args, f.root, label, mode, f.sig], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  c.stdout.on('data', (b) => { out += b; });
  c.stderr.on('data', (b) => { err += b; });
  const done = new Promise((res) => c.on('close', (code) => res({ code, out, err })));
  const kid = { label, pid: c.pid, done, kill: () => { try { c.kill('SIGKILL'); } catch { /* already gone */ } } };
  f.kids.push(kid);
  return kid;
}
async function result(kid) {
  const r = await kid.done;
  assert.equal(r.code, 0, `${kid.label} exited ${r.code}: ${r.err}`);
  return JSON.parse(r.out);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, pred) {
  const until = Date.now() + CAP_MS;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out after ${CAP_MS}ms waiting for ${what}`);
    await sleep(10);
  }
}
const touch = (p) => writeFileSync(p, '');
const reached = (f) => (existsSync(join(f.sig, 'reached')) ? readFileSync(join(f.sig, 'reached'), 'utf8') : null);

// Everything on disk under the reports root. A lock is "intact" when it is present AND parseable;
// debris is any staging or guard path left behind by either acquirer.
function disk(root) {
  const entries = readdirSync(root).sort();
  const lock = join(root, slotName(0));
  let owner = null; let ownerErr = null;
  try { owner = JSON.parse(readFileSync(join(lock, OWNER), 'utf8')); } catch (e) { ownerErr = e.code || String(e); }
  return { entries, lockPresent: existsSync(lock), owner, ownerErr, debris: entries.filter((n) => /\.new-|\.break-|\.breaking$/.test(n)) };
}
// `inFlight` is an acquirer still paused inside claim(): its own staging dir is in-progress state,
// not debris, until it resumes and cleans up. Anything else left behind is.
function assertHeldBy(root, kid, why, { inFlight = null } = {}) {
  const s = disk(root);
  assert.equal(s.lockPresent, true, `${why}: the lock must be present`);
  assert.equal(s.ownerErr, null, `${why}: the lock is torn — owner.json ${s.ownerErr}`);
  assert.equal(s.owner.pid, kid.pid, `${why}: the token on disk must be ${kid.label}'s`);
  const own = inFlight ? new RegExp(`\\.lock\\.new-${inFlight.pid}-`) : null;
  assert.deepEqual(s.debris.filter((n) => !(own && own.test(n))), [], `${why}: staging/guard debris left behind`);
}
function assertClean(root, why) {
  const s = disk(root);
  assert.equal(s.lockPresent, false, `${why}: the lock must be gone after release`);
  assert.deepEqual(s.entries, [], `${why}: nothing may remain under the reports root; found ${s.entries}`);
}
function assertRefused(r, why) {
  assert.equal(r.ok, false, `${why}: must be refused`);
  assert.match(r.reason, /slots held/, `${why}: the refusal names the condition`);
  assert.equal(r.slot, null, `${why}: a refusal carries no slot`);
}

describe('two sweeps racing for one slot — every pause point of the real claim()', () => {
  // A pauses before it has installed anything; B takes the slot and holds it; A resumes and loses.
  for (const at of ['before-stage', 'after-stage', 'after-write']) {
    test(`A paused ${at}, B takes the slot: B wins, A is refused naming B, the lock is never torn`, { timeout: CHILD_TEST_MS }, async () => {
      const f = fixture();
      try {
        const A = spawnAcquirer(f, 'A', { pauseAt: at });
        await waitFor(`A to reach ${at}`, () => reached(f) === at);

        // Mid-pause: the lock path is absent and the slot reads free — a half-built token lives only
        // under the staging name, which no acquirer can take.
        const mid = disk(f.root);
        assert.equal(mid.lockPresent, false, `${at}: the lock path must not exist before the rename`);
        assert.equal(inspectLock(join(f.root, slotName(0))).held, false, `${at}: a half-built claim must read as free`);
        if (at === 'before-stage') assert.deepEqual(mid.entries, [], 'nothing on disk before the staging mkdir');
        else {
          assert.equal(mid.entries.length, 1, `${at}: exactly one staging dir; found ${mid.entries}`);
          assert.match(mid.entries[0], /\.sweep-slot-0\.lock\.new-/);
          if (at === 'after-write') {
            const staged = JSON.parse(readFileSync(join(f.root, mid.entries[0], OWNER), 'utf8'));
            assert.equal(staged.pid, A.pid, 'the staged token is complete before the swap');
          }
        }

        const B = spawnAcquirer(f, 'B', { mode: 'hold' });
        await waitFor('B to acquire', () => existsSync(join(f.sig, 'acquired-B')));
        assertHeldBy(f.root, B, `${at}: B installed while A was paused`, { inFlight: at === 'before-stage' ? null : A });

        touch(join(f.sig, 'go'));
        const a = await result(A);
        assertRefused(a, `${at}: A resumed against B's lock`);
        assert.equal(a.seen.held, true);
        assert.equal(a.seen.holder && a.seen.holder.label, 'B', `${at}: the loser's read-back must name the winner`);
        assert.equal(a.seen.holder.pid, B.pid);
        assertHeldBy(f.root, B, `${at}: after A lost`);

        touch(join(f.sig, 'release-B'));
        const b = await result(B);
        assert.equal(b.ok, true); assert.equal(b.slot, 0);
        assert.equal(b.mine.pid, B.pid, 'the winner holds its own token');
        assert.equal(b.afterRelease.held, false);
        assertClean(f.root, `${at}: after both finished`);
      } finally { teardown(f); }
    });
  }

  test('A paused after-rename (holding), B runs: A wins, B is refused naming A, no debris from B', { timeout: CHILD_TEST_MS }, async () => {
    const f = fixture();
    try {
      const A = spawnAcquirer(f, 'A', { pauseAt: 'after-rename', mode: 'hold' });
      await waitFor('A to reach after-rename', () => reached(f) === 'after-rename');
      assertHeldBy(f.root, A, 'the rename installs a complete token in one step');
      assert.equal(inspectLock(join(f.root, slotName(0))).held, true);

      const b = await result(spawnAcquirer(f, 'B'));
      assertRefused(b, 'B against a lock whose owner is still inside claim()');
      assert.equal(b.seen.holder && b.seen.holder.label, 'A');
      assert.equal(b.seen.holder.pid, A.pid);
      assertHeldBy(f.root, A, "B's failed claim must leave A's lock exactly as it was");

      touch(join(f.sig, 'go'));
      await waitFor('A to report acquired', () => existsSync(join(f.sig, 'acquired-A')));
      touch(join(f.sig, 'release-A'));
      const a = await result(A);
      assert.equal(a.ok, true); assert.equal(a.mine.pid, A.pid);
      assertClean(f.root, 'after A released');
    } finally { teardown(f); }
  });

  // B holds first. A fails the test-and-set, then B releases while A is paused before/after its
  // read-back. A single-shot acquire reports what it saw: refused. Conservative — never two permits.
  for (const at of ['after-rename-fail', 'after-readback']) {
    test(`A paused ${at} while holder B releases: A stays refused (single shot), never a second permit, disk clean`, { timeout: CHILD_TEST_MS }, async () => {
      const f = fixture();
      try {
        const B = spawnAcquirer(f, 'B', { mode: 'hold' });
        await waitFor('B to acquire', () => existsSync(join(f.sig, 'acquired-B')));
        const A = spawnAcquirer(f, 'A', { pauseAt: at });
        await waitFor(`A to reach ${at}`, () => reached(f) === at);
        // after-rename-fail: A is paused before claim() removes its staging dir; after-readback: it has.
        assertHeldBy(f.root, B, `${at}: A's failed rename must not disturb B's lock`, { inFlight: at === 'after-rename-fail' ? A : null });

        touch(join(f.sig, 'release-B'));
        const b = await result(B);
        assert.equal(b.ok, true);
        const freed = disk(f.root);
        assert.equal(freed.lockPresent, false, `${at}: B's release must remove the lock`);
        assert.deepEqual(freed.entries.filter((n) => !n.includes(`.lock.new-${A.pid}-`)), [],
          `${at}: only A's in-flight staging may remain; found ${freed.entries}`);

        touch(join(f.sig, 'go'));
        const a = await result(A);
        assertRefused(a, `${at}: A's attempt was made under contention`);
        assert.equal(a.seen.held, false, `${at}: by the time A reports, the slot is free — the refusal is stale but safe`);
        assertClean(f.root, `${at}: after both finished`);
      } finally { teardown(f); }
    });
  }

  test("B's whole lifetime fits inside A's pause after-write: both are admitted, one after the other", { timeout: CHILD_TEST_MS }, async () => {
    const f = fixture();
    try {
      const A = spawnAcquirer(f, 'A', { pauseAt: 'after-write' });
      await waitFor('A to reach after-write', () => reached(f) === 'after-write');
      const b = await result(spawnAcquirer(f, 'B'));
      assert.equal(b.ok, true, 'B acquires and releases while A holds only a staging dir');
      assert.equal(b.afterRelease.held, false);
      touch(join(f.sig, 'go'));
      const a = await result(A);
      assert.equal(a.ok, true, "A's rename lands on the path B freed");
      assert.equal(a.mine.pid, A.pid);
      assertClean(f.root, 'after both finished');
    } finally { teardown(f); }
  });
});

// ── the holder the slot cannot vouch for ───────────────────────────────────────────────────────
function plant(root, { pid, at, mtimeAt = at, label = 'sweep:planted' }) {
  const lock = join(root, slotName(0));
  mkdirSync(lock, { recursive: true });
  const token = { pid, nonce: `planted-${randomBytes(4).toString('hex')}`, at, label };
  writeFileSync(join(lock, OWNER), JSON.stringify(token));
  utimesSync(lock, mtimeAt / 1000, mtimeAt / 1000);
  return { lock, token, bytes: readFileSync(join(lock, OWNER), 'utf8') };
}
const scratch = () => mkdtempSync(join(tmpdir(), 'cw-slot-holder-'));
const contend = (root) => acquireSweepSlot(root, { slots: 1, deadlineMs: 0, label: 'contender' });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

describe('what the slot decides about its holder — recorded, not endorsed', () => {
  test('a reused pid (live process that is NOT a sweep) with a fresh stamp is HELD: the stamp alone decides, the pid is recorded and never probed — known limitation', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    // A long-lived node process stands in for whatever inherited the pid. Killed on every exit path.
    const impostor = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore' });
    const kill = () => { try { impostor.kill('SIGKILL'); } catch { /* gone */ } };
    process.once('exit', kill);
    try {
      assert.ok(alive(impostor.pid), 'precondition: the impostor must be alive when the slot decides');
      const p = plant(root, { pid: impostor.pid, at: Date.now() });
      const got = contend(root);
      assert.equal(got.ok, false, 'HELD — the token names a live pid and a fresh stamp, and nothing distinguishes it from a sweep');
      assert.match(got.reason, /slots held/);
      assert.equal(readFileSync(join(p.lock, OWNER), 'utf8'), p.bytes, 'the impostor token is left in place');
      assert.equal(inspectLock(p.lock).holder.pid, impostor.pid);
      // The token carries pid, nonce, at, label and nothing else — no start time, no command line —
      // so there is nothing a refusal of the impostor could be based on.
      assert.deepEqual(Object.keys(inspectLock(p.lock).holder).sort(), ['at', 'label', 'nonce', 'pid']);
    } finally { kill(); process.off('exit', kill); rmSync(root, { recursive: true, force: true }); }
  });

  test('a DEAD pid with a fresh stamp is HELD — a crashed sweep keeps its permit until the stamp goes stale', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      assert.equal(alive(DEAD_PID), false, 'precondition: the sentinel pid must not exist');
      const p = plant(root, { pid: DEAD_PID, at: Date.now() });
      const got = contend(root);
      assert.equal(got.ok, false, 'HELD — pid liveness is not consulted; only the stamp is');
      assert.match(got.reason, /slots held/);
      assert.equal(readFileSync(join(p.lock, OWNER), 'utf8'), p.bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a LIVE pid with a 31-minute stamp is TAKEN OVER, silently — the slot bound is 30 min of hold, not a sweep\'s duration', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    let got = null;
    try {
      const p = plant(root, { pid: process.pid, at: Date.now() - 31 * MIN });
      assert.ok(alive(process.pid));
      got = contend(root);
      assert.equal(got.ok, true, 'TAKEN OVER — a running holder past staleMs loses its permit to the next contender');
      assert.equal(got.slot, 0);
      const now = inspectLock(p.lock);
      assert.notEqual(now.holder.nonce, p.token.nonce, 'the live holder\'s token was replaced');
      assert.equal(now.holder.label, 'contender');
      // Nothing above the lock primitive hears about it: acquireSweepSlot passes no onStale, and
      // the sweep passes no staleMs, so the default governs and the takeover is logged nowhere.
      assert.ok(!/onStale|staleMs/.test(readFileSync(SWEEP_SLOT, 'utf8')), 'sweep-slot.mjs neither sets staleMs nor listens for a takeover (current rule)');
      const sweepSrc = readFileSync(SWEEP, 'utf8');
      const call = sweepSrc.slice(sweepSrc.indexOf('acquireSweepSlot(join('), sweepSrc.indexOf('});', sweepSrc.indexOf('acquireSweepSlot(join(')));
      assert.ok(call.length > 0 && !/staleMs/.test(call), 'sweep.mjs takes the slot with the default staleMs (current rule)');
    } finally { if (got && got.ok) got.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a LIVE pid with a 29-minute stamp is HELD — the threshold is the default 30 minutes', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const p = plant(root, { pid: process.pid, at: Date.now() - 29 * MIN });
      const got = contend(root);
      assert.equal(got.ok, false);
      assert.equal(readFileSync(join(p.lock, OWNER), 'utf8'), p.bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the acquisition path never probes a pid — the rule above is the stamp, and this fails the day that changes', { timeout: SYNC_TEST_MS }, () => {
    const src = readFileSync(LOCKFILE, 'utf8');
    assert.ok(!/process\.kill\(/.test(src), 'lockfile.mjs now probes pids: rewrite the holder tests above to the new rule');
    assert.ok(!/process\.kill\(/.test(readFileSync(SWEEP_SLOT, 'utf8')));
  });

  test('a refused acquireSweepSlot() does not name the holder — only the on-disk token does (current shape)', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const p = plant(root, { pid: DEAD_PID, at: Date.now(), label: 'sweep:team-x' });
      const got = contend(root);
      assert.equal(got.ok, false);
      assert.deepEqual(Object.keys(got).sort(), ['ok', 'reason', 'slots', 'waitedMs'], 'the deferral line has no holder to print');
      assert.equal(inspectLock(p.lock).holder.label, 'sweep:team-x', 'the identity is on disk for whoever looks');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// ── an unreadable lock is held, never absent ───────────────────────────────────────────────────
const SKIP_ROOT = ignoresPermissions() ? 'runs as root — mode bits are ignored, the jail cannot close' : false;
function jailed(t, path) {
  const d = denyRead(path);
  if (!d.ok) { t.skip(`SKIPPED (not a pass): could not make the fixture unreadable — ${d.why}`); return null; }
  return d;
}
const refusedRead = (p) => { try { readFileSync(p); return null; } catch (e) { return e.code; } };

describe('an unreadable slot lock is HELD, never absent', () => {
  test('owner.json unreadable, fresh mtime: HELD with the age taken from mtime, token untouched', { timeout: SYNC_TEST_MS, skip: SKIP_ROOT }, (t) => {
    const root = scratch();
    const p = plant(root, { pid: DEAD_PID, at: Date.now() });
    const d = jailed(t, join(p.lock, OWNER));
    if (!d) return;
    try {
      assert.match(String(refusedRead(join(p.lock, OWNER))), REFUSED_ERRNO, 'precondition: the jail must be closed');
      const got = contend(root);
      assert.equal(got.ok, false, 'a token we cannot read is a holder we cannot rule out');
      assert.match(got.reason, /slots held/);
      const s = inspectLock(p.lock);
      assert.equal(s.held, true); assert.equal(s.ageKnown, true); assert.equal(s.holder, null);
      assert.equal(s.stale, false);
    } finally {
      d.restore();
      assert.equal(readFileSync(join(p.lock, OWNER), 'utf8'), p.bytes, 'the refusal must not have written over the token');
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('owner.json unreadable AND mtime zeroed: HELD with age UNKNOWN — never stale, never absent', { timeout: SYNC_TEST_MS, skip: SKIP_ROOT }, (t) => {
    const root = scratch();
    const p = plant(root, { pid: DEAD_PID, at: 0, mtimeAt: 0 });
    const d = jailed(t, join(p.lock, OWNER));
    if (!d) return;
    try {
      assert.match(String(refusedRead(join(p.lock, OWNER))), REFUSED_ERRNO, 'precondition: the jail must be closed');
      const got = contend(root);
      assert.equal(got.ok, false, 'nothing readable at all is still not a licence to take the slot');
      const s = inspectLock(p.lock);
      assert.equal(s.held, true); assert.equal(s.ageKnown, false); assert.equal(s.stale, false);
    } finally {
      d.restore();
      assert.equal(readFileSync(join(p.lock, OWNER), 'utf8'), p.bytes);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the lock DIRECTORY unreadable: HELD, refused rather than thrown, token untouched', { timeout: SYNC_TEST_MS, skip: SKIP_ROOT }, (t) => {
    const root = scratch();
    const p = plant(root, { pid: DEAD_PID, at: Date.now() });
    const d = jailed(t, p.lock);
    if (!d) return;
    try {
      assert.match(String(refusedRead(join(p.lock, OWNER))), REFUSED_ERRNO, 'precondition: the jail must be closed');
      let got;
      assert.doesNotThrow(() => { got = contend(root); }, 'contention against an unreadable lock is a refusal, not a filesystem failure');
      assert.equal(got.ok, false);
      assert.match(got.reason, /slots held/);
      assert.equal(inspectLock(p.lock).held, true);
    } finally {
      d.restore();
      try { chmodSync(p.lock, 0o755); } catch { /* restore() already made it traversable, or it is gone */ }
      assert.equal(readFileSync(join(p.lock, OWNER), 'utf8'), p.bytes);
      assert.deepEqual(disk(root).debris, [], 'the contender\'s staging dir must be cleaned up');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
