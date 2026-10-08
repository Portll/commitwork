// lib/test/durable-write.test.mjs — the durable-write floor.
//
// You cannot fill a real disk from a test, and a fault you cannot inject is a fault nobody has ever
// seen the handler for. So every failure mode here is produced by replacing exactly ONE function in
// the injected I/O surface and letting the rest run for real: a real tmp file is really created,
// really written to, and the injected writeSync really throws ENOSPC at byte 4096. What is asserted
// afterwards is the EFFECT on the filesystem — is the tmp gone, is the target untouched, are the
// bytes readable back — never a flag the module set about itself.
//
// The two tests that matter most are the ones that came out of MEASURING this runtime rather than
// reading its docs:
//   · a zero-byte SQLite file passes PRAGMA integrity_check as "ok" with zero tables, so the
//     obvious checker certifies exactly the file a full disk leaves behind;
//   · late-page corruption makes integrity_check THROW rather than report, so a checker that only
//     inspects returned rows sees a clean store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  durableWrite, durableWriteJson, durableAppendLine, verifySqlite,
  preflight, freeSpace, classify, defaultIO, summarise, now, maxBytes, headroomBytes,
  WRITTEN, REFUSED, FAILED, SPACE_OK, SPACE_INSUFFICIENT, SPACE_UNKNOWN,
  HELD, UNSUPPORTED, NOT_ATTEMPTED, STEP_FAILED,
  STORE_OK, STORE_ABSENT, STORE_UNREADABLE, STORE_CORRUPT, STORE_TRUNCATED,
} from '../durable-write.mjs';

/** A fresh directory per test. Shared trees are how this repo's worst bugs travel. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-durable-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Anything left behind by a failed write — the effect a cleanup claim is checked against. */
const tmpsIn = (dir) => readdirSync(dir).filter((n) => n.endsWith('.tmp'));

/** An fs error indistinguishable from the real thing at every point the module inspects. */
const errno = (code, syscall = 'write') =>
  Object.assign(new Error(`${code}: simulated ${code}, ${syscall}`), { code, errno: -1, syscall });

// ── The success path, proven by reading the bytes back ──────────────────────

test('a successful write is readable back with identical bytes, and every guarantee is reported', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  // Deliberately not ASCII and not small: multi-byte UTF-8 is where a byte/char length confusion
  // shows up as a truncated tail, and only a byte comparison catches it.
  const payload = `${'ünïcøde ✓ '.repeat(5000)}\n`;

  const r = durableWrite(p, payload);
  assert.equal(r.state, WRITTEN, summarise(r));
  assert.equal(r.ok, true);

  // THE EFFECT: the file on disk, not the receipt's opinion of it.
  assert.equal(readFileSync(p, 'utf8'), payload);
  assert.equal(statSync(p).size, Buffer.byteLength(payload, 'utf8'));
  assert.equal(r.bytes, Buffer.byteLength(payload, 'utf8'));

  // Every durability step is accounted for, and none of them is silently missing.
  assert.equal(r.durability.tmpWrite, HELD);
  assert.equal(r.durability.fileFsync, HELD);
  assert.equal(r.durability.rename, HELD);
  assert.equal(r.durability.readback, HELD, 'readback is on by default — a guarantee nobody checks decays');
  assert.equal(r.guarantees.atomicRename, true);
  assert.equal(r.guarantees.fileDurable, true);
  // dirDurable is true on POSIX and 'unknown' on Windows. Never false on a healthy write, and
  // never silently absent.
  assert.ok(r.guarantees.dirDurable === true || r.guarantees.dirDurable === 'unknown');
  if (process.platform !== 'win32') {
    assert.equal(r.durability.dirFsync, HELD, 'the directory fsync is the step most often missed; on POSIX it must actually run');
  }

  assert.deepEqual(tmpsIn(dir), [], 'no temporary file survives a successful write');
  // The tmp was created and became the target. Reporting "not-created" of a file that existed is a
  // small lie, and a receipt that tells small lies is not evidence.
  assert.equal(r.tmp.cleaned, 'became-target');
});

test('a rewrite replaces the file and does not leave the old bytes or a tmp behind', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  durableWrite(p, 'first');
  const r = durableWrite(p, 'second');
  assert.equal(r.state, WRITTEN);
  assert.equal(readFileSync(p, 'utf8'), 'second');
  assert.deepEqual(tmpsIn(dir), []);
});

test('an existing file\'s mode survives the replace — rename would otherwise give it the tmp\'s', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, (t) => {
  const dir = scratch(t);
  const p = join(dir, 'secret.json');
  writeFileSync(p, 'old', { mode: 0o600 });
  const r = durableWrite(p, 'new');
  assert.equal(r.state, WRITTEN);
  assert.equal(statSync(p).mode & 0o777, 0o600, 'a 0600 store must not become world-readable because it was rewritten durably');
});

