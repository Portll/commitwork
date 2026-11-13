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
// Decision table, asserted below. The token carries host + startedAt since 2026-10-19 and the lock
// probes the pid (ESRCH dead, EPERM alive, zombie dead, anything else unknown) when the token
// names this host; 'unknown' is never dead, so it falls to the stamp-age rule.
//   holder pid dead, fresh stamp                         TAKEN   (a corpse holds nothing)
//   holder pid reused by a live non-sweep, fresh stamp   TAKEN   (startedAt does not match the pid)
//   holder pid alive, start matches, stamp 31 min old    TAKEN, loudly — the holder stopped refreshing
//   holder pid alive, start matches, refreshed           HELD    (refresh() re-stamps `at`)
//   holder pid alive, stamp 29 min old                   HELD
//   liveness unknown (kill throws an odd code)           HELD by stamp age
//   token names another host / pre-field token           HELD by stamp age — the pid is not ours to read
//   owner.json unreadable, fresh mtime                   HELD, age from mtime
//   owner.json unreadable, mtime zeroed                  HELD, age unknown — never stale, never absent
//   lock directory unreadable                            HELD
//   refused acquireSweepSlot()                           names the holder, its age and its liveness

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync, chmodSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireSweepSlot, keepSweepSlot, slotName } from '../sweep-slot.mjs';
import { inspectLock, ownStartMs, DEFAULT_STALE_MS } from '../lockfile.mjs';
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

// ── the holder the slot vouches for, or does not ───────────────────────────────────────────────
// plant() writes the token claim() writes: host defaults to this host and startedAt to this
// process's start, so a planted `pid: process.pid` reads as a live, matching holder. `legacy`
// writes the pre-field shape (pid, nonce, at, label) for the compatibility cases.
function plant(root, { pid, at, mtimeAt = at, label = 'sweep:planted', host = hostname(), startedAt = ownStartMs(), legacy = false }) {
  const lock = join(root, slotName(0));
  mkdirSync(lock, { recursive: true });
  const token = { pid, nonce: `planted-${randomBytes(4).toString('hex')}`, at, label };
  if (!legacy) Object.assign(token, { host, startedAt });
  writeFileSync(join(lock, OWNER), JSON.stringify(token));
  utimesSync(lock, mtimeAt / 1000, mtimeAt / 1000);
  return { lock, token, bytes: readFileSync(join(lock, OWNER), 'utf8') };
}
const scratch = () => mkdtempSync(join(tmpdir(), 'cw-slot-holder-'));
const contend = (root, extra = {}) => acquireSweepSlot(root, { slots: 1, deadlineMs: 0, label: 'contender', ...extra });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const ownerBytes = (lock) => readFileSync(join(lock, OWNER), 'utf8');
// `kill` that throws a given errno — the seam for the branches a real pid table cannot be made to take.
const throwing = (code) => () => { const e = new Error(code); e.code = code; throw e; };

