// monitor/test/lock-timestamp-plausibility.test.mjs — an unreadable acquisition stamp must not be
// read as an ancient one. Paired with a CONTROL that restores the pre-fix predicate and is asserted
// to steal the lock, so the discriminator is load-bearing rather than merely present.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeLock, inspectLock, acquireLock, forceReleaseLock, describeAge, acquireLockOrReason } from '../lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCKFILE_SRC = join(HERE, '..', 'lockfile.mjs');
const STALE_MS = 10 * 60 * 1000;
const OWNER = 'owner.json';
const scratch = () => mkdtempSync(join(tmpdir(), 'cw-lockts-'));

// Plant a held lock carrying `at` in its token, and `mtimeAt` on the directory. The two are set
// independently because the defect needs BOTH to be unreadable before the age is truly unknown —
// a real holder that stamps at:0 also calls utimesSync(dir, 0, 0), so both go bad together.
function plant(lockPath, { at, mtimeAt = Date.now() }) {
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, OWNER), JSON.stringify({ pid: 999_999, nonce: 'held-nonce', at, label: 'live-holder' }));
  utimesSync(lockPath, mtimeAt / 1000, mtimeAt / 1000);
}

describe('an unreadable acquisition stamp is not an ancient one', () => {
  test('at:0 with a good mtime falls back to mtime and reads FRESH, not 57 years old', () => {
    const dir = scratch();
    try {
      const lock = join(dir, '.x.lock');
      plant(lock, { at: 0, mtimeAt: Date.now() });
      const o = observeLock(lock);
      assert.notEqual(o, null, 'the lock is held and must be observable');
      assert.ok(o.ageMs !== null && o.ageMs < 60_000,
        `mtime is the fallback for an unusable token stamp; got ageMs=${o.ageMs}`);
      assert.equal(inspectLock(lock, { staleMs: STALE_MS }).stale, false,
        'a lock acquired moments ago must never read stale because its token stamp was zeroed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('at:0 AND mtime:0 — the age is UNKNOWN (null), not enormous', () => {
    const dir = scratch();
    try {
      const lock = join(dir, '.x.lock');
      plant(lock, { at: 0, mtimeAt: 0 });
      const o = observeLock(lock);
      assert.equal(o.ageMs, null, `an age nothing can supply is null; got ${o.ageMs}`);
      assert.equal(o.at, null);
      const s = inspectLock(lock, { staleMs: STALE_MS });
      assert.equal(s.held, true);
      assert.equal(s.ageKnown, false, 'held-but-unreadable must be distinguishable from not-held');
      assert.equal(s.stale, false, 'unknown must not be published as stale — explicit uncertainty');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a live lock with an unreadable stamp is NOT taken over', () => {
    const dir = scratch();
    try {
      const lock = join(dir, '.x.lock');
      plant(lock, { at: 0, mtimeAt: 0 });
      const before = readFileSync(join(lock, OWNER), 'utf8');
      const got = acquireLock(lock, { staleMs: STALE_MS, label: 'contender' });
      assert.equal(got.ok, false, 'an age we cannot read is not a licence to steal the lock');
      assert.equal(got.heldFor, null, 'the caller is told the age is unreadable, not that it is 0');
      assert.equal(readFileSync(join(lock, OWNER), 'utf8'), before,
        'the incumbent token must be untouched — two writers in the critical section corrupts the store it guards');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('negative and far-future stamps are rejected the same way', () => {
    const dir = scratch();
    try {
      for (const [tag, at] of [['negative', -5_000], ['far-future', Date.now() + 86_400_000]]) {
        const lock = join(dir, `.${tag}.lock`);
        plant(lock, { at, mtimeAt: at > 0 ? at : 0 });
        const o = observeLock(lock);
        assert.ok(o.ageMs === null || o.ageMs >= 0,
          `${tag}: an age is a duration and can never be negative; got ${o.ageMs}`);
        assert.equal(inspectLock(lock, { staleMs: STALE_MS }).stale, false,
          `${tag}: must not read stale`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // The mirror risk of the fix: refusing to break unknown ages must not make locks immortal.
  test('the operator escape hatch still clears an unreadable lock', () => {
    const dir = scratch();
    try {
      const lock = join(dir, '.x.lock');
      plant(lock, { at: 0, mtimeAt: 0 });
      forceReleaseLock(lock);
      assert.equal(observeLock(lock), null, 'forceReleaseLock is the documented way out of an unreadable hold');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // The regression this fix could plausibly cause, asserted directly.
  test('a genuinely stale lock is STILL taken over', () => {
    const dir = scratch();
    try {
      const lock = join(dir, '.x.lock');
      const old = Date.now() - STALE_MS * 3;
      plant(lock, { at: old, mtimeAt: old });
      let sawStale = null;
      const got = acquireLock(lock, { staleMs: STALE_MS, label: 'contender', onStale: (ms) => { sawStale = ms; } });
      assert.equal(got.ok, true, 'a plausible, genuinely old stamp must still be reclaimable');
      assert.ok(sawStale > STALE_MS, `the takeover stays loud; onStale saw ${sawStale}`);
      got.release();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('describeAge never renders an absent age as a measured zero', () => {
    assert.equal(describeAge(null), 'age unknown');
    assert.equal(describeAge(undefined), 'age unknown');
    assert.equal(describeAge(0), '0s old');
    assert.equal(describeAge(4_000), '4s old');
  });
});

// ── the control ────────────────────────────────────────────────────────────────────────────────
// Restore the pre-fix predicate in a COPY of the shipping source and assert the theft happens. If
// this ever passes, the plausibility check has stopped being what prevents it.
describe('CONTROL: the pre-fix predicate steals a live lock', () => {
  test('Number.isFinite alone admits 0 and yields an age of decades', async () => {
    const dir = scratch();
    try {
      const copy = join(dir, 'lockfile-control.mjs');
      copyFileSync(LOCKFILE_SRC, copy);
      const src = readFileSync(copy, 'utf8');
      const guard = 'return typeof v === \'number\' && Number.isFinite(v) && v > 0 && v <= now + MAX_SKEW_MS;';
      assert.ok(src.includes(guard), 'the control must patch the predicate the fix actually ships');
      writeFileSync(copy, src.replace(guard, 'return Number.isFinite(v);'));

      const control = await import(`file://${copy}`);
      const lock = join(dir, '.x.lock');
      plant(lock, { at: 0, mtimeAt: 0 });

      const o = control.observeLock(lock);
      assert.ok(o.ageMs > 50 * 365 * 24 * 3600 * 1000,
        `the defect is Date.now() read as a delta from zero — decades; got ${o.ageMs}`);

      const before = readFileSync(join(lock, OWNER), 'utf8');
      const got = control.acquireLock(lock, { staleMs: STALE_MS, label: 'contender' });
      assert.equal(got.ok, true, 'CONTROL must reproduce the theft the fix prevents');
      assert.notEqual(readFileSync(join(lock, OWNER), 'utf8'), before,
        'CONTROL: the live holder\'s token was replaced — this is the defect, stated as a fact');
      got.release();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── the third outcome ──────────────────────────────────────────────────────────────────────────
// acquireLock throws on a real filesystem failure instead of reporting the lock busy. Handlers
// written for two outcomes skipped their contention branch entirely and let the throw escape.
describe('acquireLockOrReason separates a busy lock from an unusable filesystem', () => {
  test('a free path acquires and releases', () => {
    const dir = scratch();
    try {
      const got = acquireLockOrReason(join(dir, '.x.lock'), { staleMs: STALE_MS, label: 't' });
      assert.equal(got.ok, true);
      assert.equal(typeof got.lock.release, 'function');
      got.lock.release();
      assert.equal(observeLock(join(dir, '.x.lock')), null, 'release must clear the lock');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a lock held by somebody else is busy, and names the holder', () => {
    const dir = scratch();
    try {
      const lock = join(dir, '.x.lock');
      plant(lock, { at: Date.now(), mtimeAt: Date.now() });
      const got = acquireLockOrReason(lock, { staleMs: STALE_MS, label: 'contender' });
      assert.equal(got.ok, false);
      assert.equal(got.reason, 'busy');
      assert.equal(got.holder && got.holder.label, 'live-holder');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // THE REFUSAL IS CONSTRUCTED PER PLATFORM, because `chmod 0555` on a DIRECTORY IS A NO-OP ON
  // WINDOWS — measured: mkdir inside a 0555 directory succeeds there. So this test built a jail
  // that was not a jail, the lock acquired normally, and it failed with `true !== false` on every
  // Windows run. Skipping it would have been the easy answer and the wrong one: the property is
  // platform-independent and worth asserting everywhere. Only the way you make a filesystem say no
  // differs. On Windows a lock path under a directory that does not exist is refused for real.
  //
  // The property matters more than usual here because the obvious Windows fix for the EPERM
  // contention bug — adding EPERM/EACCES to the accepted set — collapses exactly this distinction,
  // and this test is what catches that.
  test('a filesystem that refuses the lock is UNAVAILABLE, never busy', { skip: process.getuid && process.getuid() === 0 ? 'root ignores mode bits' : false }, () => {
    const dir = scratch();
    const win = process.platform === 'win32';
    try {
      const jail = join(dir, 'jail');
      let lockPath;
      if (win) {
        // An ILLEGAL FILENAME is the refusal. Absence would not do it — acquireLock() does
        // `mkdirSync(dirname(lockPath), { recursive: true })`, so a missing parent is created
        // rather than refused. `<` is one of the characters Windows rejects outright, and
        // (measured, see lib/win-path-safety.mjs) it fails with ENOENT rather than EINVAL — so
        // this also pins that such an ENOENT is read as unavailable and never as absence.
        lockPath = join(jail, `ja${String.fromCharCode(60)}il`, '.x.lock');
      } else {
        mkdirSync(jail);
        chmodSync(jail, 0o555); // readable, not writable — mkdir inside throws EACCES/EPERM
        lockPath = join(jail, '.x.lock');
      }
      const got = acquireLockOrReason(lockPath, { staleMs: STALE_MS, label: 't' });
      assert.equal(got.ok, false);
      assert.equal(got.reason, 'unavailable',
        `a write refusal is not contention; got reason=${got.reason}`);
      assert.ok(got.code, 'the errno is what tells an operator which condition to clear');
      assert.notEqual(got.reason, 'busy',
        'reporting this as busy would tell an operator to "try again" about a condition retrying cannot clear');
      if (!win) chmodSync(jail, 0o755);
    } finally {
      try { chmodSync(join(dir, 'jail'), 0o755); } catch { /* already restored, or never chmod'd */ }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