// ── Preflight: refusal, and the third state ─────────────────────────────────

test('preflight refuses rather than half-writing, and touches nothing when it does', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  writeFileSync(p, 'PRIOR CONTENT');

  // 615 MiB free was the measured number on this box the day the stores stopped. Ask for more.
  const io = { statfsSync: () => ({ bsize: 4096, bavail: 100, bfree: 100, blocks: 1e6 }) };
  const r = durableWrite(p, 'x'.repeat(10_000), { io });

  assert.equal(r.state, REFUSED, summarise(r));
  assert.equal(r.class, 'no-space');
  assert.equal(r.preflight.state, SPACE_INSUFFICIENT);
  assert.ok(r.preflight.freeBytes === 409_600, `free space is reported, not just judged: ${r.preflight.freeBytes}`);
  // THE EFFECT that makes a refusal recoverable: the prior file is exactly as it was.
  assert.equal(readFileSync(p, 'utf8'), 'PRIOR CONTENT', 'a refused write must not have touched the target');
  assert.deepEqual(tmpsIn(dir), [], 'a refusal creates no temporary file to leak space on a full disk');
});

test('UNKNOWN free space is neither a pass nor a refusal — the write proceeds and says it did not know', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const io = { statfsSync: () => { throw errno('ENOSYS', 'statfs'); } };

  const r = durableWrite(p, 'payload', { io });
  assert.equal(r.state, WRITTEN, 'refusing on our own ignorance would stop every write on every filesystem we cannot measure');
  assert.equal(r.preflight.state, SPACE_UNKNOWN);
  assert.equal(r.preflight.freeBytes, null, 'unknown must not be reported as a number, least of all as 0');
  assert.match(r.preflight.why, /undetermined/i);
  assert.equal(readFileSync(p, 'utf8'), 'payload');
  // And the greyness must be visible to a human, not buried in a field.
  assert.match(summarise(r), /undetermined/i);
});

test('statfs answering with zeroes is UNKNOWN, not "you are full" — some network mounts do exactly this', (t) => {
  const dir = scratch(t);
  const io = { statfsSync: () => ({ bsize: 0, bavail: 0, bfree: 0, blocks: 0 }) };
  const pf = preflight(join(dir, 'x'), 10, { io });
  assert.equal(pf.state, SPACE_UNKNOWN);
  assert.equal(pf.freeBytes, null);
});

test('freeSpace uses bavail, not bfree — root-reserved blocks are not space this process can have', (t) => {
  const dir = scratch(t);
  // bfree is generous, bavail is not. A checker reading bfree passes a write that then fails ENOSPC.
  const io = { statfsSync: () => ({ bsize: 1024, bavail: 10, bfree: 1_000_000, blocks: 2_000_000 }) };
  const fs_ = freeSpace(join(dir, 'x'), { io });
  assert.equal(fs_.state, SPACE_OK);
  assert.equal(fs_.freeBytes, 10 * 1024, 'bavail governs; reporting bfree would over-report by 100,000x here');
});

test('preflight demands headroom over the payload, and the headroom is env-overridable at CALL time', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'x');
  // 1 MiB free, 100-byte payload. With the default 8 MiB headroom this is insufficient...
  const io = { statfsSync: () => ({ bsize: 1024, bavail: 1024, bfree: 1024 }) };
  assert.equal(preflight(p, 100, { io }).state, SPACE_INSUFFICIENT);
  // ...and with the env override read at call time, it is fine. If the module had captured the env
  // at import, this assertion would pass for the wrong reason and prove nothing.
  assert.equal(preflight(p, 100, { io, env: { CW_DURABLE_HEADROOM_BYTES: '0' } }).state, SPACE_OK);
  assert.equal(headroomBytes({ CW_DURABLE_HEADROOM_BYTES: '4096' }), 4096);
  assert.equal(headroomBytes({}), 8 * 1024 * 1024, 'a garbage or absent override falls back to the default, never to 0');
  assert.equal(headroomBytes({ CW_DURABLE_HEADROOM_BYTES: 'banana' }), 8 * 1024 * 1024);
});

// ── Partial writes and tmp cleanup ──────────────────────────────────────────

