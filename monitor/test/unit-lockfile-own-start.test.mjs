// The holder's start stamp and the pid probe that reads it back must agree, on the clock `ps` uses.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { ownStartMs, holderVerdict, holderDead, REUSE_GRACE_MS } from '../lockfile.mjs';

const POSIX = process.platform !== 'win32';

describe('ownStartMs', () => {
  test('is the wall clock at process start, within a second of performance.timeOrigin', () => {
    assert.ok(Math.abs(ownStartMs() - performance.timeOrigin) <= 1000);
    assert.equal(ownStartMs() % 1000, 0, 'whole seconds, as etime is');
  });

  test('agrees with what ps reports for this process — the reader derives the start from etime', { skip: !POSIX && 'no ps' }, () => {
    const before = Date.now();
    const etime = execFileSync('ps', ['-o', 'etime=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();
    const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime);
    assert.ok(m, `etime unparseable: ${etime}`);
    const secs = ((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 3600) + Number(m[3]) * 60 + Number(m[4]);
    assert.ok(Math.abs((before - secs * 1000) - ownStartMs()) <= 5000, `ps start and the stamp differ by more than the tolerance (${before - secs * 1000} vs ${ownStartMs()})`);
  });

  test('a token this process writes is read back as this process', { skip: !POSIX && 'start is not probed on Windows' }, () => {
    const v = holderVerdict({ pid: process.pid, host: hostname(), startedAt: ownStartMs() });
    assert.deepEqual(v, { holderAlive: true, holderMatches: true });
  });

  test('a start twenty minutes from the true one — what a monotonic clock that lost a sleep stamps — is read as a stranger', { skip: !POSIX && 'start is not probed on Windows' }, () => {
    const slept = ownStartMs() - 20 * 60_000;
    const v = holderVerdict({ pid: process.pid, host: hostname(), startedAt: slept });
    assert.deepEqual(v, { holderAlive: true, holderMatches: false });
  });
});

describe('holderDead — the two witnesses', () => {
  test('a dead pid is dead at any stamp age', () => {
    assert.equal(holderDead({ holderAlive: false, holderMatches: 'unknown', ageMs: 0 }), true);
    assert.equal(holderDead({ holderAlive: false, holderMatches: 'unknown', ageMs: null }), true);
  });
  test('a start mismatch counts only once the stamp has passed the reuse grace', () => {
    assert.equal(holderDead({ holderAlive: true, holderMatches: false, ageMs: 0 }), false);
    assert.equal(holderDead({ holderAlive: true, holderMatches: false, ageMs: REUSE_GRACE_MS - 1 }), false);
    assert.equal(holderDead({ holderAlive: true, holderMatches: false, ageMs: REUSE_GRACE_MS }), true);
  });
  test('an unreadable age is not a licence, and unknown is never dead', () => {
    assert.equal(holderDead({ holderAlive: true, holderMatches: false, ageMs: null }), false);
    assert.equal(holderDead({ holderAlive: 'unknown', holderMatches: 'unknown', ageMs: 3_600_000 }), false);
    assert.equal(holderDead({ holderAlive: true, holderMatches: true, ageMs: 3_600_000 }), false);
    assert.equal(holderDead(null), false);
  });
});