describe('what the slot decides about its holder', () => {
  test('a DEAD pid with a fresh stamp is TAKEN — a crashed sweep holds nothing, whatever its stamp says', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    let got = null;
    try {
      assert.equal(alive(DEAD_PID), false, 'precondition: the sentinel pid must not exist');
      const p = plant(root, { pid: DEAD_PID, at: Date.now(), label: 'sweep:crashed' });
      const before = inspectLock(p.lock);
      assert.equal(before.holderAlive, false, 'ESRCH is a verdict, not a guess');
      assert.equal(before.stale, true, 'a dead holder is stale at any age — inspect says what acquire will do');
      const stale = [];
      got = contend(root, { onStale: (s) => stale.push(s) });
      assert.equal(got.ok, true, 'TAKEN — the stamp is fresh and the pid is a corpse');
      assert.equal(got.slot, 0);
      assert.equal(stale.length, 1, 'the takeover is reported once');
      assert.equal(stale[0].holder.pid, DEAD_PID); assert.equal(stale[0].holder.label, 'sweep:crashed');
      assert.equal(stale[0].holderAlive, false); assert.equal(stale[0].slot, 0);
      assert.notEqual(inspectLock(p.lock).holder.nonce, p.token.nonce, 'the corpse\'s token was replaced');
    } finally { if (got && got.ok) got.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a reused pid (live process whose start is not the token\'s) with a fresh stamp is TAKEN — startedAt tells a stranger from the holder', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    let got = null;
    // A long-lived node process stands in for whatever inherited the pid. Killed on every exit path.
    const impostor = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore' });
    const kill = () => { try { impostor.kill('SIGKILL'); } catch { /* gone */ } };
    process.once('exit', kill);
    try {
      assert.ok(alive(impostor.pid), 'precondition: the impostor must be alive when the slot decides');
      // The dead holder started an hour ago; the impostor started just now.
      const p = plant(root, { pid: impostor.pid, at: Date.now(), startedAt: Date.now() - 60 * MIN });
      const before = inspectLock(p.lock);
      assert.equal(before.holderAlive, true, 'the pid IS alive');
      assert.equal(before.holderMatches, false, 'but it is not the process that wrote the token');
      assert.equal(before.stale, true);
      got = contend(root);
      assert.equal(got.ok, true, 'TAKEN — pid reuse is a dead holder');
      assert.deepEqual(Object.keys(inspectLock(p.lock).holder).sort(), ['at', 'host', 'label', 'nonce', 'pid', 'startedAt'], 'the token names host and start');
    } finally { if (got && got.ok) got.release(); kill(); process.off('exit', kill); rmSync(root, { recursive: true, force: true }); }
  });

  test('a live pid whose start DOES match the token, fresh stamp, is HELD — nothing distinguishes it from a sweep, and nothing should', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const p = plant(root, { pid: process.pid, at: Date.now() });
      const s = inspectLock(p.lock);
      assert.equal(s.holderAlive, true); assert.equal(s.holderMatches, true); assert.equal(s.stale, false);
      const got = contend(root);
      assert.equal(got.ok, false);
      assert.equal(ownerBytes(p.lock), p.bytes, 'the holder\'s token is untouched');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a LIVE, matching holder with a 31-minute stamp that did NOT refresh is TAKEN, loudly — an unrefreshed stamp is the only bound on a hung sweep', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    let got = null;
    try {
      const p = plant(root, { pid: process.pid, at: Date.now() - 31 * MIN });
      assert.ok(alive(process.pid));
      const stale = [];
      got = contend(root, { onStale: (s) => stale.push(s) });
      assert.equal(got.ok, true, 'TAKEN — alive and matching, but the stamp says it stopped refreshing');
      assert.equal(got.slot, 0);
      const now = inspectLock(p.lock);
      assert.notEqual(now.holder.nonce, p.token.nonce, 'the live holder\'s token was replaced');
      assert.equal(now.holder.label, 'contender');
      assert.equal(stale.length, 1, 'never silent');
      assert.equal(stale[0].holder.nonce, p.token.nonce);
      assert.equal(stale[0].holderAlive, true); assert.equal(stale[0].holderMatches, true);
      assert.ok(stale[0].ageMs >= 31 * MIN - 1000);
      // And the sweep itself wires it: it passes onStale and hands the permit to keepSweepSlot,
      // whose behaviour the 'a kept permit' tests below witness in a real child.
      const sweepSrc = readFileSync(SWEEP, 'utf8');
      const call = sweepSrc.slice(sweepSrc.indexOf('acquireSweepSlot(join('), sweepSrc.indexOf('});', sweepSrc.indexOf('acquireSweepSlot(join(')));
      assert.ok(call.length > 0 && /onStale/.test(call), 'sweep.mjs listens for a takeover');
      assert.match(sweepSrc, /keepSweepSlot\(got, \{/, 'sweep.mjs keeps the permit it was admitted on');
    } finally { if (got && got.ok) got.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a LIVE, matching holder with a 31-minute stamp that REFRESHED is HELD — refresh() is what keeps a long sweep\'s permit', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    let held = null;
    try {
      held = acquireSweepSlot(root, { slots: 1, deadlineMs: 0, label: 'sweep:long' });
      assert.equal(held.ok, true);
      const lock = join(root, slotName(0));
      // Age the stamp by hand, as 31 minutes of running would, keeping the identity.
      const aged = { ...JSON.parse(ownerBytes(lock)), at: Date.now() - 31 * MIN };
      writeFileSync(join(lock, OWNER), JSON.stringify(aged));
      assert.equal(inspectLock(lock).stale, true, 'precondition: without a refresh this permit is up for taking');
      const r = held.refresh();
      assert.equal(r.ok, true, `refresh must succeed on a lock still ours: ${JSON.stringify(r)}`);
      const after = inspectLock(lock);
      assert.equal(after.stale, false);
      assert.equal(after.holder.nonce, aged.nonce, 'the identity survives a refresh');
      assert.ok(after.ageMs < 5_000, `the stamp is fresh again; got ${after.ageMs}`);
      const got = contend(root);
      assert.equal(got.ok, false, 'HELD — a refreshed permit is a live one');
      assert.equal(got.holder.nonce, aged.nonce);
    } finally { if (held && held.ok) held.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('a LIVE pid with a 29-minute stamp is HELD — the threshold is the default 30 minutes', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const p = plant(root, { pid: process.pid, at: Date.now() - 29 * MIN });
      assert.equal(DEFAULT_STALE_MS, 30 * MIN);
      const got = contend(root);
      assert.equal(got.ok, false);
      assert.equal(ownerBytes(p.lock), p.bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('liveness UNKNOWN (kill throws an unexpected code) is HELD by stamp age — never dead; EPERM is alive', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      // Fresh stamp, dead pid on the real pid table — the seam is the only thing keeping it held.
      const p = plant(root, { pid: DEAD_PID, at: Date.now() });
      const odd = inspectLock(p.lock, { kill: throwing('EWHATEVER') });
      assert.equal(odd.holderAlive, 'unknown'); assert.equal(odd.holderMatches, 'unknown'); assert.equal(odd.stale, false);
      assert.equal(contend(root, { kill: throwing('EWHATEVER') }).ok, false, 'HELD — unknown is not a takeover licence');
      assert.equal(ownerBytes(p.lock), p.bytes);
      const other = inspectLock(p.lock, { kill: throwing('EPERM') });
      assert.equal(other.holderAlive, true, 'EPERM is a pid that exists under another user');
      assert.equal(contend(root, { kill: throwing('EPERM') }).ok, false);
      // Control: the same token under the real kill is dead and stale — the seam was load-bearing.
      assert.equal(inspectLock(p.lock).stale, true);
      // Unknown with an OLD stamp still falls to the stamp rule: taken.
      const q = plant(root, { pid: DEAD_PID, at: Date.now() - 31 * MIN });
      const got = contend(root, { kill: throwing('EWHATEVER') });
      assert.equal(got.ok, true, 'stamp age still governs when liveness is unknown');
      assert.notEqual(inspectLock(q.lock).holder.nonce, q.token.nonce);
      got.release();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a pre-field token (no host, no startedAt) is read and HELD by stamp age — the pid is not probed without a host to probe it on', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const p = plant(root, { pid: DEAD_PID, at: Date.now(), legacy: true });
      assert.deepEqual(Object.keys(p.token).sort(), ['at', 'label', 'nonce', 'pid']);
      const s = inspectLock(p.lock);
      assert.equal(s.held, true); assert.equal(s.holderAlive, 'unknown'); assert.equal(s.holderMatches, 'unknown'); assert.equal(s.stale, false);
      assert.equal(contend(root).ok, false, 'HELD — fail closed to the stamp rule');
      assert.equal(ownerBytes(p.lock), p.bytes);
      const q = plant(root, { pid: DEAD_PID, at: Date.now() - 31 * MIN, legacy: true });
      const got = contend(root);
      assert.equal(got.ok, true, 'and the stamp rule still breaks it when stale');
      assert.notEqual(inspectLock(q.lock).holder.nonce, q.token.nonce);
      got.release();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a token from ANOTHER host is HELD by stamp age — a pid over a shared mount is somebody else\'s pid table', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const p = plant(root, { pid: DEAD_PID, at: Date.now(), host: `not-${hostname()}` });
      const s = inspectLock(p.lock);
      assert.equal(s.holderAlive, 'unknown'); assert.equal(s.stale, false);
      assert.equal(contend(root).ok, false);
      assert.equal(ownerBytes(p.lock), p.bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a refused acquireSweepSlot() names the holder, its age and its liveness — the deferral line can print it', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const p = plant(root, { pid: process.pid, at: Date.now() - 2 * MIN, label: 'sweep:team-x' });
      const got = contend(root);
      assert.equal(got.ok, false);
      assert.deepEqual(Object.keys(got).sort(), ['heldFor', 'holder', 'holderAlive', 'holders', 'ok', 'reason', 'slots', 'waitedMs']);
      assert.equal(got.holder.label, 'sweep:team-x'); assert.equal(got.holder.pid, process.pid);
      assert.ok(got.heldFor >= 2 * MIN - 1000 && got.heldFor < 3 * MIN, `heldFor is the hold age; got ${got.heldFor}`);
      assert.equal(got.holderAlive, true);
      assert.equal(got.holders.length, 1);
      assert.deepEqual(Object.keys(got.holders[0]).sort(), ['heldFor', 'holder', 'holderAlive', 'holderMatches', 'slot']);
      assert.equal(got.holders[0].slot, 0); assert.equal(got.holders[0].holder.nonce, p.token.nonce);
      assert.equal(inspectLock(p.lock).holder.label, 'sweep:team-x', 'and the identity is still on disk');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// ── a kept permit: refreshed on a timer, released on a signal, never what keeps a process alive ─
// `keep.mjs` is the sweep's own hold, in a child: acquire, keepSweepSlot({ refreshMs: 40 }), then
// either wait for a signal (mode 'wait') or fall off the end of the script (mode 'end').
const KEEPER = `
import { acquireSweepSlot, keepSweepSlot, slotName } from ${JSON.stringify(pathToFileURL(SWEEP_SLOT).href)};
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [root, mode, sig] = process.argv.slice(2);
const got = acquireSweepSlot(root, { slots: 1, label: 'sweep:kept', deadlineMs: 0 });
if (got.ok !== true) { process.stderr.write('keeper: not admitted: ' + got.reason + '\\n'); process.exit(99); }
keepSweepSlot(got, { refreshMs: 40, onRefreshFailed: (r) => writeFileSync(join(sig, 'refresh-failed'), JSON.stringify(r)) });
writeFileSync(join(sig, 'kept'), String(process.pid));
if (mode === 'wait') setTimeout(() => { process.stderr.write('keeper: never signalled\\n'); process.exit(98); }, ${CAP_MS});
`;
function spawnKeeper(f, mode) {
  const script = join(f.dir, 'keep.mjs');
  writeFileSync(script, KEEPER);
  const c = spawn(process.execPath, [script, f.root, mode, f.sig], { env: { ...process.env, CW_SELF_SWEEP: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  c.stderr.on('data', (b) => { err += b; });
  const done = new Promise((res) => c.on('exit', (code, signal) => res({ code, signal, err })));
  const kid = { label: 'keeper', pid: c.pid, done, kill: () => { try { c.kill('SIGKILL'); } catch { /* gone */ } } };
  f.kids.push(kid);
  return kid;
}
const ownerAt = (lock) => JSON.parse(readFileSync(join(lock, OWNER), 'utf8')).at;

describe('a kept permit (keepSweepSlot) — what sweep.mjs holds for the life of a sweep', () => {
  test('the stamp is re-written on the interval while the holder runs, and SIGTERM releases the slot and still kills the holder', { timeout: CHILD_TEST_MS }, async () => {
    const f = fixture();
    try {
      const k = spawnKeeper(f, 'wait');
      await waitFor('the keeper to be admitted', () => existsSync(join(f.sig, 'kept')));
      const lock = join(f.root, slotName(0));
      const first = ownerAt(lock);
      await waitFor('a refresh to land', () => ownerAt(lock) > first);
      const s = inspectLock(lock);
      assert.equal(s.holder.pid, k.pid); assert.equal(s.holderAlive, true); assert.equal(s.holderMatches, true);
      assert.equal(existsSync(join(f.sig, 'refresh-failed')), false, 'no refresh failed while the permit was ours');
      process.kill(k.pid, 'SIGTERM');
      const r = await k.done;
      assert.equal(r.signal, 'SIGTERM', `the keeper must still die by the signal (exit ${r.code}): ${r.err}`);
      assertClean(f.root, 'after a signal death the slot is free and nothing is left behind');
    } finally { teardown(f); }
  });

  test('a keeper whose script ends exits on its own — the refresh timer is unref\'d — and the exit releases the slot', { timeout: CHILD_TEST_MS }, async () => {
    const f = fixture();
    try {
      const k = spawnKeeper(f, 'end');
      const r = await k.done;
      assert.equal(r.code, 0, `the keeper must exit by itself: signal ${r.signal}, ${r.err}`);
      assert.equal(existsSync(join(f.sig, 'kept')), true, 'it was admitted first');
      assertClean(f.root, 'after a natural exit');
    } finally { teardown(f); }
  });

  test('in-process: stop() removes the handlers and the timer; the handler releases and defers the re-raise to a remaining listener', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    const before = process.listenerCount('SIGTERM');
    let held = null;
    try {
      held = acquireSweepSlot(root, { slots: 1, deadlineMs: 0, label: 'sweep:inproc' });
      assert.equal(held.ok, true);
      const stop = keepSweepSlot(held, { refreshMs: 60_000, signals: ['SIGTERM'] });
      assert.equal(process.listenerCount('SIGTERM'), before + 1, 'one handler installed');
      stop();
      assert.equal(process.listenerCount('SIGTERM'), before, 'stop() removes it');
      // Re-install, then fire the handler with another listener present: it must release and
      // NOT re-raise (a real re-raise here would kill the test runner).
      keepSweepSlot(held, { refreshMs: 60_000, signals: ['SIGTERM'] });
      let other = 0;
      const peer = () => { other++; };
      process.on('SIGTERM', peer);
      try {
        process.emit('SIGTERM', 'SIGTERM');
        assert.equal(other, 1, 'the peer handler ran');
        assert.equal(inspectLock(join(root, slotName(0))).held, false, 'the handler released the slot');
      } finally { process.off('SIGTERM', peer); }
      assert.equal(process.listenerCount('SIGTERM'), before, 'the once-handler is gone after firing');
    } finally { if (held && held.ok) held.release(); rmSync(root, { recursive: true, force: true }); }
  });
});

// ── refresh(): the long holder's re-stamp ──────────────────────────────────────────────────────
describe('refresh() re-stamps `at` atomically and keeps the identity', () => {
  test('after refresh: `at` advanced, nonce and startedAt unchanged, one whole owner.json and no temp file', { timeout: SYNC_TEST_MS }, async () => {
    const root = scratch();
    let held = null;
    try {
      held = acquireSweepSlot(root, { slots: 1, deadlineMs: 0, label: 'sweep:refresh' });
      assert.equal(held.ok, true);
      const lock = join(root, slotName(0));
      const before = JSON.parse(ownerBytes(lock));
      await sleep(15); // `at` must move by a measurable amount
      const r = held.refresh();
      assert.equal(r.ok, true);
      const after = JSON.parse(ownerBytes(lock));
      assert.ok(after.at > before.at, `at must advance: ${before.at} -> ${after.at}`);
      assert.equal(r.at, after.at, 'the handle reports the stamp it wrote');
      assert.equal(after.nonce, before.nonce); assert.equal(after.startedAt, before.startedAt);
      assert.equal(after.pid, before.pid); assert.equal(after.host, before.host); assert.equal(after.label, before.label);
      assert.deepEqual(readdirSync(lock), [OWNER], 'the write went through a sibling temp + rename, and the temp is gone');
      assert.deepEqual(disk(root).debris, [], 'no guard left behind');
      assert.ok(Math.abs(statSync(lock).mtimeMs - after.at) < 2_000, 'the directory mtime follows the stamp, so the mtime fallback reads fresh too');
    } finally { if (held && held.ok) held.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('refresh on a lock that changed hands is refused as lost and leaves the successor\'s token byte-identical', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    let successor = null;
    try {
      const held = acquireSweepSlot(root, { slots: 1, deadlineMs: 0, label: 'sweep:old' });
      assert.equal(held.ok, true);
      const lock = join(root, slotName(0));
      // Age it by hand, let a contender take it over, then the old holder tries to refresh.
      writeFileSync(join(lock, OWNER), JSON.stringify({ ...JSON.parse(ownerBytes(lock)), at: Date.now() - 31 * MIN }));
      successor = contend(root);
      assert.equal(successor.ok, true, 'precondition: the slot changed hands');
      const theirs = ownerBytes(lock);
      const r = held.refresh();
      assert.deepEqual(r, { ok: false, reason: 'lost' });
      assert.equal(ownerBytes(lock), theirs, 'the old holder must not write over the successor');
      held.release();
      assert.equal(ownerBytes(lock), theirs, 'nor release it');
    } finally { if (successor && successor.ok) successor.release(); rmSync(root, { recursive: true, force: true }); }
  });

  test('refresh after release is refused, and refresh is itself refused while a breaker holds the guard', { timeout: SYNC_TEST_MS }, () => {
    const root = scratch();
    try {
      const held = acquireSweepSlot(root, { slots: 1, deadlineMs: 0, label: 'sweep:x' });
      assert.equal(held.ok, true);
      const lock = join(root, slotName(0));
      const guard = `${lock}.breaking`;
      mkdirSync(guard); // a breaker mid-removal
      try { assert.deepEqual(held.refresh(), { ok: false, reason: 'busy' }, 'a refresh never races the compare-and-delete'); }
      finally { rmSync(guard, { recursive: true, force: true }); }
      assert.equal(held.refresh().ok, true, 'and succeeds once the guard clears');
      held.release();
      assert.deepEqual(held.refresh(), { ok: false, reason: 'released' });
      assertClean(root, 'after release');
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