test('ENOSPC part-way through leaves no tmp, does not touch the target, and reports how far it got', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  writeFileSync(p, 'PRIOR CONTENT');

  const real = defaultIO();
  let written = 0;
  const io = {
    // Let the first chunk land for real, then fail like a disk filling mid-write. A mock that
    // refuses byte 0 would never exercise the partial-write bookkeeping, which is the whole point.
    writeSync: (fd, buf, off, len) => {
      if (written >= 4096) throw errno('ENOSPC');
      const n = real.writeSync(fd, buf, off, Math.min(len, 4096));
      written += n;
      return n;
    },
  };

  const r = durableWrite(p, 'x'.repeat(200_000), { io });
  assert.equal(r.state, FAILED, summarise(r));
  assert.equal(r.class, 'no-space');
  assert.equal(r.errno, 'ENOSPC');

  // A write error NEVER means "wrote nothing", and the receipt has to be able to say so.
  assert.equal(r.partial.started, true);
  assert.equal(r.partial.bytesWritten, 4096);
  assert.equal(r.partial.targetReplaced, false);
  assert.match(r.reason, /4096 of 200000 bytes/);

  // THE EFFECTS: target intact, tmp gone. Asserted against the filesystem, not against r.tmp.
  assert.equal(readFileSync(p, 'utf8'), 'PRIOR CONTENT');
  assert.deepEqual(tmpsIn(dir), [], 'the tmp must be removed — leftover tmps on a full disk turn one failure into a cascade');
  assert.equal(r.tmp.cleaned, true);
});

test('a cleanup that itself fails is REPORTED, never swallowed — the tmp is still eating space', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const io = {
    writeSync: () => { throw errno('ENOSPC'); },
    unlinkSync: () => { throw errno('EACCES', 'unlink'); },
  };

  const r = durableWrite(p, 'payload', { io });
  assert.equal(r.state, FAILED);
  assert.equal(r.tmp.cleaned, false);
  assert.ok(r.tmp.cleanupReason, 'a failed cleanup must carry a reason');
  assert.match(r.tmp.cleanupReason, /EACCES/);
  assert.match(r.tmp.cleanupReason, /still occupying space/i);
  // And it has to reach a human, not merely a field.
  assert.match(summarise(r), /TEMP FILE NOT REMOVED/);

  // THE EFFECT: the real tmp genuinely is still on disk, because the real unlink never ran.
  assert.equal(tmpsIn(dir).length, 1, 'the leaked tmp is real, which is why the report matters');
});

test('an unlink that reports ENOENT is the one benign cleanup outcome, decided by errno not by message', (t) => {
  const dir = scratch(t);
  const io = {
    writeSync: () => { throw errno('EIO'); },
    unlinkSync: () => { throw errno('ENOENT', 'unlink'); },
  };
  const r = durableWrite(join(dir, 'store.json'), 'payload', { io });
  assert.equal(r.state, FAILED);
  assert.equal(r.tmp.cleaned, true, 'already gone is cleaned');
  assert.equal(r.tmp.cleanupReason, null);
});

test('an exclusive tmp create refuses to clobber a colliding in-flight write', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const tmp = join(dir, 'peer-in-flight.tmp');
  writeFileSync(tmp, 'ANOTHER SESSION IS WRITING HERE');

  const r = durableWrite(p, 'mine', { tmpPath: tmp });
  assert.equal(r.state, FAILED);
  assert.equal(r.errno, 'EEXIST');
  // Eight sessions share this tree. Clobbering a peer's tmp blind is the failure this prevents,
  // and the effect that proves it is the peer's bytes still being there.
  assert.equal(readFileSync(tmp, 'utf8'), 'ANOTHER SESSION IS WRITING HERE');
});

// ── Errno classification ────────────────────────────────────────────────────

test('every errno this module must tell apart gets its own class, and none collapses into another', () => {
  const cases = [
    ['ENOSPC', 'no-space'],
    ['EDQUOT', 'quota'],           // the device may have space you cannot use
    ['EIO', 'io'],                 // the containerd signature — damage outliving its cause
    ['EACCES', 'permission'],
    ['EPERM', 'permission'],
    ['EROFS', 'read-only-fs'],     // what a kernel does AFTER an I/O or space failure
    ['ENOENT', 'absent'],
    ['EFBIG', 'too-big-for-fs'],
    ['EMFILE', 'fd-exhausted'],
    ['EXDEV', 'cross-device'],
  ];
  for (const [code, cls] of cases) {
    const c = classify(errno(code));
    assert.equal(c.class, cls, `${code} must classify as ${cls}, got ${c.class}`);
    assert.equal(c.errno, code, 'the original errno is preserved, never erased by the verdict');
  }
  // EIO must not be sold as transient: it is the one that persisted for eight days.
  assert.equal(classify(errno('EIO')).recoverable, false);
  assert.match(classify(errno('EIO')).why, /wedged|persist/i);
});

test('an unrecognised error is `unknown` with its evidence intact — never quietly benign', () => {
  const c = classify(errno('ESOMETHINGNEW'));
  assert.equal(c.class, 'unknown');
  assert.equal(c.errno, 'ESOMETHINGNEW', 'the undetermined claim keeps its evidence');
  assert.equal(c.recoverable, null, 'unknown recoverability is null, not false and not true');
  // A bare Error with no code at all must still not become a success or a benign state.
  assert.equal(classify(new Error('who knows')).class, 'unknown');
  assert.equal(classify(null).class, 'unknown');
});

test('OOM-adjacent failures carry no errno, and an errno-keyed handler would drop them', () => {
  // The real shape, verified on this runtime: a bare RangeError with `code: undefined`.
  const real = new RangeError('Invalid string length');
  assert.equal(real.code, undefined, 'this is why the constructor and message are both consulted');
  assert.equal(classify(real).class, 'oom');

  const tagged = Object.assign(new Error('string too long'), { code: 'ERR_STRING_TOO_LONG' });
  assert.equal(classify(tagged).class, 'oom');
  assert.equal(classify(new RangeError('Array buffer allocation failed')).class, 'oom');
  // A RangeError that is NOT about allocation must not be laundered into an OOM verdict.
  assert.equal(classify(new RangeError('index out of bounds')).class, 'unknown');
});

// ── The size ceiling ────────────────────────────────────────────────────────

test('a payload above the ceiling is REFUSED with a receipt, before anything is allocated or touched', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  writeFileSync(p, 'PRIOR');

  const r = durableWrite(p, 'x'.repeat(50_000), { max: 1000 });
  assert.equal(r.state, REFUSED, summarise(r));
  assert.equal(r.class, 'too-large');
  assert.ok(r.bytes > 1000);
  assert.match(r.reason, /ceiling is 1000/);
  assert.equal(readFileSync(p, 'utf8'), 'PRIOR', 'nothing touched');
  assert.deepEqual(tmpsIn(dir), []);
});

test('the ceiling is env-overridable and read at CALL time', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const r = durableWrite(p, 'x'.repeat(5000), { env: { CW_DURABLE_MAX_BYTES: '100' } });
  assert.equal(r.state, REFUSED);
  assert.equal(r.class, 'too-large');
  assert.equal(maxBytes({ CW_DURABLE_MAX_BYTES: '512' }), 512);
  assert.equal(maxBytes({}), 64 * 1024 * 1024);
  assert.equal(maxBytes({ CW_DURABLE_MAX_BYTES: '0' }), 64 * 1024 * 1024, 'a zero ceiling would refuse everything; fall back');
});

test('a Buffer payload is measured by byteLength, and a Uint8Array is accepted without a copy-shaped bug', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'bin');
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252]);
  const r = durableWrite(p, bytes);
  assert.equal(r.state, WRITTEN);
  assert.deepEqual([...readFileSync(p)], [...bytes], 'binary round-trips byte for byte');
  assert.equal(durableWrite(join(dir, 'b2'), Buffer.alloc(10), { max: 5 }).class, 'too-large');
});

// ── Readback: assert the effect, not the marker ─────────────────────────────

test('a filesystem that accepts the write and stores something else is caught by readback', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const real = defaultIO();
  // Every syscall returns success; the bytes are simply wrong. This is the containerd shape — the
  // write path reports fine and the store is not what you wrote. Only a readback sees it.
  const io = { readFileSync: () => Buffer.from('NOT WHAT WAS WRITTEN') };

  const r = durableWrite(p, 'the real payload', { io });
  assert.equal(r.state, FAILED, summarise(r));
  assert.equal(r.class, 'io');
  assert.equal(r.durability.readback, STEP_FAILED);
  assert.match(r.reason, /accepted the write and stored something else/);
  // The earlier steps genuinely held; the receipt must not retroactively deny them.
  assert.equal(r.durability.rename, HELD);
  assert.equal(real.readFileSync(p, 'utf8'), 'the real payload', 'the real file is fine — the mock lied, which is the point');
});

test('a readback that cannot run at all is UNVERIFIED, distinct from both wrong and right', (t) => {
  const dir = scratch(t);
  const io = { readFileSync: () => { throw errno('EIO', 'read'); } };
  const r = durableWrite(join(dir, 'store.json'), 'payload', { io });
  assert.equal(r.state, FAILED);
  assert.equal(r.class, 'io');
  assert.match(r.reason, /UNVERIFIED/);
  assert.match(r.reason, /not the same as wrong and not the same as right/);
});

test('verification can be switched off, and the receipt then says so rather than implying it passed', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const r = durableWrite(p, 'payload', { verify: false });
  assert.equal(r.state, WRITTEN);
  assert.equal(r.durability.readback, NOT_ATTEMPTED);
  assert.match(summarise(r), /readback:NOT VERIFIED/);
  assert.equal(readFileSync(p, 'utf8'), 'payload');
});

// ── Platform-conditional guarantees are reported, never silently skipped ────

test('a directory fsync that cannot run is UNSUPPORTED and dirDurable goes GREY, not green and not red', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const real = defaultIO();
  // Windows cannot open a directory as a file handle. Simulate exactly that: the FILE fsync must
  // still succeed, so the fault has to be aimed at the directory open alone.
  const io = { openSync: (target, flags, mode) => { if (target === dir) throw errno('EPERM', 'open'); return real.openSync(target, flags, mode); } };

  const r = durableWrite(p, 'payload', { io });
  assert.equal(r.state, WRITTEN, 'the write itself landed');
  assert.equal(readFileSync(p, 'utf8'), 'payload');
  assert.equal(r.durability.fileFsync, HELD, 'the file fsync is a separate guarantee and it held');
  assert.equal(r.durability.dirFsync, UNSUPPORTED);
  assert.equal(r.guarantees.dirDurable, 'unknown', 'grey: the rename\'s durability is undetermined, which is neither held nor lost');
  assert.match(summarise(r), /dir-fsync:unknown/);
  // And the reason is carried, not merely the verdict — a grey with no explanation is unactionable.
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /EPERM/);
  assert.match(summarise(r), /DURABILITY OF THE RENAME is undetermined/);
});

test('the directory OPEN and the directory FSYNC do not share a verdict', (t) => {
  const dir = scratch(t);
  const real = defaultIO();
  // The open SUCCEEDS and the fsync then fails for a real reason. This must be red, not the grey
  // the previous test asserts — the first draft of this module conflated the two and reported a
  // Windows-shaped EPERM on the open as a FAILED sync, which is grey published as red.
  const io = {
    fsyncSync: (fd) => {
      // Aim at the directory fd only, so the file fsync still holds and the split is what is tested.
      let isDir = false;
      try { isDir = real.fstatSync(fd).isDirectory(); } catch { /* treat as the file fd */ }
      if (isDir) throw errno('EIO', 'fsync');
      return real.fsyncSync(fd);
    },
  };
  const r = durableWrite(join(dir, 'store.json'), 'payload', { io });
  assert.equal(r.state, WRITTEN, 'the bytes landed regardless');
  assert.equal(r.durability.fileFsync, HELD);
  assert.equal(r.durability.dirFsync, STEP_FAILED, 'a handle we HELD and a kernel that declined is a real failure, not an unsupported platform');
  assert.equal(r.guarantees.dirDurable, false, 'red, not grey — we attempted it and it did not work');
  assert.match(summarise(r), /dir-fsync:NO/);
});

test('a directory open that fails for a REAL reason is not excused as unsupported', (t) => {
  const dir = scratch(t);
  const real = defaultIO();
  const io = { openSync: (target, flags, mode) => { if (target === dir) throw errno('EIO', 'open'); return real.openSync(target, flags, mode); } };
  const r = durableWrite(join(dir, 'store.json'), 'payload', { io });
  assert.equal(r.state, WRITTEN);
  assert.equal(r.durability.dirFsync, STEP_FAILED, 'EIO on a directory open is a fault, and excusing it would launder a red into a grey');
  assert.equal(r.guarantees.dirDurable, false);
});

test('an fsync the filesystem does not implement is UNSUPPORTED, not a write failure', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  const io = { fsyncSync: () => { throw errno('EINVAL', 'fsync'); } };
  const r = durableWrite(p, 'payload', { io });
  assert.equal(r.state, WRITTEN, 'the bytes are there; only the durability proof is missing');
  assert.equal(r.durability.fileFsync, UNSUPPORTED);
  assert.equal(r.guarantees.fileDurable, false, 'not held is reported as not held — never laundered into a pass');
  assert.equal(readFileSync(p, 'utf8'), 'payload');
});

test('an fsync that fails for a real reason is not excused as unsupported', (t) => {
  const dir = scratch(t);
  const io = { fsyncSync: () => { throw errno('EIO', 'fsync'); } };
  const r = durableWrite(join(dir, 'store.json'), 'payload', { io });
  assert.equal(r.state, FAILED);
  assert.equal(r.class, 'io');
  assert.deepEqual(tmpsIn(dir), [], 'and the tmp is still cleaned up');
});

test('a rename refused by another process holding the target (the Windows case) cleans up and reports', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'store.json');
  writeFileSync(p, 'PRIOR');
  const io = { renameSync: () => { throw errno('EPERM', 'rename'); } };
  const r = durableWrite(p, 'new', { io });
  assert.equal(r.state, FAILED);
  assert.equal(r.class, 'permission');
  assert.equal(r.partial.targetReplaced, false);
  assert.equal(readFileSync(p, 'utf8'), 'PRIOR', 'a failed rename leaves the old file whole — that is what atomicity buys');
  assert.deepEqual(tmpsIn(dir), []);
});

test('a parent directory that cannot be created is a REFUSAL — nothing was touched', (t) => {
  const dir = scratch(t);
  const io = { mkdirSync: () => { throw errno('EROFS', 'mkdir'); } };
  const r = durableWrite(join(dir, 'deep', 'store.json'), 'payload', { io });
  assert.equal(r.state, REFUSED);
  assert.equal(r.class, 'read-only-fs');
  assert.equal(existsSync(join(dir, 'deep')), false);
});

// ── JSON and the ledger ─────────────────────────────────────────────────────

test('durableWriteJson refuses an unserialisable value instead of writing half a document', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'j.json');
  const cyclic = {}; cyclic.self = cyclic;
  const r = durableWriteJson(p, cyclic);
  assert.equal(r.state, REFUSED);
  assert.equal(existsSync(p), false);

  const ok = durableWriteJson(p, { a: 1, b: [2, 3] });
  assert.equal(ok.state, WRITTEN);
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { a: 1, b: [2, 3] });
});

test('an appended ledger row is fsynced and readable back, and does NOT claim atomic-replace', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'ledger.jsonl');
  const a = durableAppendLine(p, JSON.stringify({ n: 1 }));
  const b = durableAppendLine(p, JSON.stringify({ n: 2 }));
  assert.equal(a.state, WRITTEN);
  assert.equal(b.state, WRITTEN);
  assert.equal(readFileSync(p, 'utf8'), '{"n":1}\n{"n":2}\n');
  assert.equal(a.guarantees.fileDurable, true);
  assert.equal(a.guarantees.atomicRename, false, 'an append is not an atomic replace and must not be dressed as one');
  assert.equal(a.durability.rename, NOT_ATTEMPTED, 'not-attempted is a different fact from failed');
  assert.equal(b.offsetBefore, 8, 'the pre-append size is recorded so a truncated row can be located');
});

test('a truncated ledger row is named as such — the reader is told the last line is suspect', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'ledger.jsonl');
  durableAppendLine(p, '{"n":1}');
  const real = defaultIO();
  let n = 0;
  const io = { writeSync: (fd, buf, off, len) => { if (n++ > 0) throw errno('ENOSPC'); return real.writeSync(fd, buf, off, Math.min(len, 3)); } };
  const r = durableAppendLine(p, '{"n":2222222}', { io });
  assert.equal(r.state, FAILED);
  assert.equal(r.class, 'no-space');
  assert.equal(r.partial.bytesWritten, 3);
  assert.match(r.reason, /TRUNCATED/);
  assert.match(r.reason, /last line as suspect/);
  // THE EFFECT: the partial row really is on disk. This is the failure an append cannot prevent,
  // and the receipt is the only thing that makes it findable.
  assert.equal(readFileSync(p, 'utf8'), '{"n":1}\n{"n');
});

test('a ledger row containing a newline is a programmer error and throws — one call is one row', (t) => {
  const dir = scratch(t);
  assert.throws(() => durableAppendLine(join(dir, 'l.jsonl'), 'a\nb'), /newline/);
});

test('an oversized ledger row is refused rather than appended unparseably', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'ledger.jsonl');
  const r = durableAppendLine(p, 'x'.repeat(500), { max: 100 });
  assert.equal(r.state, REFUSED);
  assert.equal(r.class, 'too-large');
  assert.equal(existsSync(p), false);
});

// ── verifySqlite: the two measured traps ────────────────────────────────────

function makeDb(dir, name = 'x.db', rows = 200) {
  const p = join(dir, name);
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE t(a, b)');
  const ins = db.prepare('INSERT INTO t VALUES(?, ?)');
  for (let i = 0; i < rows; i++) ins.run(i, 'x'.repeat(60));
  db.close();
  return p;
}

test('a healthy store verifies ok, and reports its table count', (t) => {
  const dir = scratch(t);
  const v = verifySqlite(makeDb(dir));
  assert.equal(v.state, STORE_OK);
  assert.equal(v.ok, true);
  assert.equal(v.tables, 1);
  assert.ok(v.bytes > 0);
});

test('THE ZERO-BYTE TRAP: an ENOSPC-truncated store is TRUNCATED, never a healthy empty database', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'wiped.db');
  writeFileSync(p, '');

  // First, prove the trap is real on THIS runtime rather than asserting it from memory: SQLite
  // opens a zero-byte file, reports zero tables, and passes integrity_check with "ok". A checker
  // built the obvious way certifies exactly the file a full disk leaves behind.
  const naive = new DatabaseSync(p, { readOnly: true });
  // node:sqlite returns null-prototype rows, so compare the VALUES — a deepEqual against an object
  // literal fails on the prototype and would read as "the trap is gone" when it is not.
  assert.deepEqual(naive.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check), ['ok'],
    'if this ever stops being true the module can be simplified — until then it is the reason for the zero-byte branch');
  assert.equal(naive.prepare('SELECT count(*) AS n FROM sqlite_master').get().n, 0);
  naive.close();

  const v = verifySqlite(p);
  assert.equal(v.state, STORE_TRUNCATED, 'reporting this as empty would invent a data-loss event AND hide the real one');
  assert.equal(v.ok, false);
  assert.notEqual(v.state, STORE_OK);
  assert.notEqual(v.state, STORE_ABSENT);
  assert.equal(v.bytes, 0);
  assert.match(v.why, /zero bytes/);
});

test('THE THROWING-INTEGRITY-CHECK TRAP: late-page corruption is CORRUPT, not a clean store', (t) => {
  const dir = scratch(t);
  const p = makeDb(dir, 'corrupt.db', 3000);
  const buf = readFileSync(p);
  assert.ok(buf.length > 4096 * 9, 'the fixture must be large enough to have interior pages to damage');
  buf.fill(0x5a, 4096 * 6, 4096 * 9);          // leave the header and schema page intact
  writeFileSync(p, buf);

  // The trap, measured: sqlite_master reads fine, so a liveness probe alone says "healthy", and
  // integrity_check THROWS rather than returning rows that say otherwise. A checker that only
  // inspects the returned rows sees nothing at all.
  const naive = new DatabaseSync(p, { readOnly: true });
  assert.equal(naive.prepare('SELECT count(*) AS n FROM sqlite_master').get().n, 1, 'the cheap probe is fooled');
  assert.throws(() => naive.prepare('PRAGMA integrity_check').all(), /malformed/);
  naive.close();

  const v = verifySqlite(p);
  assert.equal(v.state, STORE_CORRUPT);
  assert.equal(v.ok, false);
  assert.notEqual(v.tables, 0, 'and it is certainly not reported as an empty store');
});

test('a store corrupted in its header is CORRUPT, and the ambiguous "unable to open" is not read as absence', (t) => {
  const dir = scratch(t);
  const p = makeDb(dir, 'headerless.db');
  const buf = readFileSync(p);
  buf.fill(0xff, 100, 400);
  writeFileSync(p, buf);
  const v = verifySqlite(p);
  assert.ok(v.state === STORE_CORRUPT || v.state === STORE_UNREADABLE, `got ${v.state}`);
  assert.equal(v.ok, false);
  assert.notEqual(v.state, STORE_ABSENT, 'the file plainly exists; only stat() may say absent');
});

test('a file that is not a database at all is UNREADABLE, never empty', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'notadb.db');
  writeFileSync(p, 'this used to be a database and is now a log file\n');
  const v = verifySqlite(p);
  assert.equal(v.state, STORE_UNREADABLE);
  assert.match(v.why, /SQLite header/);
});

test('only stat() may say ABSENT, and a permission denial is never mistaken for one', (t) => {
  const dir = scratch(t);
  const missing = verifySqlite(join(dir, 'never-existed.db'));
  assert.equal(missing.state, STORE_ABSENT);
  assert.equal(missing.errno, 'ENOENT');
  assert.match(missing.why, /not the same as empty/);

  // The same SQLite message ("unable to open database file", errcode 14) is produced by a missing
  // file AND by a permission denial. This is exactly the pattern-match in
  // admin/lib/overwatch-layer-read.mjs:84-90. Here stat() decides, so EACCES cannot become absence.
  const io = { statSync: () => { throw errno('EACCES', 'stat'); } };
  const denied = verifySqlite(join(dir, 'locked.db'), { io });
  assert.equal(denied.state, STORE_UNREADABLE);
  assert.equal(denied.errno, 'EACCES');
  assert.notEqual(denied.state, STORE_ABSENT);
});

test('an EIO on open — the containerd shape, long after the disk is fine — is UNREADABLE, not empty', (t) => {
  const dir = scratch(t);
  const p = makeDb(dir);
  const boom = class { constructor() { throw errno('EIO', 'open'); } };
  const v = verifySqlite(p, { sqlite: boom });
  assert.equal(v.state, STORE_UNREADABLE);
  assert.equal(v.ok, false);
  assert.equal(v.tables, null, 'an unread store reports null tables, never 0');
});

test('a store that opens but cannot be queried is UNREADABLE, and says why', (t) => {
  const dir = scratch(t);
  const p = makeDb(dir);
  const wedged = class {
    prepare() { return { get: () => { throw errno('EIO', 'read'); }, all: () => { throw errno('EIO', 'read'); } }; }
    close() {}
  };
  const v = verifySqlite(p, { sqlite: wedged });
  assert.equal(v.state, STORE_UNREADABLE);
  assert.match(v.why, /unreadable, never empty/);
});

test('a real but table-less store is ok AND flagged — it may be a fresh store or a replaced one', (t) => {
  const dir = scratch(t);
  const p = join(dir, 'fresh.db');
  const db = new DatabaseSync(p); db.exec('PRAGMA user_version = 1'); db.close();
  const v = verifySqlite(p);
  // Distinct from the zero-byte case above: this file has a real header and real pages.
  assert.equal(v.state, STORE_OK);
  assert.equal(v.tables, 0);
  assert.match(v.why, /fresh store, or one that was replaced/);
  assert.ok(v.bytes > 0);
});

// ── Determinism ─────────────────────────────────────────────────────────────

test('CW_NOW is honoured, and an unparseable one throws rather than silently using wall-clock', () => {
  assert.equal(now({ CW_NOW: '2026-08-30T22:54:00Z' }), '2026-08-30T22:54:00.000Z');
  assert.throws(() => now({ CW_NOW: 'not a date' }), /not a parseable date/);
});

test('a receipt timestamp comes from CW_NOW, so the same inputs give the same receipt', (t) => {
  const dir = scratch(t);
  const env = { CW_NOW: '2026-09-06T00:00:00Z' };
  const a = durableWrite(join(dir, 'a'), 'payload', { env });
  const b = durableWrite(join(dir, 'b'), 'payload', { env });
  assert.equal(a.at, '2026-09-06T00:00:00.000Z');
  assert.equal(a.at, b.at);
  assert.equal(a.sha256, b.sha256, 'the content hash is the identity, and it does not move with the clock');
  assert.equal(verifySqlite(join(dir, 'nope.db'), { env }).at, '2026-09-06T00:00:00.000Z');
});

// ── Shape ───────────────────────────────────────────────────────────────────

test('every receipt carries every field — a field present on some outcomes is read as zero on the others', (t) => {
  const dir = scratch(t);
  mkdirSync(join(dir, 'sub'));
  const receipts = [
    durableWrite(join(dir, 'sub', 'ok'), 'payload'),
    durableWrite(join(dir, 'sub', 'refused'), 'xxxxx', { max: 2 }),
    durableWrite(join(dir, 'sub', 'failed'), 'payload', { io: { writeSync: () => { throw errno('ENOSPC'); } } }),
  ];
  const keys = ['ok', 'state', 'path', 'bytes', 'reason', 'class', 'errno', 'at', 'preflight',
    'durability', 'partial', 'tmp', 'platform', 'notes', 'guarantees'];
  for (const r of receipts) {
    for (const k of keys) assert.ok(k in r, `receipt for ${r.state} is missing ${k}`);
    for (const k of ['tmpWrite', 'fileFsync', 'rename', 'dirFsync', 'readback']) {
      assert.ok(k in r.durability, `durability.${k} missing on a ${r.state} receipt`);
    }
    for (const k of ['atomicRename', 'fileDurable', 'dirDurable']) {
      assert.ok(k in r.guarantees, `guarantees.${k} missing on a ${r.state} receipt`);
    }
    assert.ok(Array.isArray(r.notes));
    assert.equal(typeof summarise(r), 'string');
  }
  // A refusal claims no guarantee at all — nothing was written, so nothing about it is durable.
  const refused = receipts.find((r) => r.state === REFUSED);
  assert.deepEqual(refused.guarantees, { atomicRename: false, fileDurable: false, dirDurable: false });
  assert.equal(receipts.filter((r) => r.state === WRITTEN).length, 1);
  assert.equal(receipts.filter((r) => r.state === REFUSED).length, 1);
  assert.equal(receipts.filter((r) => r.state === FAILED).length, 1);
});

test('summarise says something true for a missing receipt rather than crashing on it', () => {
  assert.match(summarise(null), /never attempted/);
  assert.match(summarise(undefined), /not a success/);
});
